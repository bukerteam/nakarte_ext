/*
 POI search over the Overpass API for the discovery panel: the area mode queries a bounding box,
 the corridor mode queries the neighborhoods of a track and filters the candidates by the
 distance to the track geometry.

 Large areas and long tracks are split into several queries with a bounded response size; the
 queries are sent one by one to keep the load on the Overpass instance gentle. Every search
 returns {promise, abort}.
 */

import {matchCategory} from '~/lib/leaflet.layer.poi/categories';
import {buildOverpassQuery, parseOverpassResponse} from '~/lib/overpass';

import {buildSegmentsIndex, chunkSegments, expandBbox, getBbox, projectOnSegments} from './corridor';

const defaultMaxPoints = 2000;
const defaultMaxTileArea = 0.25;
const defaultMaxTiles = 16;
const defaultChunkLength = 20000;
const defaultMaxChunks = 25;
const defaultMaxResults = 3000;

function buildFilters(categories) {
    const filters = [];
    for (const category of categories) {
        filters.push(...category.filters);
    }
    return filters;
}

function getPoiKey(poi) {
    return `${poi.type}/${poi.id}`;
}

/*
 Splits a bbox into tiles of at most maxArea square degrees, so that a large area is searched with
 several requests of a bounded size. The number of tiles is capped by maxTiles: for a huge area
 the tiles stay bigger than maxArea and the caller reports the possible incompleteness.
 */
function splitBboxIntoTiles(bbox, maxArea = defaultMaxTileArea, maxTiles = defaultMaxTiles) {
    const [south, west, north, east] = bbox;
    const latSpan = Math.max(0, north - south);
    const lngSpan = Math.max(0, east - west);
    const area = latSpan * lngSpan;
    let splits = 1;
    if (area > maxArea && latSpan > 0 && lngSpan > 0) {
        splits = Math.min(Math.max(1, Math.floor(Math.sqrt(maxTiles))), Math.ceil(Math.sqrt(area / maxArea)));
    }
    const latStep = latSpan / splits;
    const lngStep = lngSpan / splits;
    const tiles = [];
    for (let row = 0; row < splits; row++) {
        for (let column = 0; column < splits; column++) {
            tiles.push([
                south + row * latStep,
                west + column * lngStep,
                row === splits - 1 ? north : south + (row + 1) * latStep,
                column === splits - 1 ? east : west + (column + 1) * lngStep,
            ]);
        }
    }
    return tiles;
}

/*
 Matches the raw Overpass elements against the selected categories and keeps only the elements
 that belong to one of them.
 */
function matchElements(elements, categories) {
    const result = [];
    for (const element of elements) {
        const category = matchCategory(element.tags, categories);
        if (category) {
            result.push({...element, categoryId: category.id});
        }
    }
    return result;
}

/*
 Runs the queries one by one and collects the elements. A failing query does not discard the
 results of the successful ones: the search stops and reports `failed` instead, so the panel can
 show what was found and warn that the rest of the area is not loaded. The very first failing
 query rejects the search, there is nothing to show.
 */
async function runQueries(queries, client, {maxPoints, onProgress, onBatch, state}) {
    const elements = [];
    let truncated = false;
    let failed = false;
    for (let i = 0; i < queries.length; i++) {
        if (state.aborted) {
            throw new Error('search aborted');
        }
        if (onProgress) {
            onProgress({done: i, total: queries.length});
        }
        const request = client.query(queries[i]);
        state.request = request;
        let data;
        try {
            data = await request.promise;
        } catch (e) {
            if (state.aborted || !elements.length) {
                throw e;
            }
            failed = true;
            break;
        }
        if (data.elements.length >= maxPoints) {
            truncated = true;
        }
        const batch = parseOverpassResponse(data);
        elements.push(...batch);
        if (onBatch) {
            onBatch(batch, {done: i + 1, total: queries.length});
        }
    }
    state.request = null;
    if (onProgress) {
        onProgress({done: queries.length, total: queries.length});
    }
    return {elements, truncated, failed};
}

function startSearch(run) {
    const state = {aborted: false, request: null};
    const promise = run(state).then((result) => {
        if (state.aborted) {
            throw new Error('search aborted');
        }
        return result;
    });
    return {
        promise,
        abort: () => {
            state.aborted = true;
            if (state.request) {
                state.request.abort();
            }
        },
    };
}

/*
 Searches the categories in a bbox given as [south, west, north, east]. Resolves with
 {pois, truncated, partial}: truncated is true when a response hit the points limit or the
 results were capped by maxResults, partial is true when a part of the area failed to load.
 */
function searchArea({
    bbox,
    categories,
    client,
    maxPoints = defaultMaxPoints,
    maxTileArea = defaultMaxTileArea,
    maxTiles = defaultMaxTiles,
    maxResults = defaultMaxResults,
    onProgress,
}) {
    const filters = buildFilters(categories);
    const queries = splitBboxIntoTiles(bbox, maxTileArea, maxTiles).map((tile) =>
        buildOverpassQuery(filters, tile, {maxPoints})
    );
    return startSearch(async (state) => {
        const pois = [];
        const seen = new Set();
        function onBatch(batch, progress) {
            for (const poi of matchElements(batch, categories)) {
                const key = getPoiKey(poi);
                if (!seen.has(key)) {
                    seen.add(key);
                    pois.push(poi);
                }
            }
            if (onProgress) {
                onProgress({...progress, found: pois.length});
            }
        }
        const {truncated, failed} = await runQueries(queries, client, {maxPoints, onProgress, onBatch, state});
        return {
            pois: pois.slice(0, maxResults),
            truncated: truncated || pois.length > maxResults,
            partial: failed,
        };
    });
}

/*
 Searches the categories around the track parts given as [{points, offsetMeters}]. The parts are
 split into chunks, every chunk is queried through its bbox expanded by the corridor width, then
 the candidates are filtered by the distance to the track geometry. Every POI gets `distance`
 (meters to the track) and `alongMeters` (position along the whole track), the results are sorted
 by the position. Resolves with {pois, truncated, partial}.
 */
function searchCorridor({
    segments,
    widthMeters,
    categories,
    client,
    maxPoints = defaultMaxPoints,
    chunkLength = defaultChunkLength,
    maxChunks = defaultMaxChunks,
    maxResults = defaultMaxResults,
    onProgress,
}) {
    const filters = buildFilters(categories);
    const {chunks, truncated: lengthTruncated} = chunkSegments(segments, chunkLength, maxChunks);
    const queries = chunks.map((chunk) =>
        buildOverpassQuery(filters, expandBbox(getBbox(chunk.points), widthMeters), {maxPoints})
    );
    const projectionIndex = buildSegmentsIndex(segments, widthMeters);
    return startSearch(async (state) => {
        const pois = [];
        const seen = new Set();
        function onBatch(batch, progress) {
            for (const poi of matchElements(batch, categories)) {
                const key = getPoiKey(poi);
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                // POIs from Overpass keep the longitude in `lon`, the corridor math uses `lng`
                const projection = projectOnSegments({lat: poi.lat, lng: poi.lon}, projectionIndex);
                if (projection.distance <= widthMeters) {
                    pois.push({...poi, distance: projection.distance, alongMeters: projection.along});
                }
            }
            if (onProgress) {
                onProgress({...progress, found: pois.length});
            }
        }
        const {truncated, failed} = await runQueries(queries, client, {maxPoints, onProgress, onBatch, state});
        pois.sort((a, b) => a.alongMeters - b.alongMeters);
        return {
            pois: pois.slice(0, maxResults),
            truncated: truncated || lengthTruncated || pois.length > maxResults,
            partial: failed,
        };
    });
}

export {searchArea, searchCorridor, splitBboxIntoTiles};
