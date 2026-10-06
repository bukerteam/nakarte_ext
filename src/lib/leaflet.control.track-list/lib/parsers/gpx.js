import {xmlGetNodeText} from './xmlUtils';
import stripBom from '~/lib/stripBom';
import {decodeText, getElementsByLocalName, parsePointElement} from './gpx_utils';

function parseGpx(txt, name, preferNameFromFile) {
    var error;

    function setError() {
        error = 'CORRUPT';
    }

    function getPointsFromElements(parent, tagName) {
        const elements = getElementsByLocalName(parent, tagName);
        const points = [];
        for (let i = 0; i < elements.length; i++) {
            const point = parsePointElement(elements[i], setError);
            if (!point) {
                break;
            }
            points.push(point);
        }
        return points;
    }

    function getTrackSegments(xml) {
        const segments = [];
        const segment_elements = getElementsByLocalName(xml, 'trkseg');
        for (let i = 0; i < segment_elements.length; i++) {
            const points = getPointsFromElements(segment_elements[i], 'trkpt');
            if (points.length) {
                segments.push(points);
            }
        }
        return segments;
    }

    function getRoutes(xml) {
        const routes = [];
        const route_elements = getElementsByLocalName(xml, 'rte');
        for (let i = 0; i < route_elements.length; i++) {
            const points = getPointsFromElements(route_elements[i], 'rtept');
            if (points.length) {
                routes.push(points);
            }
        }
        return routes;
    }

    function getWaypoints(xml) {
        const waypoint_elements = getElementsByLocalName(xml, 'wpt');
        const waypoints = [];
        for (let i = 0; i < waypoint_elements.length; i++) {
            const waypoint_element = waypoint_elements[i];
            // The waypoint name is kept in the legacy top-level field, not in meta
            const parsed_point = parsePointElement(waypoint_element, setError, false);
            if (!parsed_point) {
                continue;
            }
            const waypoint = {lat: parsed_point.lat, lng: parsed_point.lng};
            if (parsed_point.alt !== undefined) {
                waypoint.alt = parsed_point.alt;
            }
            waypoint.name = decodeText(xmlGetNodeText(getElementsByLocalName(waypoint_element, 'name')[0]) || '');
            waypoint.symbol_name = decodeText(xmlGetNodeText(getElementsByLocalName(waypoint_element, 'sym')[0]));
            if (parsed_point.meta) {
                waypoint.meta = parsed_point.meta;
            }
            waypoints.push(waypoint);
        }
        return waypoints;
    }

    function parseXmlDocument(text) {
        let dom;
        try {
            dom = (new DOMParser()).parseFromString(text, 'text/xml');
        } catch (e) {
            return null;
        }
        if (!dom) {
            return null;
        }
        // Browsers may put the parse error either into the document element (syntax errors)
        // or into a nested <parsererror> element (e.g. namespace errors)
        if (dom.documentElement.nodeName === 'parsererror' || dom.getElementsByTagName('parsererror').length) {
            return null;
        }
        return dom;
    }

    txt = stripBom(txt);
    let dom = parseXmlDocument(txt);
    if (dom === null) {
        // Fallback for files with undeclared or non-standard namespace prefixes:
        // replace prefixes with underscores (legacy behaviour). Namespaces are lost in this case.
        const txtWithoutNamespaces = txt.replace(/<([^ >]+):([^ >]+)/ug, '<$1_$2');
        if (txtWithoutNamespaces !== txt) {
            dom = parseXmlDocument(txtWithoutNamespaces);
        }
    }
    if (dom === null) {
        return null;
    }
    if (getElementsByLocalName(dom, 'gpx').length === 0) {
        return null;
    }
    if (preferNameFromFile) {
        for (const trk of [...getElementsByLocalName(dom, 'trk')]) {
            const trkNameElement = getElementsByLocalName(trk, 'name')[0];
            if (trkNameElement) {
                const trkName = decodeText(xmlGetNodeText(trkNameElement));
                if (trkName.length) {
                    name = trkName;
                    break;
                }
            }
        }
    }
    return [{
        name: name,
        tracks: getTrackSegments(dom).concat(getRoutes(dom)),
        points: getWaypoints(dom),
        error: error
    }];
}

export default parseGpx;
