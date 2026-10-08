/*
 Overpass API endpoints used by the POI layer. With a configured NextGIS key the NextGIS instance
 comes first; the VK Maps mirror (the official overpass-api.de is overloaded) and overpass-api.de
 are used as fallbacks.
 */
const vkMapsEndpoint = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';
const overpassDeEndpoint = 'https://overpass-api.de/api/interpreter';

function nextgisEndpoint(key) {
    return `https://overpass.nextgis.com/${key}/api/interpreter`;
}

function buildOverpassUrls(key) {
    const fallbacks = [vkMapsEndpoint, overpassDeEndpoint];
    return key ? [nextgisEndpoint(key), ...fallbacks] : fallbacks;
}

export {buildOverpassUrls};
