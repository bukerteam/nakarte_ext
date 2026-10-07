import {Cache as ResponseCache} from '~/lib/cache';
import {fetch} from '~/lib/xhr-promise';

const defaultMaxPoints = 2000;
const defaultTimeout = 35000;
const persistentCacheKey = 'overpassResponseCache';
const persistentCacheTtl = 10 * 60 * 1000;
const persistentCacheMaxEntries = 5;
const persistentCacheMaxEntryLength = 200000;

function writePersistentCache(storage, entries) {
    if (!storage) {
        return;
    }
    try {
        storage.setItem(persistentCacheKey, JSON.stringify(entries));
    } catch (e) {
        try {
            storage.removeItem(persistentCacheKey);
        } catch (e2) {
            // the storage is unavailable, keep the cache in memory only
        }
    }
}

function readPersistentCache(storage) {
    if (!storage) {
        return [];
    }
    try {
        const entries = JSON.parse(storage.getItem(persistentCacheKey) ?? '[]');
        if (!Array.isArray(entries)) {
            return [];
        }
        const now = Date.now();
        const validEntries = entries.filter(
            (entry) =>
                entry &&
                typeof entry.query === 'string' &&
                typeof entry.time === 'number' &&
                now - entry.time < persistentCacheTtl
        );
        if (validEntries.length !== entries.length) {
            // drop expired entries from the storage right away
            writePersistentCache(storage, validEntries);
        }
        return validEntries;
    } catch (e) {
        return [];
    }
}

function escapeOverpassString(value) {
    return String(value).replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}

function escapeRegexString(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function filterToOverpass(filter) {
    let result = 'nwr';
    for (const [key, value] of Object.entries(filter)) {
        const values = Array.isArray(value) ? value : [value];
        if (values.length === 1) {
            result += `["${escapeOverpassString(key)}"="${escapeOverpassString(values[0])}"]`;
        } else {
            const pattern = values.map((item) => escapeOverpassString(escapeRegexString(item))).join('|');
            result += `["${escapeOverpassString(key)}"~"^(${pattern})$"]`;
        }
    }
    return result;
}

/*
 Splits the bbox into parts valid for Overpass (each coordinate within [-180, 180]).
 A viewport crossing the antimeridian produces two parts, e.g. [179.5, 180.2] ->
 [179.5, 180] and [-180, -179.8].
 */
function normalizeBboxParts([south, west, north, east]) {
    const s = Math.max(-90, Math.min(90, south));
    const n = Math.max(-90, Math.min(90, north));
    if (east - west >= 360) {
        return [[s, -180, n, 180]];
    }
    if (west >= -180 && east <= 180) {
        return [[s, west, n, east]];
    }
    if (east > 180) {
        return [
            [s, west, n, 180],
            [s, -180, n, east - 360],
        ];
    }
    return [
        [s, west + 360, n, 180],
        [s, -180, n, east],
    ];
}

function bboxToOverpass(bbox) {
    return bbox.map((coordinate) => Number(coordinate).toFixed(5)).join(',');
}

/*
 Builds an Overpass QL query for the given filters (a filter is an AND of tag conditions,
 the list of filters is OR-ed) within the bbox given as [south, west, north, east].
 A bbox crossing the antimeridian is split into two valid bboxes.
 */
function buildOverpassQuery(filters, bbox, {maxPoints = defaultMaxPoints} = {}) {
    const parts = normalizeBboxParts(bbox);
    const clauses = [];
    for (const filter of filters) {
        for (const part of parts) {
            clauses.push(`${filterToOverpass(filter)}(${bboxToOverpass(part)});`);
        }
    }
    return `[out:json][timeout:25];(${clauses.join('')});out center ${maxPoints};`;
}

function parseOverpassResponse(data) {
    const result = [];
    for (const element of data?.elements ?? []) {
        const lat = element.lat ?? element.center?.lat;
        const lon = element.lon ?? element.center?.lon;
        if (typeof lat !== 'number' || typeof lon !== 'number') {
            continue;
        }
        result.push({type: element.type, id: element.id, lat, lon, tags: element.tags ?? {}});
    }
    return result;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/*
 Returns the endpoint list with the preferred (previously working) url moved to the front,
 so that a known working interpreter is tried first.
 */
function orderOverpassUrls(urls, preferredUrl) {
    const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
    if (!preferredUrl || !list.includes(preferredUrl)) {
        return list;
    }
    return [preferredUrl, ...list.filter((url) => url !== preferredUrl)];
}

class OverpassClient {
    constructor(url, options = {}) {
        this._urls = (Array.isArray(url) ? url : [url]).filter(Boolean);
        if (!this._urls.length) {
            throw new Error('overpass endpoint is not configured');
        }
        this._urlIndex = 0;
        this._timeout = options.timeout ?? defaultTimeout;
        this._retryDelays = options.retryDelays ?? [2000, 5000, 10000];
        this._cache = new ResponseCache(options.cacheSize ?? 30);
        this._maxCachedElements = options.maxCachedElements ?? 1000;
        this._cacheStorage = options.cacheStorage ?? null;
        this._persistentCache = readPersistentCache(this._cacheStorage);
        this._pending = new Map();
        this._onWorkingUrlChange = options.onWorkingUrlChange;
        this._workingUrl = null;
        this._sameEndpointFailures = 0;
    }

    getActiveUrl() {
        return this._urls[this._urlIndex];
    }

    _findPersistentResponse(queryString) {
        const entry = this._persistentCache.find((item) => item.query === queryString);
        return entry ? entry.data : null;
    }

    _storePersistentResponse(queryString, data) {
        if (!this._cacheStorage) {
            return;
        }
        try {
            if (JSON.stringify(data).length > persistentCacheMaxEntryLength) {
                return;
            }
        } catch (e) {
            return;
        }
        const now = Date.now();
        this._persistentCache = [
            {query: queryString, time: now, data},
            ...this._persistentCache.filter(
                (entry) => entry.query !== queryString && now - entry.time < persistentCacheTtl
            ),
        ].slice(0, persistentCacheMaxEntries);
        writePersistentCache(this._cacheStorage, this._persistentCache);
    }

    /*
     Returns {promise, abort}. promise resolves with the parsed Overpass response. Requests for the same
     query are deduplicated, successful responses are cached.
     */
    query(queryString) {
        const cached = this._cache.get(queryString);
        if (cached.found) {
            return {
                promise: Promise.resolve(cached.value),
                abort: () => {
                    // nothing to abort, the response is already cached
                },
            };
        }
        if (this._pending.has(queryString)) {
            return this._pending.get(queryString);
        }
        const persistent = this._findPersistentResponse(queryString);
        if (persistent) {
            this._cache.put(queryString, persistent);
            return {
                promise: Promise.resolve(persistent),
                abort: () => {
                    // nothing to abort, the response is already cached
                },
            };
        }
        const request = this._createRequest(queryString);
        this._pending.set(queryString, request);
        const cleanup = () => this._pending.delete(queryString);
        request.promise.then(cleanup, cleanup);
        const originalAbort = request.abort;
        request.abort = () => {
            cleanup();
            originalAbort();
        };
        return request;
    }

    _createRequest(queryString) {
        const state = {xhr: null, aborted: false, rejectAbort: null};
        const abortPromise = new Promise((resolve, reject) => {
            state.rejectAbort = reject;
        });
        const promise = this._requestWithRetries(queryString, state, abortPromise).then((data) => {
            // do not keep huge responses in memory for the whole session
            if (data.elements.length <= this._maxCachedElements) {
                this._cache.put(queryString, data);
                this._storePersistentResponse(queryString, data);
            }
            return data;
        });
        return {
            promise,
            abort: () => {
                if (state.aborted) {
                    return;
                }
                state.aborted = true;
                if (state.xhr) {
                    state.xhr.abort();
                }
                state.rejectAbort(new Error('overpass request aborted'));
            },
        };
    }

    async _requestWithRetries(queryString, state, abortPromise) {
        for (let attempt = 0; ; attempt++) {
            if (state.aborted) {
                throw new Error('overpass request aborted');
            }
            try {
                state.xhr = fetch(this._urls[this._urlIndex], {
                    method: 'POST',
                    data: `data=${encodeURIComponent(queryString)}`,
                    responseType: 'json',
                    timeout: this._timeout,
                    responseNeedsRetry: () => false,
                    headers: [['Content-Type', 'application/x-www-form-urlencoded']],
                });
                const xhr = await Promise.race([state.xhr, abortPromise]);
                const data = xhr.responseJSON;
                if (!data || !Array.isArray(data.elements)) {
                    throw new Error('invalid overpass response');
                }
                if (data.remark && !data.elements.length) {
                    throw new Error(`overpass error: ${data.remark}`);
                }
                this._sameEndpointFailures = 0;
                this._reportWorkingUrl();
                return data;
            } catch (e) {
                if (state.aborted) {
                    throw e;
                }
                const responseStatus = e?.xhr?.status;
                const retryable =
                    responseStatus === 0 || responseStatus === 429 || responseStatus === 504 || responseStatus >= 500;
                if (!retryable || attempt >= this._retryDelays.length) {
                    throw e;
                }
                this._handleRetryableFailure(responseStatus);
                await delay(this._retryDelays[attempt]);
            }
        }
    }

    _handleRetryableFailure(responseStatus) {
        if (this._urls.length <= 1) {
            return;
        }
        if (responseStatus === 0) {
            // the endpoint is unreachable — switch to the next one right away
            this._urlIndex = (this._urlIndex + 1) % this._urls.length;
            this._sameEndpointFailures = 0;
            return;
        }
        // the endpoint responds but fails (429/5xx) — retry it, switch after repeated failures
        this._sameEndpointFailures += 1;
        if (this._sameEndpointFailures >= 2) {
            this._urlIndex = (this._urlIndex + 1) % this._urls.length;
            this._sameEndpointFailures = 0;
        }
    }

    _reportWorkingUrl() {
        const url = this._urls[this._urlIndex];
        if (url === this._workingUrl) {
            return;
        }
        this._workingUrl = url;
        if (this._onWorkingUrlChange) {
            this._onWorkingUrlChange(url);
        }
    }
}

export {buildOverpassQuery, parseOverpassResponse, orderOverpassUrls, OverpassClient};
