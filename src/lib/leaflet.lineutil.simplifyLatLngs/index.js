import L from 'leaflet';
import {cloneLatLngWithMeta} from '~/lib/leaflet.latlng-meta';

L.LineUtil.simplifyLatlngs = function simplifyLatlngs(points, tolerance) {
    function latlngToXy(p) {
        return {
            x: p.lng,
            y: p.lat,
            src: p
        };
    }

    function xyToLatlng(p) {
        if (p.src && (p.src.meta || p.src.alt !== undefined)) {
            return cloneLatLngWithMeta(p.src);
        }
        return {
            lat: p.y,
            lng: p.x
        };
    }

    points = points.map(latlngToXy);
    points = L.LineUtil.simplify(points, tolerance);
    points = points.map(xyToLatlng);
    return points;
};
