/*
 POI sources of the discovery panel. A source is
 {id, titleRu, titleEn, attribution, color, isConfigured(), search(params, context)};
 search() returns {promise, abort} and every found POI gets a sourceId.

 The OSM/Overpass source is the base one, Wikidata and iNaturalist need no keys (iNaturalist needs
 a username). Google Places and TripAdvisor are not ported: they need keys with billing or
 approval and do not allow requests from a web client.
 */

import {inaturalistSource} from './inaturalist';
import {osmSource} from './osm';
import {wikidataSource} from './wikidata';

const poiSources = [osmSource, wikidataSource, inaturalistSource];

function getSource(id) {
    return poiSources.find((source) => source.id === id) ?? null;
}

export {getSource, poiSources};
