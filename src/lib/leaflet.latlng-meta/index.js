import L from 'leaflet';

/*
 * Point metadata (name, desc, cmt, link, sym, type, time, ele, extensions, ...) is kept
 * in the `meta` property of points and markers.
 *
 * Track points are L.LatLng objects, and Leaflet creates new LatLng instances on clone/wrap,
 * dropping custom properties. LatLngWithMeta preserves `meta` on clone() and wrap(),
 * so metadata survives all track transformations without special handling at call sites.
 */

function cloneMetaValue(value) {
    if (Array.isArray(value)) {
        return value.map(cloneMetaValue);
    }
    if (value && typeof value === 'object') {
        const clone = {};
        for (const [key, entryValue] of Object.entries(value)) {
            clone[key] = cloneMetaValue(entryValue);
        }
        return clone;
    }
    return value;
}

function clonePointMeta(meta) {
    return meta ? cloneMetaValue(meta) : null;
}

function copyLatLngData(source, target) {
    if (source.alt !== undefined && source.alt !== null) {
        target.alt = source.alt;
    }
    if (source.meta) {
        target.meta = clonePointMeta(source.meta);
    }
    return target;
}

class LatLngWithMeta extends L.LatLng {
    clone() {
        return copyLatLngData(this, new LatLngWithMeta(this.lat, this.lng));
    }

    wrap() {
        const wrapped = L.CRS.Earth.wrapLatLng(this);
        return copyLatLngData(this, new LatLngWithMeta(wrapped.lat, wrapped.lng));
    }
}

function createLatLngWithMeta(lat, lng, alt, meta) {
    return copyLatLngData({alt: alt, meta: meta}, new LatLngWithMeta(lat, lng));
}

// Converts a plain point ({lat, lng, alt, meta}), an array or an L.LatLng to a LatLngWithMeta
function toLatLngWithMeta(point) {
    if (point === null || point === undefined || point instanceof LatLngWithMeta) {
        return point;
    }
    if (point instanceof L.LatLng) {
        return point.meta ? createLatLngWithMeta(point.lat, point.lng, point.alt, point.meta) : point;
    }
    if (Array.isArray(point)) {
        return createLatLngWithMeta(point[0], point[1], point[2]);
    }
    return createLatLngWithMeta(point.lat, point.lng, point.alt, point.meta);
}

export {clonePointMeta, createLatLngWithMeta, toLatLngWithMeta};
