import secrets from './secrets.json';

// The NextGIS Overpass instance is used first when its API key is configured (see secrets.json.template).
const overpassNextgisUrl = secrets.overpassNextgis
    ? `https://overpass.nextgis.com/${secrets.overpassNextgis}/api/interpreter`
    : null;

const config = {
    caption: `
        <a href="https://docs.nakarte.me">Documentation</a> |
        <a href="https://about.nakarte.me">News</a> |
        <a href="mailto:nakarte@nakarte.me" target="_self">nakarte@nakarte.me</a> |
        <a href="https://about.nakarte.me/p/blog-page_29.html">Donate</a>`,
    defaultLocation: [49.73868, 33.45886],
    defaultZoom: 8,
    googleApiUrl: `https://maps.googleapis.com/maps/api/js?v=3&key=${secrets.google}`,
    westraDataBaseUrl: 'https://nakarte.me/westraPasses/',
    CORSProxyUrl: 'https://proxy.nakarte.me/',
    elevationsServer: 'https://elevation.nakarte.me/',
    wikimediaCommonsCoverageUrl: 'https://tiles.nakarte.me/wikimedia_commons_images/{z}/{x}/{y}',
    geocachingSuUrl: 'https://nakarte.me/geocachingSu/geocaching_su2.json',
    // overpass-api.de is overloaded (see its usage policy); the VK Maps instance answers faster
    // from Russia, so it is used by default. Any public or self-hosted Overpass endpoint can be
    // configured here and in overpassApiFallbackUrls. The NextGIS instance is used first when an
    // API key is configured (see secrets.json.template).
    overpassApiUrl: overpassNextgisUrl ?? 'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    overpassApiFallbackUrls: overpassNextgisUrl
        ? ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter']
        : ['https://overpass-api.de/api/interpreter'],
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
