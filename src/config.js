import secrets from './secrets.json';
import {buildOverpassUrls} from './lib/overpass/endpoints';

// The build-time NextGIS key (see secrets.json.template) is only a fallback: the key can also be
// entered by the user in the POI panel or supplied at runtime via config.json.
const overpassUrls = buildOverpassUrls(secrets.overpassNextgis);

const config = {
    caption: `
        <a href="https://docs.nakarte.me">Documentation</a> |
        <a href="https://about.nakarte.me">News</a> |
        <a href="mailto:nakarte@nakarte.me" target="_self">nakarte@nakarte.me</a> |
        <a href="https://about.nakarte.me/p/blog-page_29.html">Donate</a>`,
    defaultLocation: [61.74291, 30.86746],
    defaultZoom: 10,
    panoramasEnabledByDefault: true,
    googleApiUrl: `https://maps.googleapis.com/maps/api/js?v=3&key=${secrets.google}`,
    westraDataBaseUrl: 'https://nakarte.me/westraPasses/',
    CORSProxyUrl: 'https://proxy.nakarte.me/',
    elevationsServer: 'https://elevation.nakarte.me/',
    wikimediaCommonsCoverageUrl: 'https://tiles.nakarte.me/wikimedia_commons_images/{z}/{x}/{y}',
    geocachingSuUrl: 'https://nakarte.me/geocachingSu/geocaching_su2.json',
    // overpass-api.de is overloaded (see its usage policy); the VK Maps instance answers faster
    // from Russia, so it is used by default. Any public or self-hosted Overpass endpoint can be
    // configured here and in overpassApiFallbackUrls. The NextGIS instance is used first when a
    // key is available (see docs/deploy/README.md).
    overpassApiUrl: overpassUrls[0],
    overpassApiFallbackUrls: overpassUrls.slice(1),
    tracksStorageServer: 'https://tracks.nakarte.me',
    wikimapiaTilesBaseUrl: 'https://proxy.nakarte.me/wikimapia/',
    mapillaryRasterTilesUrl: 'https://mapillary.nakarte.me/{z}/{x}/{y}',
    urlsBypassCORSProxy: [new RegExp('^https://pkk\\.rosreestr\\.ru/', 'u')],
    elevationTileUrl: 'https://tiles.nakarte.me/elevation/{z}/{x}/{y}',
    // Public routing instances are for development only, production requires a self-hosted instance.
    routing: {
        provider: 'valhalla',
        url: 'https://valhalla1.openstreetmap.de/route',
        apiKey: secrets.routingApiKey,
    },
    ...secrets,
};

export default config;
