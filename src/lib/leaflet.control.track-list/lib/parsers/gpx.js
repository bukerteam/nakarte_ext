import {decode as utf8_decode} from 'utf8';
import {xmlGetNodeText} from './xmlUtils';
import stripBom from '~/lib/stripBom';

// Simple text elements of GPX wptType that are kept as is
const POINT_TEXT_ELEMENTS = ['name', 'cmt', 'desc', 'sym', 'type'];

function parseGpx(txt, name, preferNameFromFile) {
    var error;

    function getElementText(element) {
        const text = xmlGetNodeText(element);
        return text === null ? null : text.trim();
    }

    function decodeText(text) {
        if (text === null || text === undefined) {
            return text;
        }
        try {
            return utf8_decode(text);
        } catch (e) {
            return text;
        }
    }

    function getElementsByLocalName(root, localName) {
        return root.getElementsByTagNameNS('*', localName);
    }

    function getChildElements(element) {
        return Array.prototype.slice.call(element.childNodes)
            .filter((node) => node.nodeType === 1);
    }

    function removeInsignificantWhitespace(node) {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === 3) {
                if (child.nodeValue.trim() === '') {
                    node.removeChild(child);
                }
            } else if (child.nodeType === 1) {
                removeInsignificantWhitespace(child);
            }
        }
    }

    function serializeExtensionElement(element, serializer) {
        const clone = element.cloneNode(true);
        removeInsignificantWhitespace(clone);
        // The default GPX namespace is inherited by all elements of the document,
        // there is no need to write it to every extension element
        return serializer.serializeToString(clone)
            .replace(/\sxmlns="http:\/\/www\.topografix\.com\/GPX\/1\/[01]"/ug, '');
    }

    function parseLinkElement(element) {
        const link = {};
        const href = element.getAttribute('href');
        if (href !== null) {
            link.href = href;
        }
        const text = decodeText(getElementText(getElementsByLocalName(element, 'text')[0]));
        if (text) {
            link.text = text;
        }
        const type = decodeText(getElementText(getElementsByLocalName(element, 'type')[0]));
        if (type) {
            link.type = type;
        }
        return link;
    }

    function parsePointChildElement(child, point, meta, extensions, serializer) {
        const tag = child.localName;
        if (tag === 'ele') {
            const eleText = getElementText(child);
            if (eleText !== null && eleText !== '') {
                meta.ele = eleText;
                const eleValue = parseFloat(eleText);
                if (!isNaN(eleValue)) {
                    point.alt = eleValue;
                }
            }
        } else if (tag === 'time') {
            const timeText = decodeText(getElementText(child));
            if (timeText) {
                meta.time = timeText;
            }
        } else if (tag === 'link') {
            meta.link = parseLinkElement(child);
        } else if (tag === 'extensions') {
            for (const extensionElement of getChildElements(child)) {
                extensions.push(decodeText(serializeExtensionElement(extensionElement, serializer)));
            }
        } else if (POINT_TEXT_ELEMENTS.includes(tag)) {
            const text = decodeText(getElementText(child));
            if (text) {
                meta[tag] = text;
            }
        } else {
            // Unknown elements are kept as extensions to not lose data
            extensions.push(decodeText(serializeExtensionElement(child, serializer)));
        }
    }

    function parsePointAttributes(point_element) {
        if (!point_element.attributes || !point_element.attributes.length) {
            return null;
        }
        const attributes = {};
        for (const attribute of point_element.attributes) {
            if (attribute.name !== 'lat' && attribute.name !== 'lon') {
                attributes[attribute.name] = attribute.value;
            }
        }
        if (!Object.keys(attributes).length) {
            return null;
        }
        return attributes;
    }

    // Parses common properties of wpt, trkpt and rtept elements
    function parsePointElement(point_element, serializer) {
        var lat = parseFloat(point_element.getAttribute('lat'));
        var lng = parseFloat(point_element.getAttribute('lon'));
        if (isNaN(lat) || isNaN(lng)) {
            error = 'CORRUPT';
            return null;
        }
        const point = {lat: lat, lng: lng};
        const meta = {};
        const extensions = [];
        for (const child of getChildElements(point_element)) {
            parsePointChildElement(child, point, meta, extensions, serializer);
        }
        const attributes = parsePointAttributes(point_element);
        if (attributes) {
            meta.attributes = attributes;
        }
        if (extensions.length) {
            meta.extensions = extensions;
        }
        if (Object.keys(meta).length) {
            point.meta = meta;
        }
        return point;
    }

    function getSegmentPoints(segment_element, serializer) {
        var points_elements = getElementsByLocalName(segment_element, 'trkpt');
        var points = [];
        for (var i = 0; i < points_elements.length; i++) {
            var point_element = points_elements[i];
            var point = parsePointElement(point_element, serializer);
            if (!point) {
                break;
            }
            points.push(point);
        }
        return points;
    }

    function getTrackSegments(xml, serializer) {
        var segments = [];
        var segments_elements = getElementsByLocalName(xml, 'trkseg');
        for (var i = 0; i < segments_elements.length; i++) {
            var segment_points = getSegmentPoints(segments_elements[i], serializer);
            if (segment_points.length) {
                segments.push(segment_points);
            }
        }
        return segments;
    }

    function getRoutePoints(rte_element, serializer) {
        var points_elements = getElementsByLocalName(rte_element, 'rtept');
        var points = [];
        for (var i = 0; i < points_elements.length; i++) {
            var point_element = points_elements[i];
            var point = parsePointElement(point_element, serializer);
            if (!point) {
                break;
            }
            points.push(point);
        }
        return points;
    }

    function getRoutes(xml, serializer) {
        var routes = [];
        var rte_elements = getElementsByLocalName(xml, 'rte');
        for (var i = 0; i < rte_elements.length; i++) {
            var rte_points = getRoutePoints(rte_elements[i], serializer);
            if (rte_points.length) {
                routes.push(rte_points);
            }
        }
        return routes;
    }

    function getWaypoints(xml, serializer) {
        var waypoint_elements = getElementsByLocalName(xml, 'wpt');
        var waypoints = [];
        for (var i = 0; i < waypoint_elements.length; i++) {
            var waypoint_element = waypoint_elements[i];
            var parsed_point = parsePointElement(waypoint_element, serializer);
            if (!parsed_point) {
                continue;
            }
            var waypoint = {lat: parsed_point.lat, lng: parsed_point.lng};
            if (parsed_point.alt !== undefined) {
                waypoint.alt = parsed_point.alt;
            }
            let wptName = xmlGetNodeText(getElementsByLocalName(waypoint_element, 'name')[0]) || '';
            try {
                wptName = utf8_decode((wptName));
            } catch (e) {
                error = 'CORRUPT';
                wptName = '__invalid point name__';
            }
            waypoint.name = wptName;
            waypoint.symbol_name = xmlGetNodeText(getElementsByLocalName(waypoint_element, 'sym')[0]);
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
    const serializer = new XMLSerializer();
    if (preferNameFromFile) {
        for (let trk of [...getElementsByLocalName(dom, 'trk')]) {
            let trkName = getElementsByLocalName(trk, 'name')[0];
            if (trkName) {
                try {
                    trkName = utf8_decode(xmlGetNodeText(trkName));
                } catch (e) {
                    error = 'CORRUPT';
                }
                if (trkName.length) {
                    name = trkName;
                    break;
                }
            }
        }
    }
    return [{
        name: name,
        tracks: getTrackSegments(dom, serializer).concat(getRoutes(dom, serializer)),
        points: getWaypoints(dom, serializer),
        error: error
    }];
}

export default parseGpx;
