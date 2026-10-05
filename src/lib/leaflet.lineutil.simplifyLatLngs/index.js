import L from 'leaflet';
import {toLatLngWithMeta} from '~/lib/leaflet.latlng-meta';

L.LineUtil.simplifyLatlngs = function simplifyLatlngs(points, tolerance) {
    function latlngToXy(p) {
        return {
            x: p.lng,
            y: p.lat,
            src: p
        };
    }

    function xyToLatlng(p) {
        // L.LineUtil.simplify returns a subset of the input objects, so p.src points to the original point
        return toLatLngWithMeta(p.src || {lat: p.y, lng: p.x});
    }

    points = points.map(latlngToXy);
    points = L.LineUtil.simplify(points, tolerance);
    points = points.map(xyToLatlng);
    return points;
};
