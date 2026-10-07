import escapeHtml from 'escape-html';

import {t} from '~/lib/lang';

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

function buildPoiPopupHtml(poi, category) {
    const url = getPoiOsmUrl(poi);
    const link = url
        ? `<a class="poi-popup-osm-link" href="${escapeHtml(url)}"
            target="_blank" rel="noopener noreferrer">
            ${t('Открыть в OpenStreetMap', 'Open in OpenStreetMap')}
        </a>`
        : '';
    return `<div class="poi-popup">
        <div class="poi-popup-title">${escapeHtml(getPoiTitle(poi, category))}</div>
        <div class="poi-popup-category">${escapeHtml(getCategoryTitle(category))}</div>
        <table class="poi-popup-tags">${buildTagsTable(poi.tags)}</table>
        ${link}
        <div class="poi-popup-attribution">&copy; OpenStreetMap contributors (ODbL)</div>
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

export {getPoiName, getPoiOsmUrl, buildPoiPopupHtml, buildClusterPopupHtml};
