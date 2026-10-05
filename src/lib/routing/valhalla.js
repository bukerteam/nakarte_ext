import {decodePolyline} from './polyline';

// Application-level profile names mapped to Valhalla costing models.
const PROFILES = {
    driving: 'auto',
    cycling: 'bicycle',
    motorcycle: 'motorcycle',
    walking: 'pedestrian',
};

function getCosting(profile) {
    const costing = PROFILES[profile];
    if (!costing) {
        throw new Error(`Unknown routing profile: ${profile}`);
    }
    return costing;
}

// Maps engine-neutral route options to Valhalla costing_options.
// Dynamic costing (use_roads, use_hills, avoid_bad_surfaces, bicycle_type, shortest/use_distance)
// is the main lever against absurd detours.
function buildCostingOptions(profile, options = {}) {
    const costing = getCosting(profile);
    const costingOptions = {};
    if (costing === 'auto') {
        costingOptions.use_tolls = options.avoidTolls ? 0 : 0.5; // eslint-disable-line camelcase
        costingOptions.exclude_unpaved = Boolean(options.avoidUnpaved); // eslint-disable-line camelcase
    } else if (costing === 'motorcycle') {
        costingOptions.use_tolls = options.avoidTolls ? 0 : 0.5; // eslint-disable-line camelcase
        costingOptions.use_trails = options.avoidUnpaved ? 0 : 0.5; // eslint-disable-line camelcase
    }
    if (costing === 'auto' || costing === 'motorcycle' || costing === 'bicycle') {
        if (options.useRoads !== undefined) {
            costingOptions.use_roads = options.useRoads; // eslint-disable-line camelcase
        }
        if (options.useHills !== undefined) {
            costingOptions.use_hills = options.useHills; // eslint-disable-line camelcase
        }
        if (options.preferShortest) {
            if (costing === 'bicycle') {
                costingOptions.use_distance = 1; // eslint-disable-line camelcase
            } else {
                costingOptions.shortest = true;
            }
        }
    }
    if (costing === 'bicycle') {
        if (options.avoidBadSurfaces !== undefined) {
            costingOptions.avoid_bad_surfaces = options.avoidBadSurfaces; // eslint-disable-line camelcase
        }
        if (options.bicycleType) {
            costingOptions.bicycle_type = options.bicycleType; // eslint-disable-line camelcase
        }
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
    const summary = trip.summary || {};
    return {
        geometry: {type: 'LineString', coordinates},
        distance: summary.length * 1000,
        duration: summary.time,
    };
}

class ValhallaProvider {
    constructor(settings = {}) {
        this._url = settings.url;
        this._apiKey = settings.apiKey || null;
    }

    async route({points, profile, options, signal}) {
        if (!this._url) {
            throw new Error('Routing service URL is not configured');
        }
        const request = buildRouteRequest({points, profile, options});
        const response = await fetch(buildUrl(this._url, request, this._apiKey), {signal});
        if (!response.ok) {
            throw new Error(`Routing service returned ${response.status}`);
        }
        const data = await response.json();
        return parseTrip(data);
    }
}

export {ValhallaProvider, buildCostingOptions, buildRouteRequest};
