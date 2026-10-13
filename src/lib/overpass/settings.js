/*
 Shared Overpass settings of the POI panels: the endpoint list resolved from the effective key and
 the working interpreter remembered in the browser.
 */

import safeLocalStorage from '~/lib/safe-localstorage';

import {buildOverpassUrls} from './endpoints';
import {getEffectiveKey, loadRuntimeKey} from './key';

const overpassUrlStorageKey = 'leafletPoiOverpassUrl';

let runtimeKeyRequest = null;

/*
 Loads the runtime configuration once for concurrent callers: both POI panels ask for it when the
 map is initialized. A call after the request settles starts a new request.
 */
function loadRuntimeKeyOnce() {
    if (!runtimeKeyRequest) {
        runtimeKeyRequest = loadRuntimeKey().then(
            (key) => {
                runtimeKeyRequest = null;
                return key;
            },
            (e) => {
                runtimeKeyRequest = null;
                throw e;
            }
        );
    }
    return runtimeKeyRequest;
}

/*
 Returns the Overpass endpoints to use: with a key (user, runtime config or build time) the NextGIS
 instance comes first, otherwise the configured endpoints.
 */
function getOverpassUrls(configuredUrls) {
    const key = getEffectiveKey();
    if (key) {
        return buildOverpassUrls(key);
    }
    return (configuredUrls ?? []).filter(Boolean);
}

/*
 Returns the remembered working interpreter when it belongs to the same configured endpoint list,
 so that a changed configuration is not overridden by a stale value.
 */
function loadRememberedOverpassUrl(configuredUrls) {
    try {
        const stored = JSON.parse(safeLocalStorage.getItem(overpassUrlStorageKey) ?? 'null');
        if (
            stored &&
            typeof stored.url === 'string' &&
            Array.isArray(stored.urls) &&
            stored.urls.length === configuredUrls.length &&
            stored.urls.every((url, index) => url === configuredUrls[index])
        ) {
            return stored.url;
        }
    } catch (e) {
        // the stored value is broken or from an older format, ignore it
    }
    return null;
}

function saveRememberedOverpassUrl(url, configuredUrls) {
    safeLocalStorage.setItem(overpassUrlStorageKey, JSON.stringify({url, urls: configuredUrls}));
}

export {getOverpassUrls, loadRememberedOverpassUrl, loadRuntimeKeyOnce, saveRememberedOverpassUrl};
