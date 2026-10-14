import escapeHtml from 'escape-html';
import L from 'leaflet';

import {t} from '~/lib/lang';

import {getIconUrl} from './icons';

function getCategoryTitle(category) {
    return t(category.titleRu, category.titleEn);
}

function getPoiName(tags) {
    return tags['name:ru'] || tags.name || tags['name:en'] || null;
}

function getPoiTitle(poi, category) {
    return getPoiName(poi.tags) || getCategoryTitle(category);
}

const osmElementTypes = new Set(['node', 'way', 'relation']);

function getPoiOsmUrl(poi) {
    const id = Number(poi.id);
    if (!Number.isFinite(id) || !osmElementTypes.has(poi.type)) {
        return null;
    }
    return `https://www.openstreetmap.org/${poi.type}/${id}`;
}

/*
 A link to the object: the OSM page for the OSM points, the link provided by the source for the
 points of the other sources (Wikidata, iNaturalist).
 */
function getPoiLink(poi) {
    const url = getPoiOsmUrl(poi);
    if (url) {
        return {url, text: t('Открыть в OpenStreetMap', 'Open in OpenStreetMap')};
    }
    if (poi.link && poi.link.url) {
        return poi.link;
    }
    return null;
}

function buildTagsTable(tags, limit = 15) {
    const rows = [];
    for (const [key, value] of Object.entries(tags)) {
        if (key.startsWith('name')) {
            continue;
        }
        rows.push(`<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`);
        if (rows.length >= limit) {
            break;
        }
    }
    return rows.join('');
}

function buildPoiPopupHtml(poi, category, extraHtml = '', attribution = '') {
    const link = getPoiLink(poi);
    const linkHtml = link
        ? `<a class="poi-popup-osm-link" href="${escapeHtml(link.url)}"
            target="_blank" rel="noopener noreferrer">
            ${escapeHtml(link.text)}
        </a>`
        : '';
    return `<div class="poi-popup">
        <div class="poi-popup-title">${escapeHtml(getPoiTitle(poi, category))}</div>
        <div class="poi-popup-category">${escapeHtml(getCategoryTitle(category))}</div>
        ${extraHtml}
        <table class="poi-popup-tags">${buildTagsTable(poi.tags)}</table>
        ${linkHtml}
        <div class="poi-popup-attribution">${escapeHtml(attribution || '© OpenStreetMap contributors (ODbL)')}</div>
    </div>`;
}

function buildClusterPopupHtml(cluster, limit = 50) {
    const items = cluster.markers.slice(0, limit).map((marker) => {
        const {poi, category} = marker.properties;
        const title = escapeHtml(getPoiTitle(poi, category));
        const url = getPoiOsmUrl(poi);
        if (!url) {
            return `<li>${title}</li>`;
        }
        return `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${title}</a></li>`;
    });
    const more =
        cluster.markers.length > limit
            ? `<div class="poi-popup-more">${t(
                  `… и ещё ${cluster.markers.length - limit}`,
                  `… and ${cluster.markers.length - limit} more`
              )}</div>`
            : '';
    return `<div class="poi-popup poi-popup-cluster">
        <div class="poi-popup-title">${t(`Точек: ${cluster.markers.length}`, `${cluster.markers.length} points`)}</div>
        <ul>${items.join('')}</ul>
        ${more}
    </div>`;
}

/*
 Marker definition for both POI layers (highlight and discovery).
 */
function createPoiMarker(poi, category) {
    return {
        latlng: L.latLng(poi.lat, poi.lon),
        icon: {url: getIconUrl(category.icon)},
        tooltip: getPoiName(poi.tags) || t('Без названия', 'Unnamed'),
        properties: {poi, category},
    };
}

/*
 Opens the list of a cluster of coincident points or zooms the map to the cluster bounds.
 */
function handleClusterClick(map, marker, disableClusterAtZoom) {
    const {bounds} = marker._cluster;
    if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
        map.openPopup(buildClusterPopupHtml(marker._cluster), marker.latlng, {maxWidth: 400});
    } else {
        map.fitBounds(bounds, {maxZoom: Math.min(disableClusterAtZoom, map.getMaxZoom())});
    }
}

/*
 Scales the marker icons of a POI layer with the zoom, within the configured bounds.
 */
function updateIconScale(layer, zoom) {
    const {iconScaleRefZoom, iconScaleMin, iconScaleMax} = layer.options;
    const scale = Math.max(iconScaleMin, Math.min(iconScaleMax, 2 ** (zoom - iconScaleRefZoom)));
    if (layer.options.iconScale !== scale) {
        layer.options.iconScale = scale;
        layer.resetLabels();
    }
}

export {
    buildClusterPopupHtml,
    buildPoiPopupHtml,
    createPoiMarker,
    getCategoryTitle,
    getPoiLink,
    getPoiName,
    getPoiOsmUrl,
    handleClusterClick,
    updateIconScale,
};
