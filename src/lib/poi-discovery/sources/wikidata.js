/*
 Wikidata source: tourist attractions (Q570116 and its subclasses) around a point, filtered by the
 real search area afterwards. The query is a port of the reference implementation.
 */

import {t} from '~/lib/lang';

import {buildAreaCircles, buildCorridorCircles, isInsideBbox} from './circles';
import {clearRequest, requestJson, startSourceSearch} from './runner';
import {buildSegmentsIndex, projectOnSegments} from '../corridor';

const endpoint = 'https://query.wikidata.org/sparql';
const maxRadiusMeters = 25000;
const maxResultsPerCircle = 500;
const maxResults = 1000;
const categoryId = 'wikidata_place';

function buildQuery(circle) {
    const radiusKm = Math.max(0.1, circle.radiusMeters / 1000);
    return `SELECT ?item ?itemLabel ?location ?instanceOfLabel WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?location.
    bd:serviceParam wikibase:center "Point(${circle.lng.toFixed(5)} ${circle.lat.toFixed(5)})"^^geo:wktLiteral.
    bd:serviceParam wikibase:radius "${radiusKm.toFixed(1)}".
  }
  ?item wdt:P31/wdt:P279* wd:Q570116.
  OPTIONAL { ?item wdt:P31 ?instanceOf. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ru,en". }
}
LIMIT ${maxResultsPerCircle}`;
}

function parsePoint(value) {
    const match = /^Point\(([-\d.]+)\s+([-\d.]+)\)$/u.exec(value ?? '');
    if (!match) {
        return null;
    }
    return {lon: Number(match[1]), lat: Number(match[2])};
}

/*
 Parses the SPARQL response into POIs: {type, id, lat, lon, tags, url, description, categoryId}.
 */
function parseResponse(data) {
    const result = [];
    for (const binding of data?.results?.bindings ?? []) {
        const point = parsePoint(binding.location?.value);
        const item = binding.item?.value ?? '';
        const id = item.split('/').pop();
        if (!point || !id) {
            continue;
        }
        const title = binding.itemLabel?.value ?? '';
        const instanceOf = binding.instanceOfLabel?.value ?? '';
        result.push({
            type: 'wikidata',
            id,
            lat: point.lat,
            lon: point.lon,
            tags: title ? {name: title} : {},
            description: instanceOf ? t(`Тип объекта: ${instanceOf}`, `Instance of: ${instanceOf}`) : '',
            link: {url: item, text: t('Открыть в Wikidata', 'Open in Wikidata')},
            categoryId,
        });
    }
    return result;
}

function filterPoi(poi, params, projectionIndex) {
    if (params.mode === 'corridor') {
        const projection = projectOnSegments({lat: poi.lat, lng: poi.lon}, projectionIndex);
        if (projection.distance > params.widthMeters) {
            return null;
        }
        return {...poi, distance: projection.distance, alongMeters: projection.along};
    }
    return isInsideBbox(poi, params.bbox) ? poi : null;
}

const wikidataSource = {
    id: 'wikidata',
    titleRu: 'Wikidata',
    titleEn: 'Wikidata',
    attribution: '© Wikidata contributors (CC0)',
    color: '#9C27B0',
    isConfigured: () => true,
    search: (params, context) => {
        const {onProgress} = context;
        const {circles, truncated: areaTruncated} =
            params.mode === 'corridor'
                ? buildCorridorCircles(params.segments, params.widthMeters)
                : buildAreaCircles(params.bbox, maxRadiusMeters);
        const projectionIndex =
            params.mode === 'corridor' ? buildSegmentsIndex(params.segments, params.widthMeters) : null;
        return startSourceSearch(async (state) => {
            const pois = [];
            const seen = new Set();
            let partial = false;
            let limitTruncated = false;
            for (let i = 0; i < circles.length; i++) {
                if (state.aborted) {
                    throw new Error('search aborted');
                }
                if (onProgress) {
                    onProgress({done: i, total: circles.length});
                }
                let data;
                try {
                    const query = buildQuery(circles[i]);
                    data = await requestJson(state, `${endpoint}?format=json&query=${encodeURIComponent(query)}`, {
                        headers: [['Accept', 'application/json']],
                    });
                } catch (e) {
                    if (state.aborted || !pois.length) {
                        throw e;
                    }
                    partial = true;
                    break;
                }
                if ((data?.results?.bindings ?? []).length >= maxResultsPerCircle) {
                    // the query hit its own limit: there may be more objects in this circle
                    limitTruncated = true;
                }
                for (const poi of parseResponse(data)) {
                    if (seen.has(poi.id)) {
                        continue;
                    }
                    seen.add(poi.id);
                    const filtered = filterPoi(poi, params, projectionIndex);
                    if (filtered) {
                        pois.push({...filtered, sourceId: wikidataSource.id});
                    }
                }
                if (onProgress) {
                    onProgress({done: i + 1, total: circles.length, found: pois.length});
                }
            }
            clearRequest(state);
            pois.sort((a, b) => (a.alongMeters ?? 0) - (b.alongMeters ?? 0));
            return {
                pois: pois.slice(0, maxResults),
                truncated: areaTruncated || limitTruncated || pois.length > maxResults,
                partial,
            };
        });
    },
};

export {parseResponse as parseWikidataResponse, wikidataSource};
