/*
 Resolves icon references from categories.js ('carto:<path>' or 'maki:<name>') into bundled image
 urls. Icons are taken from openstreetmap-carto/symbols and mapbox/maki (both CC0, see images/LICENSE.md).
 Unknown icons fall back to the generic marker icon.
 */
const cartoContext = require.context('./images/carto', true, /\.svg$/u);
const makiContext = require.context('./images/maki', true, /\.svg$/u);

const cartoKeys = new Set(cartoContext.keys());
const makiKeys = new Set(makiContext.keys());

function unwrap(moduleExports) {
    return typeof moduleExports === 'string' ? moduleExports : moduleExports.default;
}

const fallbackUrl = unwrap(makiContext('./marker.svg'));

function getIconUrl(iconKey) {
    if (typeof iconKey === 'string' && iconKey.includes(':')) {
        const separatorIndex = iconKey.indexOf(':');
        const source = iconKey.slice(0, separatorIndex);
        const path = iconKey.slice(separatorIndex + 1);
        if (source === 'carto' && cartoKeys.has(`./${path}`)) {
            return unwrap(cartoContext(`./${path}`));
        }
        if (source === 'maki' && makiKeys.has(`./${path}.svg`)) {
            return unwrap(makiContext(`./${path}.svg`));
        }
    }
    return fallbackUrl;
}

export {getIconUrl};
