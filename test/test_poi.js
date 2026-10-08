/* eslint-disable camelcase -- OSM tag keys are snake_case */
import L from 'leaflet';

import enablePoi, {PoiPanelModel} from '~/lib/leaflet.control.layers.poi';
import {PoiLayer} from '~/lib/leaflet.layer.poi';
import {matchCategory, getCategory, poiCategories, poiGroups} from '~/lib/leaflet.layer.poi/categories';
import {getIconUrl} from '~/lib/leaflet.layer.poi/icons';
import {getPoiName, getPoiOsmUrl, buildPoiPopupHtml, buildClusterPopupHtml} from '~/lib/leaflet.layer.poi/poi';
import * as overpass from '~/lib/overpass';
import {getEffectiveKey, getUserKey, setUserKey, getSiteKey} from '~/lib/overpass/key';
import safeLocalStorage from '~/lib/safe-localstorage';

suite('Overpass query builder');

test('builds a union query with bbox in south,west,north,east order', function () {
    const query = overpass.buildOverpassQuery([{amenity: 'drinking_water'}], [1, 2, 3, 4]);
    assert.equal(
        query,
        '[out:json][timeout:25];(nwr["amenity"="drinking_water"](1.00000,2.00000,3.00000,4.00000););out center 2000;'
    );
});

test('uses a regex for multiple tag values', function () {
    const query = overpass.buildOverpassQuery([{shop: ['cafe', 'bar']}], [0, 0, 1, 1]);
    assert.include(query, 'nwr["shop"~"^(cafe|bar)$"](0.00000,0.00000,1.00000,1.00000);');
});

test('ANDs tag conditions inside a filter and ORs filters', function () {
    const query = overpass.buildOverpassQuery(
        [{'man_made': 'tower', 'tower:type': 'communication'}, {amenity: 'shelter'}],
        [0, 0, 1, 1]
    );
    assert.include(query, 'nwr["man_made"="tower"]["tower:type"="communication"](0.00000,0.00000,1.00000,1.00000);');
    assert.include(query, 'nwr["amenity"="shelter"](0.00000,0.00000,1.00000,1.00000);');
});

test('escapes quotes in tag values', function () {
    const query = overpass.buildOverpassQuery([{name: 'a"b'}], [0, 0, 1, 1]);
    assert.include(query, '["name"="a\\"b"]');
});

test('respects the points limit', function () {
    const query = overpass.buildOverpassQuery([{amenity: 'bench'}], [0, 0, 1, 1], {maxPoints: 10});
    assert.include(query, 'out center 10;');
});

suite('Overpass response parsing');

test('parses nodes and ways with center', function () {
    const data = {
        elements: [
            {type: 'node', id: 1, lat: 10, lon: 20, tags: {amenity: 'spring'}},
            {type: 'way', id: 2, center: {lat: 11, lon: 21}, tags: {amenity: 'shelter'}},
            {type: 'way', id: 3, tags: {}},
            {type: 'relation', id: 4, center: {lat: 12, lon: 22}},
        ],
    };
    assert.deepEqual(overpass.parseOverpassResponse(data), [
        {type: 'node', id: 1, lat: 10, lon: 20, tags: {amenity: 'spring'}},
        {type: 'way', id: 2, lat: 11, lon: 21, tags: {amenity: 'shelter'}},
        {type: 'relation', id: 4, lat: 12, lon: 22, tags: {}},
    ]);
});

test('handles missing elements', function () {
    assert.deepEqual(overpass.parseOverpassResponse({}), []);
});

suite('POI catalog');

test('category ids are unique', function () {
    const seen = new Set();
    const duplicates = new Set();
    for (const category of poiCategories) {
        if (seen.has(category.id)) {
            duplicates.add(category.id);
        }
        seen.add(category.id);
    }
    assert.isEmpty(Array.from(duplicates));
});

test('every group has categories with non-empty filters', function () {
    for (const group of poiGroups) {
        assert.isNotEmpty(group.categories, `group ${group.id}`);
        for (const category of group.categories) {
            assert.isNotEmpty(category.filters, `filters of ${category.id}`);
            assert.isNotEmpty(category.titleRu, `titleRu of ${category.id}`);
            assert.isNotEmpty(category.titleEn, `titleEn of ${category.id}`);
            assert.isNumber(category.minZoom, `minZoom of ${category.id}`);
            for (const filter of category.filters) {
                assert.isNotEmpty(Object.keys(filter), `filter of ${category.id}`);
            }
        }
    }
});

test('every referenced icon resolves to a bundled image', function () {
    for (const category of poiCategories) {
        assert.match(getIconUrl(category.icon), /^data:image\/svg\+xml/u, `icon of ${category.id}`);
    }
});

test('unknown icons fall back to the generic marker', function () {
    assert.match(getIconUrl('carto:does/not/exist.svg'), /^data:image\/svg\+xml/u);
    assert.match(getIconUrl(null), /^data:image\/svg\+xml/u);
});

test('matchCategory picks the most specific matching filter', function () {
    const tower = getCategory('tower');
    const communications = getCategory('communications_tower');
    assert.equal(matchCategory({man_made: 'tower'}, [tower, communications]), tower);
    assert.equal(
        matchCategory({'man_made': 'tower', 'tower:type': 'communication'}, [tower, communications]),
        communications
    );
    assert.equal(matchCategory({amenity: 'bench'}, [tower, communications]), null);
});

test('matchCategory supports multiple values', function () {
    const cafe = getCategory('cafe');
    const restaurant = getCategory('restaurant');
    assert.equal(matchCategory({amenity: 'fast_food'}, [cafe, restaurant]), restaurant);
    assert.equal(matchCategory({amenity: 'cafe'}, [cafe, restaurant]), cafe);
});

suite('POI popup helpers');

test('poi name prefers name:ru, then name, then name:en', function () {
    assert.equal(getPoiName({'name:ru': 'Родник', 'name': 'Spring', 'name:en': 'Spring EN'}), 'Родник');
    assert.equal(getPoiName({'name': 'Spring', 'name:en': 'Spring EN'}), 'Spring');
    assert.equal(getPoiName({'name:en': 'Spring EN'}), 'Spring EN');
    assert.isNull(getPoiName({}));
});

test('osm url uses the element type and id', function () {
    assert.equal(getPoiOsmUrl({type: 'node', id: 42}), 'https://www.openstreetmap.org/node/42');
    assert.equal(getPoiOsmUrl({type: 'way', id: 7}), 'https://www.openstreetmap.org/way/7');
});

test('popup html escapes tag values', function () {
    const category = getCategory('spring');
    const html = buildPoiPopupHtml({type: 'node', id: 1, tags: {name: '<script>', operator: 'a&b'}}, category);
    assert.include(html, '&lt;script&gt;');
    assert.include(html, 'a&amp;b');
    assert.include(html, 'https://www.openstreetmap.org/node/1');
    assert.include(html, 'OpenStreetMap contributors');
});

test('cluster popup escapes poi names and localizes the title', function () {
    const category = getCategory('spring');
    const html = buildClusterPopupHtml({
        markers: [
            {properties: {poi: {type: 'node', id: 1, tags: {name: '<script>'}}, category}},
            {properties: {poi: {type: 'node', id: 2, tags: {name: 'A&B'}}, category}},
        ],
    });
    assert.include(html, '&lt;script&gt;');
    assert.include(html, 'A&amp;B');
    assert.match(html, /Точек|points/u);
});

suite('POI layer marker clicks');

function makeLayerWithStubbedMap() {
    const layer = new PoiLayer('http://example.com/');
    const calls = {fitBounds: 0, openPopup: 0};
    layer._map = {
        fitBounds: () => {
            calls.fitBounds += 1;
        },
        openPopup: () => {
            calls.openPopup += 1;
        },
        getMaxZoom: () => 18,
    };
    return {layer, calls};
}

function makeClusterMarker(bounds) {
    const category = getCategory('spring');
    return {
        latlng: L.latLng(50, 30),
        _cluster: {
            count: 2,
            markers: [
                {properties: {poi: {type: 'node', id: 1, tags: {}}, category}},
                {properties: {poi: {type: 'node', id: 2, tags: {}}, category}},
            ],
            bounds,
        },
    };
}

test('click on a cluster fits its bounds', function () {
    const {layer, calls} = makeLayerWithStubbedMap();
    layer._onMarkerClick({marker: makeClusterMarker(L.latLngBounds([50, 30], [50.001, 30.001]))});
    assert.equal(calls.fitBounds, 1);
    assert.equal(calls.openPopup, 0);
});

test('click on a cluster with coincident points opens the list popup', function () {
    const {layer, calls} = makeLayerWithStubbedMap();
    layer._onMarkerClick({marker: makeClusterMarker(L.latLngBounds([50, 30], [50, 30]))});
    assert.equal(calls.fitBounds, 0);
    assert.equal(calls.openPopup, 1);
});

test('click on a point opens its popup', function () {
    const {layer, calls} = makeLayerWithStubbedMap();
    const category = getCategory('spring');
    layer._onMarkerClick({
        marker: {
            latlng: L.latLng(50, 30),
            properties: {poi: {type: 'node', id: 1, tags: {name: 'Spring'}}, category},
        },
    });
    assert.equal(calls.openPopup, 1);
    assert.equal(calls.fitBounds, 0);
});

suite('CanvasMarkers clustering');

function makeClusteringLayer(options) {
    const layer = new PoiLayer('http://example.com/', options);
    layer._map = {
        getCenter: () => L.latLng(0, 0),
        project: (latlng) => ({x: latlng.lng * 1000, y: latlng.lat * 1000}),
        unproject: (point) => L.latLng(point.y / 1000, point.x / 1000),
    };
    return layer;
}

test('nearby markers are merged into a cluster with a count', function () {
    const layer = makeClusteringLayer({clustering: true, maxClusterRadius: 50});
    layer.rtree.load([{latlng: L.latLng(0, 0)}, {latlng: L.latLng(0.0001, 0.0001)}, {latlng: L.latLng(10, 10)}]);
    layer.invalidateDisplayMarkers();
    const display = layer.getDisplayRtree(13).all();
    const clusters = display.filter((marker) => marker._cluster);
    assert.lengthOf(clusters, 1);
    assert.equal(clusters[0]._cluster.count, 2);
    assert.lengthOf(clusters[0]._cluster.markers, 2);
    assert.lengthOf(display, 2);
});

test('a cluster takes the prevailing icon of its members', function () {
    const layer = makeClusteringLayer({clustering: true, maxClusterRadius: 50});
    layer.rtree.load([
        {latlng: L.latLng(0, 0), icon: {url: 'tent'}},
        {latlng: L.latLng(0.0001, 0.0001), icon: {url: 'tent'}},
        {latlng: L.latLng(0.0002, 0.0002), icon: {url: 'spring'}},
    ]);
    layer.invalidateDisplayMarkers();
    const cluster = layer
        .getDisplayRtree(13)
        .all()
        .find((marker) => marker._cluster);
    assert.equal(cluster.icon.url, 'tent');
});

test('the layer draws icons on a white background', function () {
    const layer = new PoiLayer('http://example.com/');
    assert.isTrue(layer.options.iconBackground);
    assert.isTrue(layer.options.clustering);
});

test('clustering is disabled at the configured zoom', function () {
    const layer = makeClusteringLayer({clustering: true, maxClusterRadius: 50, disableClusterAtZoom: 17});
    layer.rtree.load([{latlng: L.latLng(0, 0)}, {latlng: L.latLng(0.0001, 0.0001)}]);
    layer.invalidateDisplayMarkers();
    const display = layer.getDisplayRtree(17).all();
    assert.lengthOf(display, 2);
    assert.isFalse(display.some((marker) => marker._cluster));
});

test('clustering is off when the option is disabled', function () {
    const layer = makeClusteringLayer({clustering: false});
    layer.rtree.load([{latlng: L.latLng(0, 0)}, {latlng: L.latLng(0.0001, 0.0001)}]);
    layer.invalidateDisplayMarkers();
    const display = layer.getDisplayRtree(13).all();
    assert.lengthOf(display, 2);
});

test('markers on both sides of the antimeridian are clustered together', function () {
    const layer = makeClusteringLayer({clustering: true, maxClusterRadius: 50});
    layer._map = {
        getCenter: () => L.latLng(0, 180),
        project: (latlng) => ({x: (latlng.lng - 180) * 1000, y: latlng.lat * 1000}),
        unproject: (point) => L.latLng(point.y / 1000, point.x / 1000 + 180),
    };
    layer.rtree.load([{latlng: L.latLng(0, 179.9999)}, {latlng: L.latLng(0, -179.9999)}]);
    layer.invalidateDisplayMarkers();
    const display = layer.getDisplayRtree(13).all();
    assert.lengthOf(display, 1);
    assert.equal(display[0]._cluster.count, 2);
    const bounds = display[0]._cluster.bounds;
    assert.isBelow(bounds.getEast() - bounds.getWest(), 1);
});

suite('Overpass client');

test('aborted request is not reused for a repeated query', async function () {
    // babel-plugin-rewire exposes __get__/__set__ in testing builds
    // eslint-disable-next-line global-require
    const overpassRewire = require('~/lib/overpass');
    const originalFetch = overpassRewire.__get__('fetch');
    let fetchCalls = 0;
    overpassRewire.__set__('fetch', () => {
        fetchCalls += 1;
        const promise = new Promise(() => {
            // never settles, emulates a request in flight
        });
        promise.abort = () => {
            // emulate the abort of xhr-promise, the promise stays pending
        };
        return promise;
    });
    try {
        const client = new overpass.OverpassClient('http://example.com/');
        const request1 = client.query('q');
        request1.abort();
        const request2 = client.query('q');
        assert.notStrictEqual(request1, request2);
        assert.equal(fetchCalls, 2);
    } finally {
        overpassRewire.__set__('fetch', originalFetch);
    }
});

test('small responses are cached', async function () {
    // eslint-disable-next-line global-require
    const overpassRewire = require('~/lib/overpass');
    const originalFetch = overpassRewire.__get__('fetch');
    let fetchCalls = 0;
    overpassRewire.__set__('fetch', () => {
        fetchCalls += 1;
        const promise = Promise.resolve({responseJSON: {elements: [{type: 'node', id: 1, lat: 0, lon: 0}]}});
        promise.abort = () => {
            // emulate the abort of xhr-promise
        };
        return promise;
    });
    try {
        const client = new overpass.OverpassClient('http://example.com/');
        await client.query('q').promise;
        await client.query('q').promise;
        assert.equal(fetchCalls, 1);
    } finally {
        overpassRewire.__set__('fetch', originalFetch);
    }
});

test('huge responses are not kept in the cache', async function () {
    // eslint-disable-next-line global-require
    const overpassRewire = require('~/lib/overpass');
    const originalFetch = overpassRewire.__get__('fetch');
    let fetchCalls = 0;
    const elements = Array.from({length: 1001}, (_unused, i) => ({type: 'node', id: i, lat: 0, lon: 0}));
    overpassRewire.__set__('fetch', () => {
        fetchCalls += 1;
        const promise = Promise.resolve({responseJSON: {elements}});
        promise.abort = () => {
            // emulate the abort of xhr-promise
        };
        return promise;
    });
    try {
        const client = new overpass.OverpassClient('http://example.com/');
        await client.query('q').promise;
        await client.query('q').promise;
        assert.equal(fetchCalls, 2);
    } finally {
        overpassRewire.__set__('fetch', originalFetch);
    }
});

function makeMemoryStorage() {
    const store = {};
    return {
        getItem: (key) => (key in store ? store[key] : null),
        setItem: (key, value) => {
            store[key] = String(value);
        },
        removeItem: (key) => {
            delete store[key];
        },
    };
}

test('reuses responses from the storage after a reload', async function () {
    // eslint-disable-next-line global-require
    const overpassRewire = require('~/lib/overpass');
    const originalFetch = overpassRewire.__get__('fetch');
    let fetchCalls = 0;
    overpassRewire.__set__('fetch', () => {
        fetchCalls += 1;
        const promise = Promise.resolve({responseJSON: {elements: [{type: 'node', id: 1, lat: 0, lon: 0}]}});
        promise.abort = () => {
            // emulate the abort of xhr-promise
        };
        return promise;
    });
    const storage = makeMemoryStorage();
    try {
        const client1 = new overpass.OverpassClient('http://example.com/', {cacheStorage: storage});
        await client1.query('q').promise;
        assert.equal(fetchCalls, 1);
        // a new client, as after a page reload
        const client2 = new overpass.OverpassClient('http://example.com/', {cacheStorage: storage});
        const data = await client2.query('q').promise;
        assert.equal(fetchCalls, 1);
        assert.lengthOf(data.elements, 1);
    } finally {
        overpassRewire.__set__('fetch', originalFetch);
    }
});

test('ignores expired responses from the storage', async function () {
    // eslint-disable-next-line global-require
    const overpassRewire = require('~/lib/overpass');
    const originalFetch = overpassRewire.__get__('fetch');
    let fetchCalls = 0;
    overpassRewire.__set__('fetch', () => {
        fetchCalls += 1;
        const promise = Promise.resolve({responseJSON: {elements: []}});
        promise.abort = () => {
            // emulate the abort of xhr-promise
        };
        return promise;
    });
    const storage = makeMemoryStorage();
    storage.setItem(
        'overpassResponseCache',
        JSON.stringify([{query: 'q', time: Date.now() - 11 * 60 * 1000, data: {elements: [{type: 'node', id: 1}]}}])
    );
    try {
        const client = new overpass.OverpassClient('http://example.com/', {cacheStorage: storage});
        await client.query('q').promise;
        assert.equal(fetchCalls, 1);
    } finally {
        overpassRewire.__set__('fetch', originalFetch);
    }
});

test('drops expired responses from the storage right away', function () {
    const storage = makeMemoryStorage();
    storage.setItem(
        'overpassResponseCache',
        JSON.stringify([
            {query: 'old', time: Date.now() - 11 * 60 * 1000, data: {elements: []}},
            {query: 'fresh', time: Date.now(), data: {elements: []}},
        ])
    );
    const client = new overpass.OverpassClient('http://example.com/', {cacheStorage: storage});
    assert.isOk(client);
    const stored = JSON.parse(storage.getItem('overpassResponseCache'));
    assert.deepEqual(
        stored.map((entry) => entry.query),
        ['fresh']
    );
});

test('falls back to the next endpoint and remembers it', async function () {
    // eslint-disable-next-line global-require
    const overpassRewire = require('~/lib/overpass');
    const originalFetch = overpassRewire.__get__('fetch');
    const calls = [];
    overpassRewire.__set__('fetch', (url) => {
        calls.push(url);
        if (url === 'http://a/') {
            const promise = Promise.reject(Object.assign(new Error('network'), {xhr: {status: 0}}));
            promise.abort = () => {
                // emulate the abort of xhr-promise
            };
            return promise;
        }
        const promise = Promise.resolve({responseJSON: {elements: []}});
        promise.abort = () => {
            // emulate the abort of xhr-promise
        };
        return promise;
    });
    try {
        const client = new overpass.OverpassClient(['http://a/', 'http://b/'], {retryDelays: [0]});
        await client.query('q').promise;
        assert.deepEqual(calls, ['http://a/', 'http://b/']);
        assert.equal(client.getActiveUrl(), 'http://b/');
        await client.query('q2').promise;
        assert.deepEqual(calls, ['http://a/', 'http://b/', 'http://b/']);
    } finally {
        overpassRewire.__set__('fetch', originalFetch);
    }
});

test('prefers the remembered endpoint', function () {
    assert.deepEqual(overpass.orderOverpassUrls(['http://a/', 'http://b/'], 'http://b/'), ['http://b/', 'http://a/']);
    assert.deepEqual(overpass.orderOverpassUrls(['http://a/', 'http://b/'], 'http://c/'), ['http://a/', 'http://b/']);
    assert.deepEqual(overpass.orderOverpassUrls(['http://a/', 'http://b/'], null), ['http://a/', 'http://b/']);
});

test('reports the working endpoint to the caller', async function () {
    // eslint-disable-next-line global-require
    const overpassRewire = require('~/lib/overpass');
    const originalFetch = overpassRewire.__get__('fetch');
    const workingUrls = [];
    overpassRewire.__set__('fetch', (url) => {
        if (url === 'http://a/') {
            const promise = Promise.reject(Object.assign(new Error('network'), {xhr: {status: 0}}));
            promise.abort = () => {
                // emulate the abort of xhr-promise
            };
            return promise;
        }
        const promise = Promise.resolve({responseJSON: {elements: []}});
        promise.abort = () => {
            // emulate the abort of xhr-promise
        };
        return promise;
    });
    try {
        const client = new overpass.OverpassClient(['http://a/', 'http://b/'], {
            retryDelays: [0],
            onWorkingUrlChange: (url) => workingUrls.push(url),
        });
        await client.query('q').promise;
        assert.deepEqual(workingUrls, ['http://b/']);
        await client.query('q2').promise;
        assert.deepEqual(workingUrls, ['http://b/']);
    } finally {
        overpassRewire.__set__('fetch', originalFetch);
    }
});

test('retries the same endpoint on server errors', async function () {
    // eslint-disable-next-line global-require
    const overpassRewire = require('~/lib/overpass');
    const originalFetch = overpassRewire.__get__('fetch');
    const calls = [];
    overpassRewire.__set__('fetch', (url) => {
        calls.push(url);
        if (calls.length === 1) {
            const promise = Promise.reject(Object.assign(new Error('gateway'), {xhr: {status: 504}}));
            promise.abort = () => {
                // emulate the abort of xhr-promise
            };
            return promise;
        }
        const promise = Promise.resolve({responseJSON: {elements: []}});
        promise.abort = () => {
            // emulate the abort of xhr-promise
        };
        return promise;
    });
    try {
        const client = new overpass.OverpassClient(['http://a/', 'http://b/'], {retryDelays: [0]});
        await client.query('q').promise;
        assert.deepEqual(calls, ['http://a/', 'http://a/']);
    } finally {
        overpassRewire.__set__('fetch', originalFetch);
    }
});

test('switches the endpoint after repeated server errors', async function () {
    // eslint-disable-next-line global-require
    const overpassRewire = require('~/lib/overpass');
    const originalFetch = overpassRewire.__get__('fetch');
    const calls = [];
    overpassRewire.__set__('fetch', (url) => {
        calls.push(url);
        if (url === 'http://a/') {
            const promise = Promise.reject(Object.assign(new Error('gateway'), {xhr: {status: 504}}));
            promise.abort = () => {
                // emulate the abort of xhr-promise
            };
            return promise;
        }
        const promise = Promise.resolve({responseJSON: {elements: []}});
        promise.abort = () => {
            // emulate the abort of xhr-promise
        };
        return promise;
    });
    try {
        const client = new overpass.OverpassClient(['http://a/', 'http://b/'], {retryDelays: [0, 0]});
        await client.query('q').promise;
        assert.deepEqual(calls, ['http://a/', 'http://a/', 'http://b/']);
    } finally {
        overpassRewire.__set__('fetch', originalFetch);
    }
});

suite('POI layer updates');

function makeStubMap(bounds) {
    return {
        getZoom: () => 13,
        getBounds: () => bounds ?? L.latLngBounds([49.7, 33.4], [49.8, 33.5]),
    };
}

function makeStubClient(response) {
    const queries = [];
    return {
        queries,
        query: (queryString) => {
            queries.push(queryString);
            return {
                promise: Promise.resolve(response),
                abort: () => {
                    // emulate the abort of xhr-promise
                },
            };
        },
    };
}

function makeUpdateLayer(options = {}) {
    const layer = new PoiLayer('http://example.com/', options);
    layer.redraw = () => {
        // do not touch the real tiles in tests
    };
    layer._map = makeStubMap();
    return layer;
}

test('update does not refetch when the view is covered by loaded data', async function () {
    const layer = makeUpdateLayer();
    layer._client = makeStubClient({elements: []});
    layer._loadedBounds = L.latLngBounds([49.6, 33.3], [49.9, 33.6]);
    layer._loadedCategoryIds = new Set(['spring']);
    layer._loadedPois = [];
    layer._categoryIds = ['spring'];
    const states = [];
    layer.on('loadstate', (e) => states.push(e.state));
    await layer.update();
    assert.lengthOf(layer._client.queries, 0);
    assert.include(states, 'loaded');
});

test('truncated data is not treated as covering the view', async function () {
    const layer = makeUpdateLayer();
    layer._client = makeStubClient({elements: []});
    layer._loadedBounds = L.latLngBounds([49.6, 33.3], [49.9, 33.6]);
    layer._loadedCategoryIds = new Set(['spring']);
    layer._loadedPois = [];
    layer._truncated = true;
    layer._categoryIds = ['spring'];
    await layer.update();
    assert.lengthOf(layer._client.queries, 1);
    assert.isFalse(layer._truncated);
});

test('hitting the points limit marks the data as truncated', async function () {
    const layer = makeUpdateLayer({maxPoints: 3});
    const elements = [1, 2, 3].map((id) => ({
        type: 'node',
        id,
        lat: 49.7,
        lon: 33.4,
        tags: {natural: 'spring'},
    }));
    layer._client = makeStubClient({elements});
    layer._categoryIds = ['spring'];
    const states = [];
    layer.on('loadstate', (e) => states.push(e.state));
    await layer.update();
    assert.isTrue(layer._truncated);
    assert.include(states, 'limit');
});

test('truncation is detected by the raw element count', async function () {
    const layer = makeUpdateLayer({maxPoints: 3});
    const elements = [
        {type: 'node', id: 1, lat: 49.7, lon: 33.4},
        {type: 'node', id: 2, lat: 49.7, lon: 33.4},
        // the parser drops elements without coordinates, the server limit counts them
        {type: 'node', id: 3},
    ];
    layer._client = makeStubClient({elements});
    layer._categoryIds = ['spring'];
    await layer.update();
    assert.isTrue(layer._truncated);
});

test('truncated data is reused while panning at the loaded zoom', async function () {
    const layer = makeUpdateLayer();
    layer._client = makeStubClient({elements: []});
    layer._loadedBounds = L.latLngBounds([49.6, 33.3], [49.9, 33.6]);
    layer._loadedCategoryIds = new Set(['spring']);
    layer._loadedZoom = 13;
    layer._truncated = true;
    layer._categoryIds = ['spring'];
    const states = [];
    layer.on('loadstate', (e) => states.push(e.state));
    await layer.update();
    assert.lengthOf(layer._client.queries, 0);
    assert.include(states, 'limit');
});

test('truncated data is refetched when zooming in', async function () {
    const layer = makeUpdateLayer();
    layer._client = makeStubClient({elements: []});
    layer._loadedBounds = L.latLngBounds([49.6, 33.3], [49.9, 33.6]);
    layer._loadedCategoryIds = new Set(['spring']);
    layer._loadedZoom = 12;
    layer._truncated = true;
    layer._categoryIds = ['spring'];
    await layer.update();
    assert.lengthOf(layer._client.queries, 1);
});

test('update aborts the in-flight request when the zoom is too low', async function () {
    const layer = makeUpdateLayer();
    let resolveFirst;
    const first = {
        promise: new Promise((resolve) => {
            resolveFirst = resolve;
        }),
        abort: () => {
            first.aborted = true;
        },
    };
    layer._client = {query: () => first};
    layer._categoryIds = ['spring'];
    const firstUpdate = layer.update();
    layer._map = {...makeStubMap(), getZoom: () => 8};
    const states = [];
    layer.on('loadstate', (e) => states.push(e.state));
    await layer.update();
    assert.isTrue(first.aborted);
    assert.include(states, 'zoom');
    // the late response of the aborted request must not be applied
    resolveFirst({elements: [{type: 'node', id: 1, lat: 49.7, lon: 33.4, tags: {natural: 'spring'}}]});
    await firstUpdate;
    assert.deepEqual(layer._loadedPois, []);
});

test('update aborts the in-flight request when the area is too large', async function () {
    const layer = makeUpdateLayer();
    const first = {
        promise: new Promise(() => {
            // never settles
        }),
        abort: () => {
            first.aborted = true;
        },
    };
    layer._client = {query: () => first};
    layer._categoryIds = ['spring'];
    layer.update();
    layer._map = makeStubMap(L.latLngBounds([40, 20], [50, 60]));
    const states = [];
    layer.on('loadstate', (e) => states.push(e.state));
    await layer.update();
    assert.isTrue(first.aborted);
    assert.include(states, 'area');
});

test('a superseded response is not applied', async function () {
    const layer = makeUpdateLayer();
    let resolveFirst;
    const first = {
        promise: new Promise((resolve) => {
            resolveFirst = resolve;
        }),
        abort: () => {
            // emulate the abort of xhr-promise
        },
    };
    const second = {
        promise: Promise.resolve({elements: []}),
        abort: () => {
            // the second request is not aborted in the test
        },
    };
    const requests = [first, second];
    layer._client = {query: () => requests.shift()};
    layer._categoryIds = ['spring'];
    const firstUpdate = layer.update();
    await layer.update();
    resolveFirst({elements: [{type: 'node', id: 1, lat: 49.7, lon: 33.4, tags: {natural: 'spring'}}]});
    await firstUpdate;
    assert.deepEqual(layer._loadedPois, []);
    assert.deepEqual(layer._counts, {});
});

test('a superseded request is aborted and not applied', function () {
    const layer = makeUpdateLayer();
    const requests = [];
    layer._client = {
        query: () => {
            const request = {
                promise: new Promise(() => {
                    // never settles
                }),
                abort: () => {
                    request.aborted = true;
                },
            };
            requests.push(request);
            return request;
        },
    };
    layer._categoryIds = ['spring'];
    layer.update();
    layer.update();
    assert.isTrue(requests[0].aborted);
    assert.lengthOf(requests, 2);
    assert.strictEqual(layer._request, requests[1]);
});

test('setCategories does not schedule an update when the layer is not on the map', function () {
    const layer = new PoiLayer('http://example.com/');
    layer.setCategories(['spring']);
    assert.isNull(layer._updateTimer);
});

test('counts are recalculated when a category is disabled', function () {
    const layer = new PoiLayer('http://example.com/');
    layer._counts = {spring: 7, camp_site: 3};
    layer._loadedPois = [{categoryId: 'spring'}, {categoryId: 'camp_site'}];
    const counts = [];
    layer.on('countschanged', (e) => counts.push(e.counts));
    layer.setCategories(['spring']);
    assert.deepEqual(counts[counts.length - 1], {spring: 7});
});

test('markers are not rebuilt when nothing changed', async function () {
    const layer = makeUpdateLayer();
    let redraws = 0;
    layer.redraw = () => {
        redraws += 1;
    };
    layer._loadedPois = [{categoryId: 'spring', lat: 49.7, lon: 33.4, tags: {}}];
    layer._categoryIds = ['spring'];
    layer._updateMarkers();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(redraws, 1);
    layer._updateMarkers();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(redraws, 1);
});

test('pixel ratio can follow the device pixel ratio', function () {
    const layer = new PoiLayer('http://example.com/', {useDevicePixelRatio: true});
    assert.isAtLeast(layer.getPixelRatio(), 1);
    assert.isAtMost(layer.getPixelRatio(), 2);
});

test('icon scale is clamped to the configured bounds', function () {
    const layer = new PoiLayer('http://example.com/');
    layer._updateIconScale(10);
    assert.equal(layer.options.iconScale, 0.75);
    layer._updateIconScale(14);
    assert.equal(layer.options.iconScale, 1);
    layer._updateIconScale(18);
    assert.equal(layer.options.iconScale, 1.5);
});

test('onRemove aborts the in-flight request', function () {
    const layer = new PoiLayer('http://example.com/');
    let aborted = false;
    layer._request = {
        abort: () => {
            aborted = true;
        },
    };
    const map = {
        off: () => {
            // no map events in the test
        },
        getPanes: () => ({
            markerPane: {
                removeChild: () => {
                    // no tooltip is attached in the test
                },
            },
        }),
        _removeZoomLimit: () => {
            // no zoom limits are registered in the test
        },
    };
    layer._map = map;
    layer._container = document.createElement('div');
    layer.onRemove(map);
    assert.isTrue(aborted);
    assert.isNull(layer._request);
});

suite('POI panel model');

test('group tri-state follows the category selection', function () {
    const model = new PoiPanelModel(() => {
        // selection change callback
    });
    const group = model.groups[0];
    assert.isFalse(group.allSelected());
    assert.isFalse(group.someSelected());
    group.categories[0].selected(true);
    assert.isFalse(group.allSelected());
    assert.isTrue(group.someSelected());
    group.allSelected(true);
    assert.isTrue(group.allSelected());
    assert.isFalse(group.someSelected());
    group.allSelected(false);
    assert.isFalse(group.categories[0].selected());
});

test('a group header toggles only categories visible under the search', function () {
    const model = new PoiPanelModel(() => {
        // selection change callback
    });
    model.query('родник');
    const group = model.visibleGroups().find((visibleGroup) => visibleGroup.categories.some((c) => c.id === 'spring'));
    assert.isOk(group);
    group.allSelected(true);
    assert.deepEqual(model.getSelectedIds(), ['spring']);
    assert.isFalse(model.allCategories.find((c) => c.id === 'drinking_water').selected());
});

test('search matches titles in both languages', function () {
    const model = new PoiPanelModel(() => {
        // selection change callback
    });
    model.query('Spring');
    const englishIds = model
        .visibleGroups()
        .flatMap((group) => group.categories)
        .map((category) => category.id);
    assert.include(englishIds, 'spring');
    model.query('родник');
    const russianIds = model
        .visibleGroups()
        .flatMap((group) => group.categories)
        .map((category) => category.id);
    assert.include(russianIds, 'spring');
});

test('counters show the number of found points', function () {
    const model = new PoiPanelModel(() => {
        // selection change callback
    });
    const spring = model.allCategories.find((category) => category.id === 'spring');
    model.updateCounts({spring: 12});
    assert.equal(spring.countText(), '(12)');
    model.updateCounts({});
    assert.equal(spring.countText(), '');
});

test('select all and clear all change every category', function () {
    const model = new PoiPanelModel(() => {
        // selection change callback
    });
    model.onSelectAll();
    assert.lengthOf(model.getSelectedIds(), poiCategories.length);
    model.onClearAll();
    assert.lengthOf(model.getSelectedIds(), 0);
});

test('selection is stored in localStorage and restored', function () {
    safeLocalStorage.removeItem('leafletPoiSettings');
    const control = {};
    enablePoi(control);
    control._poiModel = new PoiPanelModel(() => {
        // selection change callback
    });
    control._savePoiSettings(['spring']);
    assert.deepEqual(JSON.parse(safeLocalStorage.getItem('leafletPoiSettings')), {categories: ['spring']});
    control._poiModel.setSelectedIds([]);
    control._loadPoiSettings();
    assert.deepEqual(control._poiModel.getSelectedIds(), ['spring']);
    safeLocalStorage.removeItem('leafletPoiSettings');
});

test('the control initializes the layer only once', function () {
    const control = {};
    enablePoi(control);
    const layer = {};
    control._poiLayer = layer;
    control._initPoi();
    assert.strictEqual(control._poiLayer, layer);
});

test('ignores a remembered endpoint when the configured list changed', function () {
    safeLocalStorage.removeItem('leafletPoiOverpassUrl');
    const control = {};
    enablePoi(control);
    safeLocalStorage.setItem(
        'leafletPoiOverpassUrl',
        JSON.stringify({url: 'http://b/', urls: ['http://a/', 'http://b/']})
    );
    assert.equal(control._loadRememberedOverpassUrl(['http://a/', 'http://b/']), 'http://b/');
    assert.isNull(control._loadRememberedOverpassUrl(['http://b/', 'http://a/']));
    safeLocalStorage.removeItem('leafletPoiOverpassUrl');
});

test('a hash change applies the selection to the model and the layer', function () {
    safeLocalStorage.removeItem('leafletPoiSettings');
    const control = {};
    enablePoi(control);
    control._poiModel = new PoiPanelModel(() => {
        // selection change callback
    });
    const applied = [];
    control._poiLayer = {setCategories: (ids) => applied.push(ids)};
    control._map = {
        hasLayer: () => false,
        addLayer: () => {
            // the layer is not added to a real map in the test
        },
    };
    control._onPoiHashChanged(['spring']);
    assert.deepEqual(control._poiModel.getSelectedIds(), ['spring']);
    assert.deepEqual(applied, [['spring']]);
    safeLocalStorage.removeItem('leafletPoiSettings');
});

test('the limit status warns that more points may exist', function () {
    const control = {};
    enablePoi(control);
    assert.match(control._getPoiStatusText({state: 'limit'}), /точек|points/u);
});

suite('Overpass antimeridian and escaping');

test('splits a bbox crossing the antimeridian into valid parts', function () {
    const query = overpass.buildOverpassQuery([{natural: 'spring'}], [0, 179.5, 1, 180.2]);
    assert.include(query, 'nwr["natural"="spring"](0.00000,179.50000,1.00000,180.00000);');
    assert.include(query, 'nwr["natural"="spring"](0.00000,-180.00000,1.00000,-179.80000);');
});

test('splits a bbox crossing the antimeridian on the west side', function () {
    const query = overpass.buildOverpassQuery([{natural: 'spring'}], [0, -180.3, 1, -179.5]);
    assert.include(query, 'nwr["natural"="spring"](0.00000,179.70000,1.00000,180.00000);');
    assert.include(query, 'nwr["natural"="spring"](0.00000,-180.00000,1.00000,-179.50000);');
});

test('does not split a normal bbox', function () {
    const query = overpass.buildOverpassQuery([{natural: 'spring'}], [0, 10, 1, 11]);
    assert.notInclude(query, '-180.00000');
    assert.include(query, '(0.00000,10.00000,1.00000,11.00000);');
});

test('uses a single part for a bbox spanning the whole world', function () {
    const query = overpass.buildOverpassQuery([{natural: 'spring'}], [0, -200, 1, 200]);
    assert.include(query, 'nwr["natural"="spring"](0.00000,-180.00000,1.00000,180.00000);');
    assert.lengthOf(query.match(/nwr\[/gu), 1);
});

test('clamps the bbox to the poles', function () {
    const query = overpass.buildOverpassQuery([{natural: 'spring'}], [-100, 10, 100, 20]);
    assert.include(query, '(-90.00000,10.00000,90.00000,20.00000);');
});

test('escapes regex metacharacters in tag values', function () {
    const query = overpass.buildOverpassQuery([{shop: ['a.b', 'c+d']}], [0, 0, 1, 1]);
    assert.include(query, '["shop"~"^(a\\\\.b|c\\\\+d)$"]');
});

test('escapes quotes and backslashes in regex values', function () {
    const query = overpass.buildOverpassQuery([{name: ['a"b', 'c']}], [0, 0, 1, 1]);
    assert.include(query, '["name"~"^(a\\"b|c)$"]');
});

suite('POI popup link validation');

test('osm url validates the element type and id', function () {
    assert.isNull(getPoiOsmUrl({type: 'evil', id: 1}));
    assert.isNull(getPoiOsmUrl({type: 'node', id: 'x'}));
    assert.equal(getPoiOsmUrl({type: 'way', id: '7'}), 'https://www.openstreetmap.org/way/7');
});

test('popup without a valid osm element has no link', function () {
    const category = getCategory('spring');
    const html = buildPoiPopupHtml({type: 'evil', id: 1, tags: {}}, category);
    assert.notInclude(html, 'openstreetmap.org/evil');
    assert.include(html, 'poi-popup-title');
});

suite('Overpass endpoints and key');

test('builds the endpoint list with and without a NextGIS key', function () {
    assert.deepEqual(overpass.buildOverpassUrls(null), [
        'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
        'https://overpass-api.de/api/interpreter',
    ]);
    assert.deepEqual(overpass.buildOverpassUrls('abc'), [
        'https://overpass.nextgis.com/abc/api/interpreter',
        'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
        'https://overpass-api.de/api/interpreter',
    ]);
});

test('the user key is stored in the browser and wins over the site key', function () {
    safeLocalStorage.removeItem('overpassNextgisKey');
    assert.equal(getEffectiveKey(), getSiteKey());
    setUserKey(' user-key ');
    assert.equal(getUserKey(), 'user-key');
    assert.equal(getEffectiveKey(), 'user-key');
    setUserKey('');
    assert.isNull(getUserKey());
});

test('loads the NextGIS key from config.json', async function () {
    // eslint-disable-next-line global-require
    const keyModule = require('~/lib/overpass/key');
    const originalFetch = keyModule.__get__('fetch');
    function stubFetch(response) {
        keyModule.__set__('fetch', () => {
            const promise = Promise.resolve(response);
            promise.abort = () => {
                // emulate the abort of xhr-promise
            };
            return promise;
        });
    }
    safeLocalStorage.removeItem('overpassNextgisKey');
    try {
        stubFetch({responseJSON: {overpassNextgis: 'runtime-key'}});
        assert.equal(await keyModule.loadRuntimeKey(), 'runtime-key');
        assert.equal(getEffectiveKey(), 'runtime-key');
        // a missing or broken config.json clears the runtime key
        stubFetch({responseJSON: null});
        await keyModule.loadRuntimeKey();
        assert.isNull(keyModule.__get__('getRuntimeKey')());
    } finally {
        keyModule.__set__('fetch', originalFetch);
    }
});

test('setUrls switches the endpoints for new requests', async function () {
    // eslint-disable-next-line global-require
    const overpassRewire = require('~/lib/overpass');
    const originalFetch = overpassRewire.__get__('fetch');
    const calls = [];
    overpassRewire.__set__('fetch', (url) => {
        calls.push(url);
        const promise = Promise.resolve({responseJSON: {elements: []}});
        promise.abort = () => {
            // emulate the abort of xhr-promise
        };
        return promise;
    });
    try {
        const client = new overpass.OverpassClient('http://a/');
        await client.query('q').promise;
        client.setUrls(['http://b/', 'http://a/']);
        await client.query('q2').promise;
        assert.deepEqual(calls, ['http://a/', 'http://b/']);
        assert.equal(client.getActiveUrl(), 'http://b/');
    } finally {
        overpassRewire.__set__('fetch', originalFetch);
    }
});

test('setOverpassUrls updates the client and refetches the view', async function () {
    const layer = makeUpdateLayer();
    const applied = [];
    const queries = [];
    layer._client = {
        setUrls: (urls) => applied.push(urls),
        query: (queryString) => {
            queries.push(queryString);
            return {
                promise: Promise.resolve({elements: []}),
                abort: () => {
                    // emulate the abort of xhr-promise
                },
            };
        },
    };
    layer._categoryIds = ['spring'];
    layer._loadedBounds = L.latLngBounds([49.6, 33.3], [49.9, 33.6]);
    layer._loadedCategoryIds = new Set(['spring']);
    layer.setOverpassUrls(['http://b/']);
    assert.deepEqual(applied, [['http://b/']]);
    assert.isNull(layer._loadedBounds);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.lengthOf(queries, 1);
});

test('the panel forwards the entered NextGIS key', function () {
    const model = new PoiPanelModel(() => {
        // selection change callback
    });
    let received = null;
    model.onNextgisKeyChange = (key) => {
        received = key;
    };
    model.nextgisKey('abc');
    model.onNextgisKeyChanged();
    assert.equal(received, 'abc');
    assert.match(model.nextgisKeyHint(), /браузер|browser/u);
});

test('changing the NextGIS key in the panel rebuilds the endpoints', function () {
    safeLocalStorage.removeItem('overpassNextgisKey');
    const control = {};
    enablePoi(control);
    control._poiModel = new PoiPanelModel(() => {
        // selection change callback
    });
    const applied = [];
    control._poiLayer = {setOverpassUrls: (urls) => applied.push(urls)};
    control._overpassUrls = ['http://a/'];
    control._onNextgisKeyChanged('my-key');
    assert.equal(getUserKey(), 'my-key');
    assert.deepEqual(applied, [
        [
            'https://overpass.nextgis.com/my-key/api/interpreter',
            'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
            'https://overpass-api.de/api/interpreter',
        ],
    ]);
    setUserKey('');
});
