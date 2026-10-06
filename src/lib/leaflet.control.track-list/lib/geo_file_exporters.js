import {POINT_FIELD_ORDER, XML_ATTRIBUTE_NAME_RE, formatXmlText, serializeXmlNode} from './parsers/gpx_utils';
import {saveNktk} from './parsers/nktk';

const FAKE_TIME = '1970-01-01T00:00:01.000Z';

/*
 * Points accepted by saveGpx:
 * - track point: L.LatLng with optional .alt and .meta
 * - waypoint marker: {latlng: L.LatLng, label: string, meta?: object}
 * `meta` is the point metadata object produced by the GPX parser (see parsers/gpx_utils.js).
 */

function getPointElevation(alt, meta, withElevations) {
    if (withElevations && alt !== null && alt !== undefined) {
        return alt.toFixed(1);
    }
    if (meta.ele !== null && meta.ele !== undefined && meta.ele !== '') {
        return meta.ele;
    }
    if (alt !== null && alt !== undefined) {
        return alt.toFixed(1);
    }
    return null;
}

function getPointFields(meta, overrides) {
    const fields = {};
    for (const field of POINT_FIELD_ORDER) {
        fields[field] = meta[field];
    }
    return Object.assign(fields, overrides);
}

function trackPointToGpxPoint(point, withElevations) {
    const meta = point.meta || {};
    return {
        lat: point.lat,
        lng: point.lng,
        attributes: meta.attributes,
        extensions: meta.extensions,
        fields: getPointFields(meta, {
            ele: getPointElevation(point.alt, meta, withElevations),
            time: meta.time || FAKE_TIME,
            name: meta.name,
        }),
    };
}

function waypointToGpxPoint(marker, withElevations) {
    const meta = marker.meta || {};
    return {
        lat: marker.latlng.lat,
        lng: marker.latlng.lng,
        attributes: meta.attributes,
        extensions: meta.extensions,
        fields: getPointFields(meta, {
            ele: getPointElevation(marker.latlng.alt, meta, withElevations),
            time: meta.time,
            name: marker.label,
        }),
    };
}

function formatAttributes(attributes) {
    if (!attributes) {
        return '';
    }
    return Object.entries(attributes)
        .filter(([attributeName]) => XML_ATTRIBUTE_NAME_RE.test(attributeName))
        .map(([attributeName, value]) => ` ${attributeName}="${formatXmlText(value)}"`)
        .join('');
}

function appendLinkElement(gpx, indent, link) {
    const hasText = link.text !== null && link.text !== undefined;
    const hasType = link.type !== null && link.type !== undefined;
    const href = link.href === null || link.href === undefined ? '' : ` href="${formatXmlText(link.href)}"`;
    if (!hasText && !hasType) {
        gpx.push(`${indent}<link${href}/>`);
        return;
    }
    gpx.push(`${indent}<link${href}>`);
    if (hasText) {
        gpx.push(`${indent}\t<text>${formatXmlText(link.text)}</text>`);
    }
    if (hasType) {
        gpx.push(`${indent}\t<type>${formatXmlText(link.type)}</type>`);
    }
    gpx.push(`${indent}</link>`);
}

// Writes child elements of wpt/trkpt/rtept in the order defined by GPX 1.1 wptType
function appendPointElements(gpx, indent, fields) {
    for (const field of POINT_FIELD_ORDER) {
        const value = fields[field];
        if (value === null || value === undefined) {
            continue;
        }
        if (field === 'link') {
            appendLinkElement(gpx, indent, value);
        } else {
            gpx.push(`${indent}<${field}>${formatXmlText(value)}</${field}>`);
        }
    }
}

function appendExtensions(gpx, indent, extensions) {
    if (!extensions || !extensions.length) {
        return;
    }
    gpx.push(`${indent}<extensions>`);
    for (const extension of extensions) {
        gpx.push(`${indent}\t${serializeXmlNode(extension)}`);
    }
    gpx.push(`${indent}</extensions>`);
}

function appendGpxPoint(gpx, indent, tagName, gpxPoint) {
    const attributes = formatAttributes(gpxPoint.attributes);
    const lat = gpxPoint.lat.toFixed(6);
    const lng = gpxPoint.lng.toFixed(6);
    gpx.push(`${indent}<${tagName} lat="${lat}" lon="${lng}"${attributes}>`);
    appendPointElements(gpx, `${indent}\t`, gpxPoint.fields);
    appendExtensions(gpx, `${indent}\t`, gpxPoint.extensions);
    gpx.push(`${indent}</${tagName}>`);
}

function saveGpx(segments, name, points, withElevations = false) {
    const gpx = [];
    const creationTime = new Date().toISOString();

    gpx.push('<?xml version="1.0" encoding="UTF-8" standalone="no" ?>');
    gpx.push(
        '<gpx xmlns="http://www.topografix.com/GPX/1/1" creator="http://nakarte.me" ' +
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 ' +
        'http://www.topografix.com/GPX/1/1/gpx.xsd" version="1.1">'
    );

    gpx.push('\t<metadata>');
    gpx.push(`\t\t<time>${creationTime}</time>`);
    gpx.push('\t</metadata>');

    points.forEach((marker) => appendGpxPoint(gpx, '\t', 'wpt', waypointToGpxPoint(marker, withElevations)));

    if (segments.length > 0) {
        gpx.push('\t<trk>');
        gpx.push(`\t\t<name>${formatXmlText(name || 'Track')}</name>`);
        for (const segment of segments) {
            gpx.push('\t\t<trkseg>');
            for (const point of segment) {
                appendGpxPoint(gpx, '\t\t\t', 'trkpt', trackPointToGpxPoint(point, withElevations));
            }
            gpx.push('\t\t</trkseg>');
        }
        gpx.push('\t</trk>');
    }
    gpx.push('</gpx>');
    return gpx.join('\n');
}

function saveGpxWithElevations(segments, name, points) {
    return saveGpx(segments, name, points, true);
}

function saveKml(segments, name, points) {
    const kml = [];

    kml.push('<?xml version="1.0" encoding="UTF-8"?>');
    kml.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
    kml.push('\t<Document>');
    kml.push(`\t\t<name>${formatXmlText(name || 'Track')}</name>`);

    for (let [i, segment] of segments.entries()) {
        kml.push('\t\t<Placemark>');
        kml.push(`\t\t\t<name>Line ${(i + 1)}</name>`);
        kml.push('\t\t\t<LineString>');
        kml.push('\t\t\t\t<tessellate>1</tessellate>');
        kml.push('\t\t\t\t<coordinates>');

        for (let point of segment) {
            let x = point.lng.toFixed(6);
            let y = point.lat.toFixed(6);
            kml.push(`\t\t\t\t\t${x},${y}`);
        }

        kml.push('\t\t\t\t</coordinates>');
        kml.push('\t\t\t</LineString>');
        kml.push('\t\t</Placemark>');
    }

    points.forEach(function(marker) {
            var label = formatXmlText(marker.label);
            var coordinates = marker.latlng.lng.toFixed(6) + ',' + marker.latlng.lat.toFixed(6) + ',0';

            kml.push('\t\t<Placemark>');
            kml.push('\t\t\t<name>' + label + '</name>');
            kml.push('\t\t\t<Point>');
            kml.push('\t\t\t\t<coordinates>' + coordinates + '</coordinates>');
            kml.push('\t\t\t</Point>');
            kml.push('\t\t</Placemark>');
        }
    );

    kml.push('\t</Document>');
    kml.push('\t</kml>');

    return kml.join('\n');
}

export {saveGpx, saveGpxWithElevations, saveKml, saveNktk as saveToString};
