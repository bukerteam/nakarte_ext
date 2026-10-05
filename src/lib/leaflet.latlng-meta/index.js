import L from 'leaflet';

/*
 * Helpers for keeping point metadata (name, desc, cmt, link, sym, type, time, ele, extensions, ...)
 * attached to L.LatLng objects while they are moved around, cloned and wrapped.
 *
 * Leaflet creates new LatLng objects in many operations and drops all custom properties,
 * so places that clone or wrap points must use helpers from this module.
 */

function clonePointMeta(meta) {
    if (!meta) {
        return null;
    }
    const clone = {...meta};
    if (meta.attributes) {
        clone.attributes = {...meta.attributes};
    }
    if (meta.link) {
        clone.link = {...meta.link};
    }
    if (meta.extensions) {
        clone.extensions = meta.extensions.slice();
    }
    return clone;
}

function createLatLngWithMeta(lat, lng, alt, meta) {
    const latlng = L.latLng(lat, lng);
    if (alt !== undefined && alt !== null) {
        latlng.alt = alt;
    }
    if (meta) {
        latlng.meta = clonePointMeta(meta);
    }
    return latlng;
}

function copyLatLngMeta(source, target) {
    if (source && source.meta) {
        target.meta = clonePointMeta(source.meta);
    }
    return target;
}

function toLatLngWithMeta(point) {
    if (point instanceof L.LatLng || point === null || point === undefined) {
        return point;
    }
    if (Array.isArray(point)) {
        return L.latLng(point[0], point[1], point[2]);
    }
    return createLatLngWithMeta(point.lat, point.lng, point.alt, point.meta);
}

function cloneLatLngWithMeta(point, overrides = {}) {
    if (!point) {
        return point;
    }
    if (Array.isArray(point)) {
        return L.latLng(point[0], point[1], point[2]);
    }
    const lat = overrides.lat ?? point.lat;
    const lng = overrides.lng ?? point.lng;
    const alt = overrides.alt ?? point.alt;
    return createLatLngWithMeta(lat, lng, alt, point.meta);
}

function wrapLatLngWithMeta(point) {
    return copyLatLngMeta(point, point.wrap());
}

export {clonePointMeta, copyLatLngMeta, toLatLngWithMeta, cloneLatLngWithMeta, wrapLatLngWithMeta};
