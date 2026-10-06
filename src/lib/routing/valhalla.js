import {decodePolyline} from './polyline';

// Application-level profile ids mapped to Valhalla costing models.
const COSTING_BY_PROFILE = {
    driving: 'auto',
    cycling: 'bicycle',
    motorcycle: 'motorcycle',
    walking: 'pedestrian',
};

const DEFAULT_TIMEOUT = 30000;

function getCosting(profile) {
    const costing = COSTING_BY_PROFILE[profile];
    if (!costing) {
        throw new Error(`Unknown routing profile: ${profile}`);
    }
    return costing;
}

// Maps engine-neutral route options to Valhalla costing_options. Only options requested by the
// caller are sent, so engine defaults are not overridden:
// - avoidTolls (auto, motorcycle): use_tolls = 0
// - avoidUnpaved (auto, motorcycle): exclude_unpaved = true / use_trails = 0
// - preferShortest (all profiles): shortest = true
function buildCostingOptions(profile, options = {}) {
    const costing = getCosting(profile);
    const costingOptions = {};
    if (costing === 'auto' || costing === 'motorcycle') {
        if (options.avoidTolls) {
            costingOptions.use_tolls = 0; // eslint-disable-line camelcase
        }
        if (options.avoidUnpaved) {
            if (costing === 'auto') {
                costingOptions.exclude_unpaved = true; // eslint-disable-line camelcase
            } else {
                costingOptions.use_trails = 0; // eslint-disable-line camelcase
            }
        }
    }
    if (options.preferShortest) {
        costingOptions.shortest = true;
    }
    return {[costing]: costingOptions};
}

function buildRouteRequest({points, profile, options}) {
    return {
        locations: points.map(({lat, lng}) => ({lat, lon: lng})),
        costing: getCosting(profile),
        costing_options: buildCostingOptions(profile, options), // eslint-disable-line camelcase
        units: 'kilometers',
    };
}

function buildUrl(baseUrl, request, apiKey) {
    const separator = baseUrl.includes('?') ? '&' : '?';
    let url = `${baseUrl}${separator}json=${encodeURIComponent(JSON.stringify(request))}`;
    if (apiKey) {
        url += `&api_key=${encodeURIComponent(apiKey)}`;
    }
    return url;
}

async function fetchWithTimeout(url, {signal, timeout}) {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeout);
    function abort() {
        controller.abort();
    }
    if (signal) {
        if (signal.aborted) {
            controller.abort();
        } else {
            signal.addEventListener('abort', abort);
        }
    }
    try {
        return await fetch(url, {signal: controller.signal});
    } catch (error) {
        if (timedOut) {
            throw new Error('Routing service request timed out');
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
        if (signal) {
            signal.removeEventListener('abort', abort);
        }
    }
}

function parseTrip(data) {
    const trip = data && data.trip;
    if (!trip || !Array.isArray(trip.legs) || !trip.legs.length) {
        throw new Error((data && data.error) || 'Routing service returned no route');
    }
    const legPoints = trip.legs.map((leg) => decodePolyline(leg.shape || ''));
    let coordinates = [];
    legPoints.forEach((points, index) => {
        coordinates = coordinates.concat(index === 0 ? points : points.slice(1));
    });
    if (!coordinates.length) {
        throw new Error('Routing service returned an empty route');
    }
    const summary = trip.summary;
    if (!summary || typeof summary.length !== 'number' || typeof summary.time !== 'number') {
        throw new Error('Routing service returned no route summary');
    }
    return {
        geometry: {type: 'LineString', coordinates},
        distance: summary.length * 1000,
        duration: summary.time,
    };
}

// Valhalla reports routing failures (no path, distance limit, bad request) with HTTP 400
// and a descriptive error in the body; surface it instead of a bare status code.
async function readErrorMessage(response) {
    if (typeof response.json === 'function') {
        try {
            const data = await response.json();
            if (data && data.error) {
                return data.error;
            }
        } catch {
            // The error response may have no JSON body.
        }
    }
    return `Routing service returned ${response.status}`;
}

class ValhallaProvider {
    constructor(settings = {}) {
        this._url = settings.url;
        this._apiKey = settings.apiKey || null;
        this._timeout = settings.timeout || DEFAULT_TIMEOUT;
    }

    async route({points, profile, options, signal}) {
        if (!this._url) {
            throw new Error('Routing service URL is not configured');
        }
        const request = buildRouteRequest({points, profile, options});
        const response = await fetchWithTimeout(buildUrl(this._url, request, this._apiKey), {
            signal,
            timeout: this._timeout,
        });
        if (!response.ok) {
            throw new Error(await readErrorMessage(response));
        }
        const data = await response.json();
        return parseTrip(data);
    }
}

export {ValhallaProvider, buildCostingOptions, buildRouteRequest};
