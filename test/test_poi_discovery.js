/* eslint-disable camelcase -- OSM tag keys are snake_case */
import ko from 'knockout';
import L from 'leaflet';

import enablePoiDiscovery, {PoiDiscoveryModel} from '~/lib/leaflet.control.poi-discovery';
import layout from '~/lib/leaflet.control.poi-discovery/control.html';
import {saveGpx} from '~/lib/leaflet.control.track-list/lib/geo_file_exporters';
import parseGpx from '~/lib/leaflet.control.track-list/lib/parsers/gpx';
// eslint-disable-next-line import/no-unassigned-import -- registers L.Control.TrackList
import '~/lib/leaflet.control.track-list/track-list';
import {getCategory} from '~/lib/leaflet.layer.poi/categories';
import {buildPoiPopupHtml, getPoiLink} from '~/lib/leaflet.layer.poi/poi';
import {PoiDiscoveryLayer} from '~/lib/leaflet.layer.poi-discovery';
import {setUserKey} from '~/lib/overpass/key';
import {getPoiCategory} from '~/lib/poi-discovery/categories';
import {
    buildSegmentsIndex,
    chunkSegments,
    expandBbox,
    extractSubSegment,
    extractSubSegments,
    getCumulativeDistances,
    haversineDistance,
    projectOnPolyline,
    projectOnSegments,
} from '~/lib/poi-discovery/corridor';
import {formatDistance, formatKilometers} from '~/lib/poi-discovery/format';
import {searchArea, searchCorridor, splitBboxIntoTiles} from '~/lib/poi-discovery/search';
import {getSource, poiSources} from '~/lib/poi-discovery/sources';
import {buildAreaCircles, buildCorridorCircles, isInsideBbox} from '~/lib/poi-discovery/sources/circles';
import {
    buildTimeDescription,
    getMonths,
    getMostFrequentTaxon,
    getTimeBucket,
    getUsername as getInatUsername,
    inaturalistSource,
    parseLocation,
    setUsername as setInatUsername,
} from '~/lib/poi-discovery/sources/inaturalist';
import {parseWikidataResponse, wikidataSource} from '~/lib/poi-discovery/sources/wikidata';
import {buildWaypointDescription, buildWaypoints} from '~/lib/poi-discovery/waypoints';
import safeLocalStorage from '~/lib/safe-localstorage';

const OSMAND_GPX_NAMESPACE = 'https://osmand.net/docs/technical/osmand-file-formats/osmand-gpx';

function makeStubClient(getResponse) {
    const queries = [];
    return {
        queries,
        query: (queryString) => {
            queries.push(queryString);
            return {
                promise: Promise.resolve(getResponse(queryString, queries.length - 1)),
                abort: () => {
                    // emulate the abort of xhr-promise
                },
            };
        },
    };
}

function makePoi(id, tags, lat = 49.7, lon = 33.4, type = 'node') {
    return {type, id, lat, lon, tags};
}

suite('POI discovery corridor math');

test('haversine distance of a small latitude step', function () {
    const distance = haversineDistance({lat: 49.7, lng: 33.4}, {lat: 49.701, lng: 33.4});
    assert.closeTo(distance, 111.19, 0.5);
});

test('cumulative distances grow along the polyline', function () {
    const points = [
        {lat: 49.7, lng: 33.4},
        {lat: 49.71, lng: 33.4},
        {lat: 49.72, lng: 33.4},
    ];
    const cumulative = getCumulativeDistances(points);
    assert.lengthOf(cumulative, 3);
    assert.equal(cumulative[0], 0);
    assert.isAbove(cumulative[1], 0);
    assert.closeTo(cumulative[2], cumulative[1] * 2, 1);
});

test('the whole range returns the whole polyline', function () {
    const points = [
        {lat: 49.7, lng: 33.4},
        {lat: 49.71, lng: 33.4},
        {lat: 49.72, lng: 33.4},
    ];
    const segment = extractSubSegment(points, 0, getCumulativeDistances(points)[2]);
    assert.deepEqual(segment, points);
});

test('a range inside the polyline is interpolated at both ends', function () {
    const points = [
        {lat: 49.7, lng: 33.4},
        {lat: 49.71, lng: 33.4},
        {lat: 49.72, lng: 33.4},
    ];
    const cumulative = getCumulativeDistances(points);
    const segment = extractSubSegment(points, cumulative[0] + 50, cumulative[1] + 50);
    assert.lengthOf(segment, 3);
    assert.closeTo(segment[0].lat, 49.70045, 0.0001);
    assert.closeTo(segment[1].lat, 49.71, 0.00001);
    assert.closeTo(segment[2].lat, 49.71045, 0.0001);
});

test('a range inside one segment keeps both of its ends', function () {
    const points = [
        {lat: 49.7, lng: 33.4},
        {lat: 49.72, lng: 33.4},
    ];
    const segment = extractSubSegment(points, 1000, 2000);
    assert.lengthOf(segment, 2);
    assert.closeTo(segment[0].lat, 49.7 + 0.02 * (1000 / 2223.9), 0.0001);
    assert.closeTo(segment[1].lat, 49.7 + 0.02 * (2000 / 2223.9), 0.0001);
});

test('a range outside the polyline returns nothing', function () {
    const points = [
        {lat: 49.7, lng: 33.4},
        {lat: 49.71, lng: 33.4},
    ];
    const total = getCumulativeDistances(points)[1];
    assert.deepEqual(extractSubSegment(points, total + 10, total + 100), []);
});

test('an empty polyline gives an empty segment', function () {
    assert.deepEqual(extractSubSegment([], 0, 100), []);
});

test('projection on the polyline returns the distance and the position', function () {
    const points = [
        {lat: 49.7, lng: 33.4},
        {lat: 49.72, lng: 33.4},
    ];
    const total = getCumulativeDistances(points)[1];
    const onLine = projectOnPolyline({lat: 49.71, lng: 33.4}, points);
    assert.closeTo(onLine.distance, 0, 0.5);
    assert.closeTo(onLine.along, total / 2, 1);
    const side = projectOnPolyline({lat: 49.71, lng: 33.401}, points);
    assert.closeTo(side.distance, 72.2, 1);
    assert.closeTo(side.along, total / 2, 1);
});

test('a point behind the polyline start projects onto the first point', function () {
    const points = [
        {lat: 49.7, lng: 33.4},
        {lat: 49.72, lng: 33.4},
    ];
    const behind = projectOnPolyline({lat: 49.69, lng: 33.4}, points);
    assert.closeTo(behind.distance, 1111.9, 5);
    assert.equal(behind.along, 0);
});

test('a point past the polyline end projects onto the last point', function () {
    const points = [
        {lat: 49.7, lng: 33.4},
        {lat: 49.72, lng: 33.4},
    ];
    const total = getCumulativeDistances(points)[1];
    const past = projectOnPolyline({lat: 49.73, lng: 33.4}, points);
    assert.closeTo(past.distance, 1111.9, 5);
    assert.closeTo(past.along, total, 1);
});

test('a single point polyline measures the distance to it', function () {
    const projection = projectOnPolyline({lat: 49.71, lng: 33.4}, [{lat: 49.7, lng: 33.4}]);
    assert.closeTo(projection.distance, 1111.9, 5);
    assert.equal(projection.along, 0);
});

test('bbox is expanded by the corridor width on every side', function () {
    const bbox = expandBbox([49.7, 33.4, 49.8, 33.5], 1000);
    assert.closeTo(bbox[0], 49.7 - 1000 / 111320, 1e-6);
    assert.closeTo(bbox[2], 49.8 + 1000 / 111320, 1e-6);
    assert.isBelow(bbox[1], 33.4);
    assert.isAbove(bbox[3], 33.5);
});

test('a polyline is split into chunks of the requested length', function () {
    const points = [
        {lat: 49.7, lng: 33.4},
        {lat: 49.72, lng: 33.4},
        {lat: 49.74, lng: 33.4},
        {lat: 49.76, lng: 33.4},
    ];
    const {chunks, truncated} = chunkSegments([{points}], 3400);
    assert.isFalse(truncated);
    assert.lengthOf(chunks, 2);
    assert.closeTo(chunks[0].startMeters, 0, 1);
    assert.closeTo(chunks[0].endMeters, 3400, 1);
    assert.closeTo(chunks[1].endMeters, getCumulativeDistances(points)[3], 1);
    assert.lengthOf(chunks[0].points, 3);
});

test('a long straight segment is covered by chunks from end to end', function () {
    const points = [
        {lat: 49.7, lng: 33.4},
        {lat: 50.6, lng: 33.4},
    ];
    const {chunks, truncated} = chunkSegments([{points}], 20000);
    assert.isFalse(truncated);
    assert.lengthOf(chunks, 6);
    for (const chunk of chunks) {
        assert.lengthOf(chunk.points, 2);
    }
    assert.deepEqual(chunks[1].points[0], chunks[0].points[1]);
    assert.closeTo(chunks[5].endMeters, getCumulativeDistances(points)[1], 1);
});

test('chunking reports the truncation when the chunks limit is hit', function () {
    const points = [
        {lat: 49.7, lng: 33.4},
        {lat: 49.72, lng: 33.4},
        {lat: 49.74, lng: 33.4},
    ];
    const {chunks, truncated} = chunkSegments([{points}], 1000, 1);
    assert.lengthOf(chunks, 1);
    assert.isTrue(truncated);
});

suite('POI discovery multi-segment tracks');

function makeSegments(pointsList) {
    return buildSegmentsIndex(pointsList.map((points) => ({points})));
}

test('segment offsets follow the lengths of the previous segments', function () {
    const index = makeSegments([
        [
            {lat: 49.7, lng: 33.4},
            {lat: 49.72, lng: 33.4},
        ],
        [
            {lat: 50.0, lng: 33.4},
            {lat: 50.01, lng: 33.4},
        ],
    ]);
    assert.lengthOf(index.segments, 2);
    assert.equal(index.segments[0].offsetMeters, 0);
    assert.closeTo(index.segments[1].offsetMeters, 2223.9, 1);
    assert.closeTo(index.totalMeters, 2223.9 + 1111.9, 1);
});

test('a range over the whole track covers every segment', function () {
    const index = makeSegments([
        [
            {lat: 49.7, lng: 33.4},
            {lat: 49.72, lng: 33.4},
        ],
        [
            {lat: 50.0, lng: 33.4},
            {lat: 50.01, lng: 33.4},
        ],
    ]);
    const parts = extractSubSegments(index, 0, index.totalMeters);
    assert.lengthOf(parts, 2);
    assert.equal(parts[0].offsetMeters, 0);
    assert.closeTo(parts[1].offsetMeters, 2223.9, 1);
    assert.lengthOf(parts[1].points, 2);
});

test('the gap between segments is not interpolated', function () {
    const index = makeSegments([
        [
            {lat: 49.7, lng: 33.4},
            {lat: 49.72, lng: 33.4},
        ],
        [
            {lat: 50.0, lng: 33.4},
            {lat: 50.01, lng: 33.4},
        ],
    ]);
    const parts = extractSubSegments(index, 2223.9, index.totalMeters);
    assert.lengthOf(parts, 1);
    assert.closeTo(parts[0].offsetMeters, 2223.9, 1);
    for (const point of parts[0].points) {
        assert.isAbove(point.lat, 49.9);
    }
});

test('chunks never cross the segment boundaries', function () {
    const parts = [
        {
            points: [
                {lat: 49.7, lng: 33.4},
                {lat: 49.72, lng: 33.4},
            ],
            offsetMeters: 0,
        },
        {
            points: [
                {lat: 50.0, lng: 33.4},
                {lat: 50.01, lng: 33.4},
            ],
            offsetMeters: 5000,
        },
    ];
    const {chunks} = chunkSegments(parts, 20000);
    assert.lengthOf(chunks, 2);
    assert.closeTo(chunks[0].endMeters, 2223.9, 1);
    assert.closeTo(chunks[1].startMeters, 5000, 1);
});

test('projection picks the nearest segment and returns the global position', function () {
    const index = buildSegmentsIndex(
        [
            {
                points: [
                    {lat: 49.7, lng: 33.4},
                    {lat: 49.72, lng: 33.4},
                ],
            },
            {
                points: [
                    {lat: 50.0, lng: 33.4},
                    {lat: 50.01, lng: 33.4},
                ],
            },
        ],
        200
    );
    const first = projectOnSegments({lat: 49.71, lng: 33.4}, index);
    assert.closeTo(first.distance, 0, 0.5);
    assert.closeTo(first.along, 1111.9, 5);
    const second = projectOnSegments({lat: 50.005, lng: 33.4}, index);
    assert.closeTo(second.distance, 0, 0.5);
    assert.closeTo(second.along, 2223.9 + 555.9, 5);
});

test('projection skips the points farther than the index padding', function () {
    const index = buildSegmentsIndex(
        [
            {
                points: [
                    {lat: 49.7, lng: 33.4},
                    {lat: 49.72, lng: 33.4},
                ],
            },
            {
                points: [
                    {lat: 50.0, lng: 33.4},
                    {lat: 50.01, lng: 33.4},
                ],
            },
        ],
        200
    );
    const far = projectOnSegments({lat: 49.75, lng: 33.4}, index);
    assert.isAbove(far.distance, 200);
});

test('a part of a single point is searched and projected', function () {
    const index = buildSegmentsIndex(
        [
            {
                points: [
                    {lat: 49.7, lng: 33.4},
                    {lat: 49.72, lng: 33.4},
                ],
            },
            {points: [{lat: 50.0, lng: 33.4}]},
        ],
        200
    );
    const projection = projectOnSegments({lat: 50.0, lng: 33.4}, index);
    assert.closeTo(projection.distance, 0, 1);
    assert.closeTo(projection.along, 2223.9, 5);
    const chunks = chunkSegments(
        [
            {
                points: [
                    {lat: 49.7, lng: 33.4},
                    {lat: 49.72, lng: 33.4},
                ],
                offsetMeters: 0,
            },
            {points: [{lat: 50.0, lng: 33.4}], offsetMeters: 2223.9},
        ],
        20000
    );
    assert.lengthOf(chunks.chunks, 2, 'the point-only part gets its own chunk');
});

test('a point with a wrapped longitude is found near an unwrapped track', function () {
    const index = buildSegmentsIndex(
        [
            {
                points: [
                    {lat: 49.7, lng: 179.9},
                    {lat: 49.7, lng: 180.1},
                ],
            },
        ],
        200
    );
    const projection = projectOnSegments({lat: 49.7, lng: -179.95}, index);
    assert.isBelow(projection.distance, 10, 'the point is found on the track');
});

suite('POI discovery area tiling');

test('a small area is searched with a single query', function () {
    assert.deepEqual(splitBboxIntoTiles([49.7, 33.4, 49.75, 33.45]), [[49.7, 33.4, 49.75, 33.45]]);
});

test('a large area is split into tiles covering it', function () {
    const bbox = [49, 33, 50, 34];
    const tiles = splitBboxIntoTiles(bbox, 0.25, 16);
    assert.lengthOf(tiles, 4);
    assert.closeTo(tiles[0][0], 49, 1e-9);
    assert.closeTo(tiles[3][1], 33.5, 1e-9);
    assert.closeTo(tiles[3][2], 50, 1e-9);
    assert.closeTo(tiles[3][3], 34, 1e-9);
});

test('the number of tiles is capped by maxTiles', function () {
    const tiles = splitBboxIntoTiles([40, 20, 50, 30], 0.25, 4);
    assert.lengthOf(tiles, 4);
});

suite('POI discovery search');

test('the area search deduplicates the elements found in several tiles', async function () {
    const client = makeStubClient(() => ({
        elements: [makePoi(1, {natural: 'spring'})],
    }));
    const handle = searchArea({
        bbox: [49, 33, 50, 34],
        categories: [getCategory('spring')],
        client,
        maxTileArea: 0.25,
        maxTiles: 16,
    });
    const result = await handle.promise;
    assert.isAbove(client.queries.length, 1);
    assert.lengthOf(result.pois, 1);
    assert.equal(result.pois[0].categoryId, 'spring');
    assert.isFalse(result.truncated);
});

test('the area search drops elements of other categories', async function () {
    const client = makeStubClient(() => ({
        elements: [makePoi(1, {natural: 'spring'}), makePoi(2, {amenity: 'bench'})],
    }));
    const handle = searchArea({bbox: [49.7, 33.4, 49.75, 33.45], categories: [getCategory('spring')], client});
    const result = await handle.promise;
    assert.lengthOf(result.pois, 1);
    assert.equal(result.pois[0].id, 1);
});

test('a response on the points limit marks the result as truncated', async function () {
    const client = makeStubClient(() => ({
        elements: [makePoi(1, {natural: 'spring'}), makePoi(2, {natural: 'spring'})],
    }));
    const handle = searchArea({
        bbox: [49.7, 33.4, 49.75, 33.45],
        categories: [getCategory('spring')],
        client,
        maxPoints: 2,
    });
    const result = await handle.promise;
    assert.isTrue(result.truncated);
});

test('the area search caps the number of results', async function () {
    const client = makeStubClient(() => ({
        elements: [makePoi(1, {natural: 'spring'}), makePoi(2, {natural: 'spring'})],
    }));
    const handle = searchArea({
        bbox: [49.7, 33.4, 49.75, 33.45],
        categories: [getCategory('spring')],
        client,
        maxResults: 1,
    });
    const result = await handle.promise;
    assert.lengthOf(result.pois, 1);
    assert.isTrue(result.truncated);
});

test('the corridor search keeps only the points within the corridor width', async function () {
    const segments = [
        {
            points: [
                {lat: 49.7, lng: 33.4},
                {lat: 49.72, lng: 33.4},
            ],
            offsetMeters: 0,
        },
    ];
    const client = makeStubClient(() => ({
        elements: [
            makePoi(1, {natural: 'spring'}, 49.71, 33.4),
            makePoi(2, {natural: 'spring'}, 49.71, 33.401),
            makePoi(3, {natural: 'spring'}, 49.71, 33.42),
        ],
    }));
    const handle = searchCorridor({
        segments,
        widthMeters: 200,
        categories: [getCategory('spring')],
        client,
    });
    const result = await handle.promise;
    assert.deepEqual(
        result.pois.map((poi) => poi.id),
        [1, 2]
    );
    assert.closeTo(result.pois[0].distance, 0, 0.5);
    assert.closeTo(result.pois[0].alongMeters, 1111.9, 5);
    assert.closeTo(result.pois[1].distance, 72.2, 1);
});

test('the corridor search does not mix the segments up', async function () {
    const segments = [
        {
            points: [
                {lat: 49.7, lng: 33.4},
                {lat: 49.72, lng: 33.4},
            ],
            offsetMeters: 0,
        },
        {
            points: [
                {lat: 50.0, lng: 33.4},
                {lat: 50.01, lng: 33.4},
            ],
            offsetMeters: 2223.9,
        },
    ];
    const client = makeStubClient(() => ({
        elements: [makePoi(1, {natural: 'spring'}, 49.8, 33.4), makePoi(2, {natural: 'spring'}, 50.005, 33.4)],
    }));
    const handle = searchCorridor({segments, widthMeters: 200, categories: [getCategory('spring')], client});
    const result = await handle.promise;
    assert.deepEqual(
        result.pois.map((poi) => poi.id),
        [2]
    );
    assert.closeTo(result.pois[0].alongMeters, 2223.9 + 555.9, 5);
});

test('the corridor search sorts the results along the track', async function () {
    const segments = [
        {
            points: [
                {lat: 49.7, lng: 33.4},
                {lat: 49.74, lng: 33.4},
            ],
            offsetMeters: 0,
        },
    ];
    const client = makeStubClient(() => ({
        elements: [makePoi(1, {natural: 'spring'}, 49.73, 33.4), makePoi(2, {natural: 'spring'}, 49.71, 33.4)],
    }));
    const handle = searchCorridor({segments, widthMeters: 200, categories: [getCategory('spring')], client});
    const result = await handle.promise;
    assert.deepEqual(
        result.pois.map((poi) => poi.id),
        [2, 1]
    );
    assert.isBelow(result.pois[0].alongMeters, result.pois[1].alongMeters);
});

test('the corridor search splits a long track into several queries', async function () {
    const segments = [
        {
            points: [
                {lat: 49.7, lng: 33.4},
                {lat: 49.9, lng: 33.4},
            ],
            offsetMeters: 0,
        },
    ];
    const client = makeStubClient(() => ({elements: []}));
    const handle = searchCorridor({
        segments,
        widthMeters: 200,
        categories: [getCategory('spring')],
        client,
        chunkLength: 5000,
    });
    await handle.promise;
    assert.isAbove(client.queries.length, 1);
});

test('the corridor search reports the truncation when the chunks limit is hit', async function () {
    const segments = [
        {
            points: [
                {lat: 49.7, lng: 33.4},
                {lat: 49.9, lng: 33.4},
            ],
            offsetMeters: 0,
        },
    ];
    const client = makeStubClient(() => ({elements: []}));
    const handle = searchCorridor({
        segments,
        widthMeters: 200,
        categories: [getCategory('spring')],
        client,
        chunkLength: 5000,
        maxChunks: 2,
    });
    const result = await handle.promise;
    assert.isTrue(result.truncated);
});

test('a failed chunk keeps the results of the successful ones', async function () {
    let calls = 0;
    const client = {
        query: () => {
            calls += 1;
            if (calls === 1) {
                return {
                    promise: Promise.resolve({elements: [makePoi(1, {natural: 'spring'})]}),
                    abort: () => {
                        // emulate the abort of xhr-promise
                    },
                };
            }
            return {
                promise: Promise.reject(new Error('overpass is down')),
                abort: () => {
                    // emulate the abort of xhr-promise
                },
            };
        },
    };
    const handle = searchArea({
        bbox: [49, 33, 50, 34],
        categories: [getCategory('spring')],
        client,
        maxTileArea: 0.25,
    });
    const result = await handle.promise;
    assert.lengthOf(result.pois, 1);
    assert.isTrue(result.partial);
});

test('a search that fails from the start rejects', async function () {
    const client = {
        query: () => ({
            promise: Promise.reject(new Error('overpass is down')),
            abort: () => {
                // emulate the abort of xhr-promise
            },
        }),
    };
    const handle = searchArea({
        bbox: [49, 33, 50, 34],
        categories: [getCategory('spring')],
        client,
        maxTileArea: 0.25,
    });
    let rejected = false;
    await handle.promise.catch(() => {
        rejected = true;
    });
    assert.isTrue(rejected);
});

test('abort stops the search and does not use the in-flight response', async function () {
    const queries = [];
    let resolveFirst;
    const client = {
        query: (queryString) => {
            queries.push(queryString);
            return {
                promise: new Promise((resolve) => {
                    resolveFirst = resolve;
                }),
                abort: () => {
                    // the response still arrives, the search must not use it
                },
            };
        },
    };
    const handle = searchArea({
        bbox: [49, 33, 50, 34],
        categories: [getCategory('spring')],
        client,
        maxTileArea: 0.25,
    });
    assert.lengthOf(queries, 1);
    handle.abort();
    resolveFirst({elements: [makePoi(1, {natural: 'spring'})]});
    let rejected = false;
    await handle.promise.catch(() => {
        rejected = true;
    });
    assert.isTrue(rejected);
    assert.lengthOf(queries, 1);
});

suite('POI discovery sources');

test('the source registry exposes the sources', function () {
    assert.deepEqual(
        poiSources.map((source) => source.id),
        ['osm', 'wikidata', 'inaturalist']
    );
    assert.equal(getSource('osm').id, 'osm');
    assert.isNull(getSource('unknown'));
});

test('the source marks the found points with its id', async function () {
    const client = makeStubClient(() => ({elements: [makePoi(1, {natural: 'spring'})]}));
    const handle = getSource('osm').search(
        {mode: 'area', bbox: [49.7, 33.4, 49.75, 33.45], categories: [getCategory('spring')]},
        {client}
    );
    const result = await handle.promise;
    assert.lengthOf(result.pois, 1);
    assert.equal(result.pois[0].sourceId, 'osm');
});

suite('POI discovery waypoints');

test('a waypoint keeps the name, the category and the OSM link', function () {
    const poi = makePoi(42, {natural: 'spring', name: 'Родник'});
    const waypoints = buildWaypoints([{poi, category: getCategory('spring'), distance: 45, alongMeters: 12300}]);
    assert.lengthOf(waypoints, 1);
    assert.equal(waypoints[0].lat, 49.7);
    assert.equal(waypoints[0].lng, 33.4);
    assert.equal(waypoints[0].name, 'Родник');
    assert.match(waypoints[0].meta.desc, /Родник, источник|Spring/u);
    assert.include(waypoints[0].meta.desc, 'https://www.openstreetmap.org/node/42');
    assert.deepEqual(waypoints[0].meta.extensions, [
        {
            name: 'osmand:color',
            attributes: {},
            namespaces: {osmand: OSMAND_GPX_NAMESPACE},
            children: ['#2196F3'],
        },
    ]);
});

test('a nameless point is saved without a map label but with the category name', function () {
    const poi = makePoi(42, {natural: 'spring'});
    const waypoints = buildWaypoints([{poi, category: getCategory('spring')}]);
    assert.equal(waypoints[0].name, '', 'no label on the map');
    assert.match(waypoints[0].meta.name, /Родник, источник|Spring/u);
});

test('the color of a point of another source is the source color', function () {
    const poi = {...makePoi('Q1', {name: 'Замок'}, 49.7, 33.4, 'wikidata'), sourceId: 'wikidata'};
    const waypoints = buildWaypoints([{poi, category: getPoiCategory('wikidata_place')}]);
    assert.deepEqual(waypoints[0].meta.extensions[0].children, ['#9C27B0']);
    assert.equal(waypoints[0].name, 'Замок');
});

test('the description keeps the source description and the link', function () {
    const poi = {
        ...makePoi('Q1', {name: 'Замок'}, 49.7, 33.4, 'wikidata'),
        sourceId: 'wikidata',
        description: 'Instance of: castle',
        link: {url: 'https://www.wikidata.org/entity/Q1', text: 'Open in Wikidata'},
    };
    const description = buildWaypointDescription({poi, category: getPoiCategory('wikidata_place')});
    assert.include(description, 'Instance of: castle');
    assert.include(description, 'https://www.wikidata.org/entity/Q1');
});

test('a waypoint without a label keeps its metadata name in the GPX', function () {
    const content = saveGpx([], 'POI', [{latlng: L.latLng(49.7, 33.4), label: '', meta: {name: 'Родник'}}]);
    const geodata = parseGpx(content, 'poi')[0];
    assert.equal(geodata.points[0].name, 'Родник');
});

test('the description includes the position along the track', function () {
    const poi = makePoi(42, {natural: 'spring'});
    const description = buildWaypointDescription({
        poi,
        category: getCategory('spring'),
        distance: 45,
        alongMeters: 12300,
    });
    assert.match(description, /км 12\.3|km 12\.3/u);
    assert.match(description, /45 (м|m)/u);
});

test('waypoint metadata survives the GPX export and import', function () {
    const poi = makePoi(42, {natural: 'spring', name: 'Родник'});
    const waypoints = buildWaypoints([{poi, category: getCategory('spring'), distance: 45, alongMeters: 12300}]);
    const content = saveGpx(
        [],
        'POI',
        waypoints.map((waypoint) => ({
            latlng: L.latLng(waypoint.lat, waypoint.lng),
            label: waypoint.name,
            meta: waypoint.meta,
        }))
    );
    const geodata = parseGpx(content, 'poi')[0];
    assert.lengthOf(geodata.points, 1);
    const point = geodata.points[0];
    assert.equal(point.name, 'Родник');
    assert.equal(point.lat, 49.7);
    assert.equal(point.lng, 33.4);
    assert.include(point.meta.desc, 'https://www.openstreetmap.org/node/42');
    assert.deepEqual(point.meta.extensions, [
        {
            name: 'osmand:color',
            attributes: {},
            namespaces: {osmand: OSMAND_GPX_NAMESPACE},
            children: ['#2196F3'],
        },
    ]);
});

test('the waypoints go through the real track list and export', async function () {
    const poi = makePoi(42, {natural: 'spring', name: 'Родник'});
    const waypoints = buildWaypoints([{poi, category: getCategory('spring'), distance: 45, alongMeters: 12300}]);
    const trackList = new L.Control.TrackList();
    // the track list control needs a map only for rendering, the data model works without it
    trackList.onTrackVisibilityChanged = () => null;
    trackList.scrollListToTrack = () => null;
    trackList.addTracksFromGeodataArray([{name: 'POI: область', points: waypoints}]);
    const track = trackList.tracks()[0];
    const {content} = await trackList.exportTrackAsFile(track, saveGpx, '.gpx', false, false);
    const geodata = parseGpx(content, 'poi')[0];
    assert.lengthOf(geodata.points, 1);
    assert.equal(geodata.points[0].name, 'Родник');
    assert.include(geodata.points[0].meta.desc, 'https://www.openstreetmap.org/node/42');
    assert.deepEqual(geodata.points[0].meta.extensions, [
        {
            name: 'osmand:color',
            attributes: {},
            namespaces: {osmand: OSMAND_GPX_NAMESPACE},
            children: ['#2196F3'],
        },
    ]);
});

suite('POI discovery panel model');

function makeTrack({trackName = 'Track', trackLength = 12345, withLine = true, line = null} = {}) {
    return {
        name: () => trackName,
        length: () => trackLength,
        feature: {
            getLayers: () => {
                if (line) {
                    return [line];
                }
                return withLine ? [{}] : [];
            },
        },
    };
}

function makeModel(overrides = {}) {
    return new PoiDiscoveryModel({
        tracklist: overrides.tracklist ?? null,
        getAreaBounds: overrides.getAreaBounds ?? (() => [49.7, 33.4, 49.8, 33.5]),
        onSearch:
            overrides.onSearch ??
            (() => {
                // the search is not started in the test
            }),
        onCancel:
            overrides.onCancel ??
            (() => {
                // the search is not cancelled in the test
            }),
        onSaveWaypoints:
            overrides.onSaveWaypoints ??
            (() => {
                // the waypoints are not saved in the test
            }),
        onRectangleToggle: () => {
            // the rectangle is not drawn in the test
        },
        onClear:
            overrides.onClear ??
            (() => {
                // the results are not cleared on the map in the test
            }),
        onClose: () => {
            // the panel is not closed in the test
        },
        onShowResult:
            overrides.onShowResult ??
            (() => {
                // the point is not shown on the map in the test
            }),
    });
}

test('the search requires a selected category', function () {
    const model = makeModel();
    assert.match(model.validate(), /категор|category/u);
    model.categories.setSelectedIds(['spring']);
    assert.isNull(model.validate());
});

test('the corridor search requires a track and a positive width', function () {
    const model = makeModel();
    model.categories.setSelectedIds(['spring']);
    model.mode('corridor');
    assert.match(model.validate(), /трек|track/u);
    model.selectedTrack(makeTrack());
    assert.isNull(model.validate());
    model.width('0');
    assert.match(model.validate(), /ширин|width/iu);
});

test('a too large corridor width is rejected', function () {
    const model = makeModel();
    model.categories.setSelectedIds(['spring']);
    model.mode('corridor');
    model.selectedTrack(makeTrack({trackLength: 100000}));
    model.width('6000');
    assert.match(model.validate(), /ширин|width/iu);
    model.width('5000');
    assert.isNull(model.validate());
});

test('a too large search area is rejected', function () {
    const model = makeModel({getAreaBounds: () => [40, 20, 50, 30]});
    model.categories.setSelectedIds(['spring']);
    assert.match(model.validate(), /област|area/iu);
});

test('the search button cancels the running search', function () {
    let cancelled = 0;
    const model = makeModel({
        onCancel: () => {
            cancelled += 1;
        },
    });
    model.searching(true);
    assert.match(model.searchButtonText(), /Отменить|Cancel/u);
    model.onSearchArea();
    model.onSearchCorridor();
    assert.equal(cancelled, 2);
    model.searching(false);
    assert.match(model.searchButtonText(), /Искать|Search/u);
});

test('a partial result warns that a part of the area is not loaded', function () {
    const model = makeModel();
    model.setSearchResults({pois: [{...makePoi(1, {natural: 'spring'}), categoryId: 'spring'}], partial: true});
    assert.match(model.warning(), /часть|part/iu);
});

test('a failed save is reported and keeps the selection', function () {
    const model = makeModel({onSaveWaypoints: () => false});
    model.setSearchResults({pois: [{...makePoi(1, {natural: 'spring'}), categoryId: 'spring'}], truncated: false});
    model.results()[0].kept(true);
    model.onSaveSelected();
    assert.equal(model.keptCount(), 1);
    assert.match(model.error(), /сохран|save/iu);
});

test('the corridor range must fit the track length', function () {
    const model = makeModel();
    model.categories.setSelectedIds(['spring']);
    model.mode('corridor');
    model.selectedTrack(makeTrack({trackLength: 10000}));
    model.width('200');
    assert.equal(model.startKm(), '0');
    assert.equal(model.endKm(), '10.0');
    assert.isNull(model.validate());
    model.startKm('5');
    model.endKm('4');
    assert.match(model.validate(), /меньше|less/u);
    model.startKm('0');
    model.endKm('20');
    assert.match(model.validate(), /длины|length/u);
});

test('the area search parameters use the area bounds', function () {
    const model = makeModel();
    model.categories.setSelectedIds(['spring']);
    const params = model.getSearchParams();
    assert.equal(params.mode, 'area');
    assert.deepEqual(params.bbox, [49.7, 33.4, 49.8, 33.5]);
    assert.deepEqual(
        params.categories.map((category) => category.id),
        ['spring']
    );
});

test('the corridor search parameters use the kilometer range', function () {
    const model = makeModel();
    model.categories.setSelectedIds(['spring']);
    model.mode('corridor');
    model.selectedTrack(makeTrack({trackLength: 10000}));
    model.width('300');
    model.startKm('1');
    model.endKm('5');
    const params = model.getSearchParams();
    assert.equal(params.mode, 'corridor');
    assert.equal(params.widthMeters, 300);
    assert.equal(params.startMeters, 1000);
    assert.equal(params.endMeters, 5000);
});

test('the track list offers only tracks with a geometry', function () {
    const tracklist = {
        tracks: ko.observableArray([
            makeTrack({trackName: 'With line'}),
            makeTrack({trackName: 'Empty', withLine: false}),
        ]),
    };
    const model = makeModel({tracklist});
    assert.lengthOf(model.trackOptions(), 1);
    assert.equal(model.trackOptions()[0].name(), 'With line');
});

test('search results fill the list and the category counters', function () {
    const model = makeModel();
    model.setSearchResults({
        pois: [
            {...makePoi(1, {natural: 'spring', name: 'A'}), categoryId: 'spring', distance: 45, alongMeters: 1000},
            {...makePoi(2, {natural: 'spring'}), categoryId: 'spring', distance: 60, alongMeters: 2000},
        ],
        truncated: true,
    });
    assert.lengthOf(model.results(), 2);
    assert.equal(model.results()[0].name, 'A');
    assert.equal(model.keptCount(), 0);
    assert.equal(model.categories.allCategories.find((category) => category.id === 'spring').count(), 2);
    assert.match(model.warning(), /не все|not all/iu);
});

test('saving the selected points calls back with waypoints', function () {
    let saved = null;
    const model = makeModel({
        onSaveWaypoints: (waypoints) => {
            saved = waypoints;
        },
    });
    model.setSearchResults({
        pois: [{...makePoi(1, {natural: 'spring', name: 'A'}), categoryId: 'spring'}],
        truncated: false,
    });
    model.results()[0].kept(true);
    assert.equal(model.keptCount(), 1);
    model.onSaveSelected();
    assert.lengthOf(saved, 1);
    assert.equal(saved[0].name, 'A');
    assert.equal(model.keptCount(), 0);
    assert.match(model.status(), /Сохранено|Saved/u);
});

test('the progress shows the request counter and the found points', function () {
    const model = makeModel();
    model.searching(true);
    assert.match(model.progressText(), /Идёт поиск|Searching/u);
    model.setProgress({done: 0, total: 3, found: 0});
    assert.match(model.progressText(), /1 из 3|1 of 3/u);
    model.setProgress({done: 1, total: 3, found: 7});
    assert.match(model.progressText(), /2 из 3|2 of 3/u);
    assert.match(model.progressText(), /7/u);
    assert.equal(model.progressWidth(), '33%');
    model.searching(false);
    assert.equal(model.progressText(), '');
});

test('the progress shows the source title', function () {
    const model = makeModel();
    model.searching(true);
    model.setProgress({done: 0, total: 2, found: 3, sourceTitle: 'Wikidata'});
    assert.match(model.progressText(), /Wikidata/u);
    assert.match(model.progressText(), /3/u);
    model.searching(false);
});

test('the enabled sources are used for the search', function () {
    const model = makeModel();
    assert.deepEqual(
        model.getEnabledSources().map((source) => source.id),
        ['osm', 'wikidata']
    );
    model.setSources(['wikidata']);
    assert.deepEqual(
        model.getEnabledSources().map((source) => source.id),
        ['wikidata']
    );
    // without OSM the categories are not required
    assert.isNull(model.validate());
    model.setSources(['osm']);
    assert.match(model.validate(), /категор|category/u);
    model.setSources([]);
    assert.match(model.validate(), /источник|source/iu);
});

test('the inaturalist source needs a login', function () {
    setInatUsername('');
    const model = makeModel();
    const source = model.sources.find((item) => item.id === 'inaturalist');
    assert.isFalse(source.configured());
    assert.match(source.hint(), /логин|login/iu);
    model.inatUsername('tester');
    model.onInatUsernameChanged();
    assert.isTrue(source.configured());
    setInatUsername('');
});

test('the results open in their own tab after a search', function () {
    const model = makeModel();
    assert.equal(model.activeTab(), 'categories');
    model.setSearchResults({pois: [], truncated: false});
    assert.equal(model.activeTab(), 'categories', 'nothing to show, the categories stay');
    model.setSearchResults({
        pois: [{...makePoi(1, {natural: 'spring'}), categoryId: 'spring'}],
        truncated: false,
    });
    assert.equal(model.activeTab(), 'results');
    model.onCategoriesTab();
    assert.equal(model.activeTab(), 'categories');
});

test('the tab titles show the selected categories and the results', function () {
    const model = makeModel();
    assert.match(model.categoriesTabText(), /Категории|categories/iu);
    assert.match(model.resultsTabText(), /Результаты|Results/u);
    model.categories.setSelectedIds(['spring']);
    model.setSearchResults({
        pois: [{...makePoi(1, {natural: 'spring'}), categoryId: 'spring'}],
        truncated: false,
    });
    assert.match(model.categoriesTabText(), /\(1\)/u);
    assert.match(model.resultsTabText(), /\(1\)/u);
});

test('the categories tab is named after OSM', function () {
    const model = makeModel();
    assert.match(model.categoriesTabText(), /OSM/u);
});

test('the category groups are collapsed by default and can be expanded', function () {
    const model = makeModel();
    const group = model.categories.groups[0];
    assert.isFalse(group.expanded());
    group.onToggleExpanded();
    assert.isTrue(group.expanded());
    assert.deepEqual(model.categories.getExpandedGroupIds(), [group.id]);
    model.categories.setExpandedGroupIds([]);
    assert.isFalse(group.expanded());
});

test('a search in the categories expands the matching groups', function () {
    const model = makeModel();
    const collapsed = model.categories.visibleGroups().find((group) => group.categories.some((c) => c.id === 'spring'));
    assert.isFalse(collapsed.expanded(), 'collapsed without a search');
    model.categories.query('родник');
    const filtered = model.categories.visibleGroups().find((group) => group.categories.some((c) => c.id === 'spring'));
    assert.isTrue(filtered.expanded(), 'expanded while searching');
});

test('a click on a result asks to show the point on the map', function () {
    let shown = null;
    const model = makeModel({
        onShowResult: (result) => {
            shown = result;
        },
    });
    model.setSearchResults({
        pois: [{...makePoi(1, {natural: 'spring', name: 'A'}), categoryId: 'spring'}],
        truncated: false,
    });
    model.results()[0].onClick();
    assert.equal(shown, model.results()[0]);
});

test('the inaturalist checkbox works without a login and asks for it', function () {
    setInatUsername('');
    const model = makeModel();
    const source = model.sources.find((item) => item.id === 'inaturalist');
    assert.isFalse(source.configured());
    source.enabled(true);
    model.categories.setSelectedIds(['spring']);
    assert.match(model.validate(), /логин|login/iu);
    model.inatUsername('tester');
    assert.isTrue(source.configured(), 'the typed login is applied at once');
    assert.isNull(model.validate());
    setInatUsername('');
});

test('clearing the results empties the list and the counters', function () {
    const model = makeModel();
    model.setSearchResults({
        pois: [{...makePoi(1, {natural: 'spring'}), categoryId: 'spring'}],
        truncated: false,
    });
    model.onClear();
    assert.lengthOf(model.results(), 0);
    assert.equal(model.categories.allCategories.find((category) => category.id === 'spring').count(), 0);
});

suite('POI discovery panel template');

function renderPanel(model) {
    const container = document.createElement('div');
    container.innerHTML = layout;
    ko.applyBindings(model, container);
    return container;
}

test('the track dropdown fills the range defaults when a track is selected', function () {
    const track = makeTrack({trackName: 'T1', trackLength: 10000});
    const model = makeModel({tracklist: {tracks: ko.observableArray([track])}});
    const container = renderPanel(model);
    const select = container.querySelector('.poi-discovery-track');
    assert.lengthOf(select.options, 2);
    assert.match(select.options[1].text, /T1 — 10\.0 (км|km)/u);
    select.selectedIndex = 1;
    select.dispatchEvent(new Event('change'));
    assert.strictEqual(model.selectedTrack(), track);
    assert.equal(model.startKm(), '0');
    assert.equal(model.endKm(), '10.0');
    ko.cleanNode(container);
});

test('the mode buttons show the parameters of the selected mode', function () {
    const model = makeModel();
    const container = renderPanel(model);
    const [areaParams, corridorParams] = container.querySelectorAll('.poi-discovery-params');
    assert.notEqual(areaParams.style.display, 'none');
    assert.equal(corridorParams.style.display, 'none');
    model.mode('corridor');
    assert.equal(areaParams.style.display, 'none');
    assert.notEqual(corridorParams.style.display, 'none');
    ko.cleanNode(container);
});

test('the categories and the results live in separate tabs', function () {
    const model = makeModel();
    model.setSearchResults({
        pois: [{...makePoi(1, {natural: 'spring', name: 'A'}), categoryId: 'spring'}],
        truncated: false,
    });
    const container = renderPanel(model);
    const categoriesBlock = container.querySelector('.poi-discovery-categories');
    const resultsBlock = container.querySelector('.poi-discovery-results');
    assert.equal(categoriesBlock.style.display, 'none', 'the search opened the results tab');
    assert.notEqual(resultsBlock.style.display, 'none');
    model.onCategoriesTab();
    assert.notEqual(categoriesBlock.style.display, 'none');
    assert.equal(resultsBlock.style.display, 'none');
    model.onResultsTab();
    assert.equal(categoriesBlock.style.display, 'none');
    assert.notEqual(resultsBlock.style.display, 'none');
    ko.cleanNode(container);
});

test('the inaturalist checkbox is not disabled', function () {
    const model = makeModel();
    const container = renderPanel(model);
    const inputs = container.querySelectorAll('.poi-discovery-source input');
    assert.lengthOf(inputs, 3);
    assert.isFalse(inputs[2].disabled);
    ko.cleanNode(container);
});

test('a click on a result row asks to show the point', function () {
    let shown = null;
    const model = makeModel({
        onShowResult: (result) => {
            shown = result;
        },
    });
    model.setSearchResults({
        pois: [{...makePoi(1, {natural: 'spring', name: 'A'}), categoryId: 'spring'}],
        truncated: false,
    });
    const container = renderPanel(model);
    container.querySelector('.poi-discovery-result-content').click();
    assert.isOk(shown);
    assert.equal(shown.poi.id, 1);
    ko.cleanNode(container);
});

test('the results list renders the found points and enables saving', function () {
    const model = makeModel();
    model.setSearchResults({
        pois: [{...makePoi(1, {natural: 'spring', name: 'A'}), categoryId: 'spring'}],
        truncated: false,
    });
    const container = renderPanel(model);
    assert.lengthOf(container.querySelectorAll('.poi-discovery-result'), 1);
    const saveButton = container.querySelector('.poi-discovery-save');
    assert.isTrue(saveButton.disabled);
    model.results()[0].kept(true);
    assert.isFalse(saveButton.disabled);
    assert.match(saveButton.textContent, /1/u);
    ko.cleanNode(container);
});

suite('POI discovery control');

function makeControl(tracklist, {keepSettings = false} = {}) {
    if (!keepSettings) {
        safeLocalStorage.removeItem('leafletPoiDiscoverySettings');
    }
    const control = {onAdd: () => document.createElement('div')};
    enablePoiDiscovery(control, {tracklist, overpassUrls: ['http://example.com/']});
    control._topRow = document.createElement('div');
    const layers = new Set();
    control._map = {
        getBounds: () => L.latLngBounds([49.6, 33.3], [49.8, 33.5]),
        hasLayer: (layer) => layers.has(layer),
        addLayer: (layer) => layers.add(layer),
        removeLayer: (layer) => layers.delete(layer),
        _controlContainer: document.createElement('div'),
    };
    control._initPoiDiscovery();
    return control;
}

test('the corridor search filters the points and saves the selection as waypoints', async function () {
    const track = makeTrack({
        trackName: 'T1',
        trackLength: 2000,
        line: L.polyline([
            [49.7, 33.4],
            [49.72, 33.4],
        ]),
    });
    const saved = [];
    const tracklist = {
        tracks: ko.observableArray([track]),
        addTrack: (geodata) => saved.push(geodata),
    };
    const control = makeControl(tracklist);
    let layerPois = null;
    control._poiDiscoveryLayer = {
        setPois: (pois) => {
            layerPois = pois;
        },
    };
    control._poiDiscoveryClient = makeStubClient(() => ({
        elements: [
            makePoi(1, {natural: 'spring', name: 'A'}, 49.71, 33.4),
            makePoi(2, {natural: 'spring'}, 49.71, 33.45),
        ],
    }));
    const model = control._poiDiscoveryModel;
    model.setSources(['osm']);
    model.categories.setSelectedIds(['spring']);
    model.mode('corridor');
    model.selectedTrack(track);
    model.width('200');
    model.onSearchCorridor();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.lengthOf(layerPois, 1);
    assert.equal(layerPois[0].id, 1);
    assert.closeTo(layerPois[0].distance, 0, 1);
    assert.lengthOf(model.results(), 1);
    assert.isTrue(control._map.hasLayer(control._corridorLine), 'the corridor is highlighted');
    model.results()[0].kept(true);
    model.onSaveSelected();
    assert.lengthOf(saved, 1);
    assert.equal(saved[0].name, 'POI: T1 0–2 km');
    assert.lengthOf(saved[0].points, 1);
    assert.equal(saved[0].points[0].name, 'A');
    assert.include(saved[0].points[0].meta.desc, 'https://www.openstreetmap.org/node/1');
    assert.isFalse(control._map.hasLayer(control._corridorLine), 'the corridor highlight is removed');
    ko.cleanNode(control._poiDiscoveryWindow);
});

test('the expanded groups are stored in the settings', function () {
    safeLocalStorage.removeItem('leafletPoiDiscoverySettings');
    const control = makeControl(null);
    const model = control._poiDiscoveryModel;
    const group = model.categories.groups[0];
    group.onToggleExpanded();
    assert.deepEqual(JSON.parse(safeLocalStorage.getItem('leafletPoiDiscoverySettings')).expandedGroups, [group.id]);
    const reloaded = makeControl(null, {keepSettings: true});
    reloaded._loadPoiDiscoverySettings();
    assert.isTrue(reloaded._poiDiscoveryModel.categories.groups[0].expanded());
    ko.cleanNode(control._poiDiscoveryWindow);
    ko.cleanNode(reloaded._poiDiscoveryWindow);
    safeLocalStorage.removeItem('leafletPoiDiscoverySettings');
});

test('loading the settings twice keeps the sources and the expanded groups', function () {
    safeLocalStorage.removeItem('leafletPoiDiscoverySettings');
    const control = makeControl(null);
    const model = control._poiDiscoveryModel;
    model.setSources(['osm']);
    model.width('300');
    model.mode('corridor');
    model.categories.setSelectedIds(['spring']);
    model.categories.groups[0].onToggleExpanded();
    const groupId = model.categories.groups[0].id;
    assert.deepEqual(JSON.parse(safeLocalStorage.getItem('leafletPoiDiscoverySettings')).sources, ['osm']);
    assert.deepEqual(JSON.parse(safeLocalStorage.getItem('leafletPoiDiscoverySettings')).expandedGroups, [groupId]);

    // the first load must not overwrite the stored settings with the defaults
    const first = makeControl(null, {keepSettings: true});
    first._loadPoiDiscoverySettings();
    const afterFirst = JSON.parse(safeLocalStorage.getItem('leafletPoiDiscoverySettings'));
    assert.deepEqual(afterFirst.sources, ['osm'], 'the sources survive the load');
    assert.deepEqual(afterFirst.expandedGroups, [groupId], 'the expanded groups survive the load');

    const second = makeControl(null, {keepSettings: true});
    second._loadPoiDiscoverySettings();
    assert.deepEqual(second._poiDiscoveryModel.getEnabledSourceIds(), ['osm']);
    assert.isTrue(second._poiDiscoveryModel.categories.groups[0].expanded());

    for (const item of [control, first, second]) {
        ko.cleanNode(item._poiDiscoveryWindow);
    }
    safeLocalStorage.removeItem('leafletPoiDiscoverySettings');
});

test('the panel cancels the running search', async function () {
    const control = makeControl(null);
    let aborted = false;
    control._poiDiscoveryClient = {
        query: () => ({
            promise: new Promise(() => {
                // the response never arrives
            }),
            abort: () => {
                aborted = true;
            },
        }),
    };
    const model = control._poiDiscoveryModel;
    model.setSources(['osm']);
    model.mode('area');
    model.categories.setSelectedIds(['spring']);
    model.onSearchArea();
    assert.isTrue(model.searching(), 'the search is running');
    model.onSearchArea();
    assert.isFalse(model.searching());
    assert.isTrue(aborted);
    assert.isNull(control._poiDiscoverySearchState);
    ko.cleanNode(control._poiDiscoveryWindow);
});

test('the settings survive a reload without losing the categories', function () {
    safeLocalStorage.removeItem('leafletPoiDiscoverySettings');
    const control = makeControl(null);
    const model = control._poiDiscoveryModel;
    model.mode('corridor');
    model.width('300');
    model.setSelectedIds(['spring']);
    control._savePoiDiscoverySettings();
    ko.cleanNode(control._poiDiscoveryWindow);

    const reloaded = makeControl(null, {keepSettings: true});
    reloaded._loadPoiDiscoverySettings();
    assert.equal(reloaded._poiDiscoveryModel.mode(), 'corridor');
    assert.equal(reloaded._poiDiscoveryModel.width(), '300');
    assert.deepEqual(reloaded._poiDiscoveryModel.getSelectedIds(), ['spring']);
    assert.deepEqual(JSON.parse(safeLocalStorage.getItem('leafletPoiDiscoverySettings')).categories, ['spring']);
    ko.cleanNode(reloaded._poiDiscoveryWindow);
    safeLocalStorage.removeItem('leafletPoiDiscoverySettings');
});

test('a key entered in the highlight panel is picked up before a search', function () {
    const control = makeControl(null);
    const applied = [];
    control._poiDiscoveryClient = {
        setUrls: (urls) => applied.push(urls),
    };
    setUserKey('test-key');
    control._applyPoiDiscoveryOverpassUrls();
    assert.include(applied[0][0], 'overpass.nextgis.com');
    assert.include(applied[0][0], 'test-key');
    setUserKey('');
    ko.cleanNode(control._poiDiscoveryWindow);
});

test('a failing source does not block the others', async function () {
    const control = makeControl(null);
    const model = control._poiDiscoveryModel;
    model.setSources(['osm', 'wikidata']);
    model.categories.setSelectedIds(['spring']);
    control._poiDiscoveryClient = {
        query: () => ({
            promise: Promise.reject(new Error('overpass is down')),
            abort: () => {
                // emulate the abort of xhr-promise
            },
        }),
        setUrls: () => {
            // the endpoints are not changed in the test
        },
    };
    const runner = require('~/lib/poi-discovery/sources/runner');
    const originalFetch = runner.__get__('fetch');
    runner.__set__('fetch', () => {
        const promise = Promise.resolve({
            responseJSON: {
                results: {
                    bindings: [
                        {
                            item: {value: 'http://www.wikidata.org/entity/Q1'},
                            itemLabel: {value: 'Замок'},
                            location: {value: 'Point(33.45 49.75)'},
                        },
                    ],
                },
            },
        });
        promise.abort = () => {
            // emulate the abort of xhr-promise
        };
        return promise;
    });
    try {
        model.onSearchArea();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.lengthOf(model.results(), 1);
        assert.equal(model.results()[0].category.id, 'wikidata_place');
        assert.match(model.warning(), /часть|part/iu);
    } finally {
        runner.__set__('fetch', originalFetch);
        ko.cleanNode(control._poiDiscoveryWindow);
    }
});

test('the track name comes from the search that was started', async function () {
    const track = makeTrack({
        trackName: 'T1',
        trackLength: 10000,
        line: L.polyline([
            [49.7, 33.4],
            [49.72, 33.4],
        ]),
    });
    const other = makeTrack({
        trackName: 'T2',
        trackLength: 5000,
        line: L.polyline([
            [49.8, 33.4],
            [49.82, 33.4],
        ]),
    });
    const saved = [];
    const control = makeControl({
        tracks: ko.observableArray([track, other]),
        addTrack: (geodata) => saved.push(geodata),
    });
    control._poiDiscoveryLayer = {
        setPois: () => {
            // the layer is not checked here
        },
    };
    control._poiDiscoveryClient = makeStubClient(() => ({
        elements: [makePoi(1, {natural: 'spring', name: 'A'}, 49.71, 33.4)],
    }));
    const model = control._poiDiscoveryModel;
    model.setSources(['osm']);
    model.categories.setSelectedIds(['spring']);
    model.mode('corridor');
    model.selectedTrack(track);
    model.width('200');
    model.onSearchCorridor();
    // the user changes the track while the search is running
    model.selectedTrack(other);
    await new Promise((resolve) => setTimeout(resolve, 0));
    model.results()[0].kept(true);
    model.onSaveSelected();
    assert.match(saved[0].name, /T1/u, 'the name uses the track of the started search');
    ko.cleanNode(control._poiDiscoveryWindow);
});

test('the panel can be dragged by its header and remembers the position', function () {
    const control = makeControl(null);
    const container = control._poiDiscoveryWindow;
    const header = container.querySelector('.poi-discovery-header');
    assert.isOk(header, 'the header is the drag handle');
    safeLocalStorage.removeItem('leafletPoiDiscoveryWindowPosition');
    header.dispatchEvent(new MouseEvent('mousedown', {clientX: 100, clientY: 100, button: 0, bubbles: true}));
    document.dispatchEvent(new MouseEvent('mousemove', {clientX: 140, clientY: 130, bubbles: true}));
    document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
    assert.equal(container.style.left, '40px');
    assert.equal(container.style.top, '30px');
    assert.equal(container.style.transform, 'none');
    assert.equal(container.style.bottom, 'auto', 'the window is not squeezed by the bottom anchor');
    assert.match(container.style.height, /px$/u, 'the height is fixed while the window is moved');
    assert.equal(container.style.boxSizing, 'border-box', 'the bottom padding stays inside the height');
    const height = Number.parseInt(container.style.height, 10);
    assert.isAtMost(height, window.innerHeight, 'the window is not taller than the visible area');
    assert.isAtMost(
        Number.parseInt(container.style.top, 10) + height,
        window.innerHeight,
        'the window fits the screen'
    );
    const saved = JSON.parse(safeLocalStorage.getItem('leafletPoiDiscoveryWindowPosition'));
    assert.isNumber(saved.left);
    assert.isNumber(saved.top);
    // the position is clamped, so that a part of the window always stays on the screen
    control._setPoiDiscoveryWindowPosition(container, 100000, 100000);
    assert.isBelow(Number.parseInt(container.style.left, 10), 100000);
    assert.isBelow(Number.parseInt(container.style.top, 10), 100000);
    ko.cleanNode(container);
    safeLocalStorage.removeItem('leafletPoiDiscoveryWindowPosition');
});

test('a track is named after the search that produced the results', function () {
    const track = makeTrack({trackName: 'T1', trackLength: 10000});
    const control = makeControl({tracks: ko.observableArray([track])});
    const model = control._poiDiscoveryModel;
    model.categories.setSelectedIds(['spring']);
    model.mode('corridor');
    model.selectedTrack(track);
    model.startKm('1');
    model.endKm('5');
    model.setSearchResults({pois: [], truncated: false});
    assert.equal(model.lastSearch.mode, 'corridor', 'the search mode is remembered');
    assert.strictEqual(model.lastSearch.track, track, 'the searched track is remembered');
    assert.equal(model.lastSearch.range.start, 1, 'the range start is remembered');
    model.mode('area');
    assert.equal(control._getPoiDiscoveryTrackName(), 'POI: T1 1–5 km');
    ko.cleanNode(control._poiDiscoveryWindow);
});

suite('POI discovery layer');

function makeLayer() {
    const layer = new PoiDiscoveryLayer();
    layer.redraw = () => {
        // do not touch the real tiles in tests
    };
    return layer;
}

test('the layer creates a marker for every found point', function () {
    const layer = makeLayer();
    layer.setPois([{...makePoi(1, {natural: 'spring', name: 'A'}), categoryId: 'spring', sourceId: 'osm'}]);
    assert.lengthOf(layer._markers, 1);
    assert.equal(layer._markers[0].latlng.lat, 49.7);
    assert.equal(layer._markers[0].tooltip, 'A');
    assert.equal(layer._markers[0].properties.poi.id, 1);
    assert.isString(layer._markers[0].icon.url);
});

test('the layer clears its markers', function () {
    const layer = makeLayer();
    layer.setPois([{...makePoi(1, {natural: 'spring'}), categoryId: 'spring'}]);
    layer.clear();
    assert.lengthOf(layer._markers, 0);
    assert.lengthOf(layer.getPois(), 0);
});

test('the popup info shows the source and the position in the corridor', function () {
    const layer = makeLayer();
    const poi = {
        ...makePoi(1, {natural: 'spring', name: 'A'}),
        categoryId: 'spring',
        sourceId: 'osm',
        distance: 45,
        alongMeters: 12300,
    };
    const info = layer._buildExtraInfo(poi);
    assert.include(info, 'OpenStreetMap');
    assert.match(info, /12\.3/u);
    assert.match(info, /45 (м|m)/u);
});

test('a point without the corridor data has no extra info', function () {
    const layer = makeLayer();
    assert.equal(layer._buildExtraInfo({...makePoi(1, {natural: 'spring'}), categoryId: 'spring'}), '');
});

test('the layer shows the attribution of the point source in the popup', function () {
    const layer = makeLayer();
    const poi = {...makePoi('Q1', {name: 'Замок'}, 49.7, 33.4, 'wikidata'), sourceId: 'wikidata'};
    assert.match(layer._getAttribution(poi), /Wikidata/u);
    const osmPoi = {...makePoi(1, {natural: 'spring'}), sourceId: 'osm'};
    assert.match(layer._getAttribution(osmPoi), /OpenStreetMap/u);
    assert.equal(layer._getAttribution({...osmPoi, sourceId: 'unknown'}), '');
});

test('the layer shows the point of a result', function () {
    const layer = makeLayer();
    const poi = {...makePoi(1, {natural: 'spring', name: 'A'}), categoryId: 'spring'};
    layer.setPois([poi]);
    const calls = [];
    layer._map = {
        panTo: (latlng) => calls.push(['pan', latlng.lat]),
        openPopup: () => calls.push(['popup']),
        fitBounds: () => calls.push(['fit']),
        getMaxZoom: () => 18,
    };
    layer.showPoi(poi);
    assert.deepEqual(calls[0], ['pan', 49.7]);
    assert.deepEqual(calls[1], ['popup']);
});

test('a click on a cluster fits its bounds, a click on a point opens its popup', function () {
    const layer = makeLayer();
    const calls = [];
    layer._map = {
        openPopup: () => calls.push('popup'),
        fitBounds: () => calls.push('fit'),
        getMaxZoom: () => 18,
    };
    const clusterMarker = {
        latlng: L.latLng(49.7, 33.4),
        _cluster: {count: 2, markers: [], bounds: L.latLngBounds([49.7, 33.4], [49.71, 33.41])},
    };
    layer._onMarkerClick({marker: clusterMarker});
    assert.deepEqual(calls, ['fit']);
    const poi = {...makePoi(1, {natural: 'spring', name: 'A'}), categoryId: 'spring'};
    layer._onMarkerClick({marker: {latlng: L.latLng(49.7, 33.4), properties: {poi, category: getCategory('spring')}}});
    assert.deepEqual(calls, ['fit', 'popup']);
});

suite('POI discovery source categories');

test('the results of every source resolve to a category', function () {
    assert.equal(getPoiCategory('spring').id, 'spring');
    assert.equal(getPoiCategory('wikidata_place').id, 'wikidata_place');
    assert.equal(getPoiCategory('inat_species').id, 'inat_species');
    assert.isUndefined(getPoiCategory('unknown'));
});

test('the source categories have icons and titles', function () {
    for (const id of ['wikidata_place', 'inat_species']) {
        const category = getPoiCategory(id);
        assert.isString(category.icon);
        assert.isString(category.titleRu);
        assert.isString(category.titleEn);
        assert.isUndefined(category.groupId, 'the source color is used instead of the group color');
    }
});

test('the popup links to the source page for a point of another source', function () {
    const poi = {
        ...makePoi('Q1', {name: 'Замок'}, 49.7, 33.4, 'wikidata'),
        link: {url: 'https://www.wikidata.org/entity/Q1', text: 'Open in Wikidata'},
    };
    assert.include(getPoiLink(poi).url, 'wikidata.org/entity/Q1');
    assert.include(getPoiLink(makePoi(42, {natural: 'spring'})).url, 'openstreetmap.org/node/42');
    assert.isNull(getPoiLink({type: 'unknown', id: 'x'}));
});

test('the popup credits the source of the point', function () {
    const poi = {...makePoi('Q1', {name: 'Замок'}, 49.7, 33.4, 'wikidata'), sourceId: 'wikidata'};
    const html = buildPoiPopupHtml(poi, getPoiCategory('wikidata_place'), '', '© Wikidata contributors (CC0)');
    assert.include(html, 'Wikidata contributors');
    const osmHtml = buildPoiPopupHtml(makePoi(42, {natural: 'spring'}), getCategory('spring'));
    assert.include(osmHtml, 'OpenStreetMap contributors');
});

suite('POI discovery source circles');

test('a small area is covered by a single circle', function () {
    const {circles, truncated} = buildAreaCircles([49.7, 33.4, 49.75, 33.45], 25000);
    assert.lengthOf(circles, 1);
    assert.isFalse(truncated);
    assert.closeTo(circles[0].lat, 49.725, 1e-6);
    assert.closeTo(circles[0].lng, 33.425, 1e-6);
    assert.isBelow(circles[0].radiusMeters, 25000);
});

test('a large area is covered by circles of the given radius', function () {
    const {circles, truncated} = buildAreaCircles([40, 20, 50, 30], 25000, 1000);
    assert.isAbove(circles.length, 1);
    assert.isFalse(truncated);
    for (const circle of circles) {
        assert.isAtMost(circle.radiusMeters, 25000);
        assert.lengthOf(circle.bbox, 4);
    }
});

test('a circle covers the corners of its part of the area', function () {
    const {circles} = buildAreaCircles([60, 29, 62, 31], 25000);
    assert.isAbove(circles.length, 1);
    for (const circle of circles) {
        const [south, west, north, east] = circle.bbox;
        for (const corner of [
            {lat: south, lng: west},
            {lat: south, lng: east},
            {lat: north, lng: west},
            {lat: north, lng: east},
        ]) {
            const distance = haversineDistance({lat: circle.lat, lng: circle.lng}, corner);
            assert.isAtMost(distance, circle.radiusMeters + 1, 'the circle covers its corners');
        }
    }
});

test('an elongated area is split along its axes, not into a square grid', function () {
    const {circles, truncated} = buildAreaCircles([0, 0, 0.5, 3.5], 25000);
    assert.isFalse(truncated);
    assert.isAtMost(circles.length, 25, 'the number of circles is capped');
    const lngs = new Set(circles.map((circle) => circle.lng));
    assert.isAbove(lngs.size, 5, 'the long axis is split into more parts');
});

test('hitting the circles limit reports the truncation', function () {
    const {circles, truncated} = buildAreaCircles([40, 20, 50, 30], 5000, 4);
    assert.lengthOf(circles, 4);
    assert.isTrue(truncated);
});

test('the corridor is covered by circles around its chunks', function () {
    const segments = [
        {
            points: [
                {lat: 49.7, lng: 33.4},
                {lat: 49.9, lng: 33.4},
            ],
            offsetMeters: 0,
        },
    ];
    const {circles, truncated} = buildCorridorCircles(segments, 200);
    assert.isAbove(circles.length, 1);
    assert.isFalse(truncated);
    for (const circle of circles) {
        assert.isBelow(circle.radiusMeters, 25000);
    }
});

test('the corridor truncation is reported when the chunks limit is hit', function () {
    const segments = [
        {
            points: [
                {lat: 49.7, lng: 33.4},
                {lat: 49.9, lng: 33.4},
            ],
            offsetMeters: 0,
        },
    ];
    const {truncated} = buildCorridorCircles(segments, 200, 1);
    assert.isTrue(truncated);
});

test('a point is checked against the bbox', function () {
    assert.isTrue(isInsideBbox({lat: 49.75, lon: 33.45}, [49.7, 33.4, 49.8, 33.5]));
    assert.isFalse(isInsideBbox({lat: 60, lon: 40}, [49.7, 33.4, 49.8, 33.5]));
    // a wrapped longitude of a point near an unwrapped area
    assert.isTrue(isInsideBbox({lat: 49.75, lon: -179.95}, [49.7, 179.9, 49.8, 180.1]));
});

suite('POI discovery wikidata source');

test('the wikidata response is parsed into points', function () {
    const pois = parseWikidataResponse({
        results: {
            bindings: [
                {
                    item: {value: 'http://www.wikidata.org/entity/Q123'},
                    itemLabel: {value: 'Замок'},
                    location: {value: 'Point(33.45 49.75)'},
                    instanceOfLabel: {value: 'castle'},
                },
                {item: {value: 'http://www.wikidata.org/entity/Q456'}, location: {value: 'broken'}},
            ],
        },
    });
    assert.lengthOf(pois, 1);
    assert.equal(pois[0].id, 'Q123');
    assert.equal(pois[0].type, 'wikidata');
    assert.closeTo(pois[0].lat, 49.75, 1e-6);
    assert.closeTo(pois[0].lon, 33.45, 1e-6);
    assert.equal(pois[0].tags.name, 'Замок');
    assert.include(pois[0].description, 'castle');
    assert.equal(pois[0].categoryId, 'wikidata_place');
    assert.include(pois[0].link.url, 'Q123');
});

test('the wikidata source keeps only the points inside the area', async function () {
    const runner = require('~/lib/poi-discovery/sources/runner');
    const originalFetch = runner.__get__('fetch');
    runner.__set__('fetch', () => {
        const promise = Promise.resolve({
            responseJSON: {
                results: {
                    bindings: [
                        {
                            item: {value: 'http://www.wikidata.org/entity/Q1'},
                            itemLabel: {value: 'Inside'},
                            location: {value: 'Point(33.45 49.75)'},
                        },
                        {
                            item: {value: 'http://www.wikidata.org/entity/Q2'},
                            itemLabel: {value: 'Outside'},
                            location: {value: 'Point(40 60)'},
                        },
                    ],
                },
            },
        });
        promise.abort = () => {
            // emulate the abort of xhr-promise
        };
        return promise;
    });
    try {
        const handle = wikidataSource.search({mode: 'area', bbox: [49.7, 33.4, 49.8, 33.5]}, {});
        const result = await handle.promise;
        assert.lengthOf(result.pois, 1);
        assert.equal(result.pois[0].id, 'Q1');
        assert.equal(result.pois[0].sourceId, 'wikidata');
        assert.isFalse(result.partial);
    } finally {
        runner.__set__('fetch', originalFetch);
    }
});

test('the wikidata source filters the corridor by the distance to the track', async function () {
    const runner = require('~/lib/poi-discovery/sources/runner');
    const originalFetch = runner.__get__('fetch');
    runner.__set__('fetch', () => {
        const promise = Promise.resolve({
            responseJSON: {
                results: {
                    bindings: [
                        {
                            item: {value: 'http://www.wikidata.org/entity/Q1'},
                            itemLabel: {value: 'On the track'},
                            location: {value: 'Point(33.4 49.71)'},
                        },
                        {
                            item: {value: 'http://www.wikidata.org/entity/Q2'},
                            itemLabel: {value: 'Far away'},
                            location: {value: 'Point(33.45 49.71)'},
                        },
                    ],
                },
            },
        });
        promise.abort = () => {
            // emulate the abort of xhr-promise
        };
        return promise;
    });
    try {
        const handle = wikidataSource.search(
            {
                mode: 'corridor',
                segments: [
                    {
                        points: [
                            {lat: 49.7, lng: 33.4},
                            {lat: 49.72, lng: 33.4},
                        ],
                        offsetMeters: 0,
                    },
                ],
                widthMeters: 200,
            },
            {}
        );
        const result = await handle.promise;
        assert.deepEqual(
            result.pois.map((poi) => poi.id),
            ['Q1']
        );
        assert.closeTo(result.pois[0].alongMeters, 1111.9, 5);
    } finally {
        runner.__set__('fetch', originalFetch);
    }
});

suite('POI discovery inaturalist source');

test('the month window covers the two weeks around today', function () {
    const months = getMonths(new Date('2026-10-01T12:00:00'));
    assert.include(months, 10);
    assert.include(months, 9);
    assert.isBelow(months.length, 4);
});

test('the time of day buckets are resolved', function () {
    assert.equal(getTimeBucket('2026-10-01T05:00:00').titleEn, 'Early morning');
    assert.equal(getTimeBucket('2026-10-01T12:00:00').titleEn, 'Midday');
    assert.equal(getTimeBucket('2026-10-01T23:00:00').titleEn, 'Late evening');
    assert.isNull(getTimeBucket(''));
});

test('the most observed taxon is chosen', function () {
    const observations = [{taxon: {id: 1, name: 'A'}}, {taxon: {id: 1, name: 'A'}}, {taxon: {id: 2, name: 'B'}}];
    assert.equal(getMostFrequentTaxon(observations).id, 1);
    assert.isNull(getMostFrequentTaxon([]));
});

test('the time description keeps the intervals above the threshold', function () {
    const observations = [
        {time_observed_at: '2026-10-01T09:00:00'},
        {time_observed_at: '2026-10-01T09:30:00'},
        {time_observed_at: '2026-10-01T10:00:00'},
        {time_observed_at: '2026-10-01T10:30:00'},
        {time_observed_at: '2026-10-01T14:00:00'},
    ];
    const description = buildTimeDescription(observations);
    assert.match(description, /Morning|Утро/u);
    assert.match(description, /4/u);
    assert.notMatch(description, /Afternoon|День/u);
    assert.match(buildTimeDescription([{}]), /в течение всего дня|all day/iu);
});

test('the observation location is parsed', function () {
    assert.deepEqual(parseLocation('49.75,33.45'), {lat: 49.75, lon: 33.45});
    assert.isNull(parseLocation('broken'));
});

test('the username is stored in the browser', function () {
    setInatUsername(' tester ');
    assert.equal(getInatUsername(), 'tester');
    setInatUsername('');
    assert.equal(getInatUsername(), '');
});

test('the inaturalist source returns the observations of the most observed taxon', async function () {
    setInatUsername('tester');
    const runner = require('~/lib/poi-discovery/sources/runner');
    const originalFetch = runner.__get__('fetch');
    const observations = [
        {
            id: 1,
            taxon: {id: 10, preferred_common_name: 'Fox', name: 'Vulpes'},
            location: '49.75,33.45',
            observed_on: '2026-10-01',
            time_observed_at: '2026-10-01T09:00:00',
        },
        {
            id: 2,
            taxon: {id: 10, preferred_common_name: 'Fox', name: 'Vulpes'},
            location: '49.76,33.46',
            observed_on: '2026-10-02',
            time_observed_at: '2026-10-02T09:00:00',
        },
        {
            id: 3,
            taxon: {id: 20, preferred_common_name: 'Rare bird', name: 'Avis'},
            location: '49.77,33.47',
            observed_on: '2026-10-03',
            time_observed_at: '2026-10-03T09:00:00',
        },
    ];
    runner.__set__('fetch', (url) => {
        const responseJSON = url.includes('users/autocomplete') ? {results: [{id: 42}]} : {results: observations};
        const promise = Promise.resolve({responseJSON});
        promise.abort = () => {
            // emulate the abort of xhr-promise
        };
        return promise;
    });
    try {
        const handle = inaturalistSource.search({mode: 'area', bbox: [49.7, 33.4, 49.8, 33.5]}, {});
        const result = await handle.promise;
        assert.deepEqual(
            result.pois.map((poi) => poi.id),
            [1, 2]
        );
        assert.equal(result.pois[0].tags.name, 'Fox');
        assert.equal(result.pois[0].sourceId, 'inaturalist');
        assert.equal(result.pois[0].categoryId, 'inat_species');
        assert.include(result.pois[0].link.url, 'observations/1');
        assert.match(result.pois[0].description, /Наблюдение|Observed/u);
    } finally {
        runner.__set__('fetch', originalFetch);
        setInatUsername('');
    }
});

test('the inaturalist source rejects without a username', async function () {
    setInatUsername('');
    const runner = require('~/lib/poi-discovery/sources/runner');
    const originalFetch = runner.__get__('fetch');
    runner.__set__('fetch', () => {
        const promise = Promise.resolve({responseJSON: {results: []}});
        promise.abort = () => {
            // emulate the abort of xhr-promise
        };
        return promise;
    });
    try {
        const handle = inaturalistSource.search({mode: 'area', bbox: [49.7, 33.4, 49.8, 33.5]}, {});
        let rejected = false;
        await handle.promise.catch(() => {
            rejected = true;
        });
        assert.isTrue(rejected);
    } finally {
        runner.__set__('fetch', originalFetch);
    }
});

test('the inaturalist source does not duplicate observations of overlapping circles', async function () {
    setInatUsername('tester');
    const runner = require('~/lib/poi-discovery/sources/runner');
    const originalFetch = runner.__get__('fetch');
    const observation = {
        id: 1,
        taxon: {id: 10, preferred_common_name: 'Fox', name: 'Vulpes'},
        location: '49.75,33.4',
        observed_on: '2026-10-01',
        time_observed_at: '2026-10-01T09:00:00',
    };
    const urls = [];
    runner.__set__('fetch', (url) => {
        urls.push(url);
        const responseJSON = url.includes('users/autocomplete') ? {results: [{id: 42}]} : {results: [observation]};
        const promise = Promise.resolve({responseJSON});
        promise.abort = () => {
            // emulate the abort of xhr-promise
        };
        return promise;
    });
    try {
        // a long corridor is split into several circles that overlap
        const handle = inaturalistSource.search(
            {
                mode: 'corridor',
                segments: [
                    {
                        points: [
                            {lat: 49.7, lng: 33.4},
                            {lat: 49.9, lng: 33.4},
                        ],
                        offsetMeters: 0,
                    },
                ],
                widthMeters: 200,
            },
            {}
        );
        const result = await handle.promise;
        assert.lengthOf(result.pois, 1, 'the observation is returned once');
        const observationUrls = urls.filter((url) => url.includes('observations?'));
        assert.isAbove(observationUrls.length, 1, 'the corridor is searched in several circles');
        assert.include(observationUrls[0], 'order_by=id');
    } finally {
        runner.__set__('fetch', originalFetch);
        setInatUsername('');
    }
});

test('an observation without a taxon does not break the source', async function () {
    setInatUsername('tester');
    const runner = require('~/lib/poi-discovery/sources/runner');
    const originalFetch = runner.__get__('fetch');
    const observations = [
        {
            id: 1,
            taxon: null,
            location: '49.75,33.45',
            observed_on: '2026-10-01',
            time_observed_at: '2026-10-01T09:00:00',
        },
        {
            id: 2,
            taxon: {id: 10, preferred_common_name: 'Fox', name: 'Vulpes'},
            location: '49.76,33.46',
            observed_on: '2026-10-02',
            time_observed_at: '2026-10-02T09:00:00',
        },
    ];
    runner.__set__('fetch', (url) => {
        const responseJSON = url.includes('users/autocomplete') ? {results: [{id: 42}]} : {results: observations};
        const promise = Promise.resolve({responseJSON});
        promise.abort = () => {
            // emulate the abort of xhr-promise
        };
        return promise;
    });
    try {
        const handle = inaturalistSource.search({mode: 'area', bbox: [49.7, 33.4, 49.8, 33.5]}, {});
        const result = await handle.promise;
        assert.deepEqual(
            result.pois.map((poi) => poi.id),
            [2]
        );
    } finally {
        runner.__set__('fetch', originalFetch);
        setInatUsername('');
    }
});

test('abort settles the promise of a source', async function () {
    const runner = require('~/lib/poi-discovery/sources/runner');
    const handle = runner.startSourceSearch(
        () =>
            new Promise(() => {
                // the source never answers
            })
    );
    handle.abort();
    let rejected = false;
    await handle.promise.catch(() => {
        rejected = true;
    });
    assert.isTrue(rejected);
});

suite('POI discovery formatting');

test('distances are formatted in meters and kilometers', function () {
    assert.match(formatDistance(45), /45 (м|m)/u);
    assert.match(formatDistance(1500), /1\.5 (км|km)/u);
    assert.match(formatDistance(999.6), /1\.0 (км|km)/u);
    assert.match(formatKilometers(12300), /12\.3 (км|km)/u);
});
