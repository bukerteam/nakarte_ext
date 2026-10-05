/* eslint-disable camelcase -- Valhalla request and costing option names are snake_case. */
import {createRoutingProvider, registerRoutingProvider} from '~/lib/routing';
import {decodePolyline} from '~/lib/routing/polyline';
import {PROFILES} from '~/lib/routing/profiles';
import {ValhallaProvider, buildCostingOptions, buildRouteRequest} from '~/lib/routing/valhalla';

function encodeDelta(delta) {
    let value = delta < 0 ? ~(delta << 1) : delta << 1;
    let result = '';
    while (value >= 0x20) {
        result += String.fromCharCode(((value & 0x1f) | 0x20) + 63);
        value >>= 5;
    }
    return result + String.fromCharCode(value + 63);
}

function encodePolyline(coordinates) {
    let lat = 0;
    let lng = 0;
    let shape = '';
    coordinates.forEach(([pointLng, pointLat]) => {
        const nextLat = Math.round(pointLat * 1e6);
        const nextLng = Math.round(pointLng * 1e6);
        shape += encodeDelta(nextLat - lat);
        shape += encodeDelta(nextLng - lng);
        lat = nextLat;
        lng = nextLng;
    });
    return shape;
}

function stubFetch(handler) {
    const originalFetch = window.fetch;
    window.fetch = handler;
    return () => {
        window.fetch = originalFetch;
    };
}

function abortableFetchStub() {
    return function (_unusedUrl, options) {
        return new Promise((_unusedResolve, reject) => {
            options.signal.addEventListener('abort', () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
            });
        });
    };
}

const TEST_POINTS = [
    {lat: 55.1, lng: 37.2},
    {lat: 55.3, lng: 37.4},
];

suite('Routing polyline decoder');

test('decodes an empty shape', function () {
    assert.deepEqual(decodePolyline(''), []);
});

test('decodes hand-encoded deltas', function () {
    assert.deepEqual(decodePolyline('AA'), [[0.000001, 0.000001]]);
    assert.deepEqual(decodePolyline('@@'), [[-0.000001, -0.000001]]);
    assert.deepEqual(decodePolyline('AAAA'), [
        [0.000001, 0.000001],
        [0.000002, 0.000002],
    ]);
});

test('round-trips coordinates', function () {
    const coordinates = [
        [37.6173, 55.7558],
        [37.62, 55.76],
        [-0.1276, 51.5072],
    ];
    assert.deepEqual(decodePolyline(encodePolyline(coordinates)), coordinates);
});

suite('Valhalla routing request');

test('builds a request with neutral options mapped to costing options', function () {
    const request = buildRouteRequest({
        points: TEST_POINTS,
        profile: 'driving',
        options: {avoidTolls: true, avoidUnpaved: true, preferShortest: true},
    });
    assert.deepEqual(request.locations, [
        {lat: 55.1, lon: 37.2},
        {lat: 55.3, lon: 37.4},
    ]);
    assert.equal(request.costing, 'auto');
    assert.equal(request.units, 'kilometers');
    assert.deepEqual(request.costing_options, {
        auto: {use_tolls: 0, exclude_unpaved: true, shortest: true},
    });
});

PROFILES.forEach(({id}) => {
    test(`builds a request for profile ${id}`, function () {
        const request = buildRouteRequest({points: TEST_POINTS, profile: id, options: {}});
        assert.isString(request.costing);
        assert.deepEqual(request.costing_options, {[request.costing]: {}});
    });
});

suite('Valhalla costing options');

[
    ['driving', {}, {auto: {}}],
    ['driving', {avoidTolls: true}, {auto: {use_tolls: 0}}],
    ['driving', {avoidUnpaved: true}, {auto: {exclude_unpaved: true}}],
    ['driving', {preferShortest: true}, {auto: {shortest: true}}],
    ['motorcycle', {}, {motorcycle: {}}],
    ['motorcycle', {avoidTolls: true, avoidUnpaved: true}, {motorcycle: {use_tolls: 0, use_trails: 0}}],
    ['cycling', {avoidTolls: true, avoidUnpaved: true}, {bicycle: {}}],
    ['cycling', {preferShortest: true}, {bicycle: {shortest: true}}],
    ['walking', {avoidTolls: true}, {pedestrian: {}}],
    ['walking', {preferShortest: true}, {pedestrian: {shortest: true}}],
].forEach(([profile, options, expected]) => {
    test(`maps ${profile} options to Valhalla costing`, function () {
        assert.deepEqual(buildCostingOptions(profile, options), expected);
    });
});

test('rejects an unknown profile', function () {
    assert.throws(() => buildCostingOptions('flying'), /Unknown routing profile/u);
});

suite('Valhalla routing provider');

test('requests a route and returns engine-neutral geometry', async function () {
    let requestedUrl = null;
    const restoreFetch = stubFetch(async function (url) {
        requestedUrl = url;
        return {
            ok: true,
            json: async function () {
                return {
                    trip: {
                        summary: {length: 1.234, time: 567},
                        legs: [{shape: 'AA'}, {shape: 'AAAA'}],
                    },
                };
            },
        };
    });
    try {
        const provider = new ValhallaProvider({url: 'https://routing.example/route'});
        const route = await provider.route({
            points: TEST_POINTS,
            profile: 'driving',
            options: {avoidTolls: true},
        });
        assert.deepEqual(route.geometry, {
            type: 'LineString',
            coordinates: [
                [0.000001, 0.000001],
                [0.000002, 0.000002],
            ],
        });
        assert.equal(route.distance, 1234);
        assert.equal(route.duration, 567);
        assert.include(requestedUrl, 'https://routing.example/route?json=');
        const request = JSON.parse(decodeURIComponent(requestedUrl.split('json=')[1]));
        assert.deepEqual(request.locations, [
            {lat: 55.1, lon: 37.2},
            {lat: 55.3, lon: 37.4},
        ]);
        assert.equal(request.costing, 'auto');
        assert.deepEqual(request.costing_options, {auto: {use_tolls: 0}});
    } finally {
        restoreFetch();
    }
});

test('appends an api key when configured', async function () {
    let requestedUrl = null;
    const restoreFetch = stubFetch(async function (url) {
        requestedUrl = url;
        return {
            ok: true,
            json: async function () {
                return {
                    trip: {
                        summary: {length: 1, time: 60},
                        legs: [{shape: 'AA'}],
                    },
                };
            },
        };
    });
    try {
        const provider = new ValhallaProvider({url: 'https://routing.example/route', apiKey: 'secret key'});
        await provider.route({points: TEST_POINTS, profile: 'walking', options: {}});
        assert.include(requestedUrl, '&api_key=secret%20key');
    } finally {
        restoreFetch();
    }
});

test('throws when the service responds with an error status', async function () {
    const restoreFetch = stubFetch(async function () {
        return {ok: false, status: 503};
    });
    try {
        const provider = new ValhallaProvider({url: 'https://routing.example/route'});
        let caughtError = null;
        try {
            await provider.route({points: TEST_POINTS, profile: 'driving', options: {}});
        } catch (error) {
            caughtError = error;
        }
        assert.instanceOf(caughtError, Error);
        assert.include(caughtError.message, '503');
    } finally {
        restoreFetch();
    }
});

test('surfaces the service error message from an error response', async function () {
    const restoreFetch = stubFetch(async function () {
        return {
            ok: false,
            status: 400,
            json: async function () {
                return {error: 'Path distance exceeds the max distance limit: 150000 meters'};
            },
        };
    });
    try {
        const provider = new ValhallaProvider({url: 'https://routing.example/route'});
        let caughtError = null;
        try {
            await provider.route({points: TEST_POINTS, profile: 'cycling', options: {}});
        } catch (error) {
            caughtError = error;
        }
        assert.instanceOf(caughtError, Error);
        assert.include(caughtError.message, 'max distance limit');
    } finally {
        restoreFetch();
    }
});

test('throws when the service reports a routing error', async function () {
    const restoreFetch = stubFetch(async function () {
        return {
            ok: true,
            json: async function () {
                return {error: 'No path could be found between the locations'};
            },
        };
    });
    try {
        const provider = new ValhallaProvider({url: 'https://routing.example/route'});
        let caughtError = null;
        try {
            await provider.route({points: TEST_POINTS, profile: 'driving', options: {}});
        } catch (error) {
            caughtError = error;
        }
        assert.instanceOf(caughtError, Error);
        assert.include(caughtError.message, 'No path could be found');
    } finally {
        restoreFetch();
    }
});

test('throws when the route is empty', async function () {
    const restoreFetch = stubFetch(async function () {
        return {
            ok: true,
            json: async function () {
                return {
                    trip: {
                        summary: {length: 0, time: 0},
                        legs: [{shape: ''}],
                    },
                };
            },
        };
    });
    try {
        const provider = new ValhallaProvider({url: 'https://routing.example/route'});
        let caughtError = null;
        try {
            await provider.route({points: TEST_POINTS, profile: 'driving', options: {}});
        } catch (error) {
            caughtError = error;
        }
        assert.instanceOf(caughtError, Error);
        assert.include(caughtError.message, 'empty route');
    } finally {
        restoreFetch();
    }
});

test('throws when the route summary is missing', async function () {
    const restoreFetch = stubFetch(async function () {
        return {
            ok: true,
            json: async function () {
                return {trip: {legs: [{shape: 'AA'}]}};
            },
        };
    });
    try {
        const provider = new ValhallaProvider({url: 'https://routing.example/route'});
        let caughtError = null;
        try {
            await provider.route({points: TEST_POINTS, profile: 'driving', options: {}});
        } catch (error) {
            caughtError = error;
        }
        assert.instanceOf(caughtError, Error);
        assert.include(caughtError.message, 'no route summary');
    } finally {
        restoreFetch();
    }
});

test('times out a hanging request', async function () {
    const restoreFetch = stubFetch(abortableFetchStub());
    try {
        const provider = new ValhallaProvider({url: 'https://routing.example/route', timeout: 20});
        let caughtError = null;
        try {
            await provider.route({points: TEST_POINTS, profile: 'driving', options: {}});
        } catch (error) {
            caughtError = error;
        }
        assert.instanceOf(caughtError, Error);
        assert.include(caughtError.message, 'timed out');
    } finally {
        restoreFetch();
    }
});

test('forwards an abort from the caller', async function () {
    const restoreFetch = stubFetch(abortableFetchStub());
    try {
        const provider = new ValhallaProvider({url: 'https://routing.example/route', timeout: 5000});
        const controller = new AbortController();
        const promise = provider.route({
            points: TEST_POINTS,
            profile: 'driving',
            options: {},
            signal: controller.signal,
        });
        controller.abort();
        let caughtError = null;
        try {
            await promise;
        } catch (error) {
            caughtError = error;
        }
        assert.instanceOf(caughtError, Error);
        assert.equal(caughtError.name, 'AbortError');
    } finally {
        restoreFetch();
    }
});

suite('Routing provider factory');

test('creates the configured provider', function () {
    const provider = createRoutingProvider({provider: 'valhalla', url: 'https://routing.example/route'});
    assert.instanceOf(provider, ValhallaProvider);
});

test('rejects an unknown provider', function () {
    assert.throws(() => createRoutingProvider({provider: 'osrm'}), /Unknown routing provider/u);
});

test('creates a registered provider', function () {
    class StubProvider {
        constructor(settings) {
            this.settings = settings;
        }
    }
    registerRoutingProvider('stub', StubProvider);
    const provider = createRoutingProvider({provider: 'stub', url: 'https://routing.example/route'});
    assert.instanceOf(provider, StubProvider);
    assert.equal(provider.settings.url, 'https://routing.example/route');
});
