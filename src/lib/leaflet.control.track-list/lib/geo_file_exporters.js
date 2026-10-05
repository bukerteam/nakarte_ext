import utf8 from 'utf8';
import escapeHtml from 'escape-html';
import {saveNktk} from './parsers/nktk';

function formatText(value) {
    return utf8.encode(escapeHtml(String(value)));
}

function formatAttributes(attributes) {
    if (!attributes) {
        return '';
    }
    return Object.entries(attributes)
        .map(([key, value]) => ` ${key}="${escapeHtml(String(value))}"`)
        .join('');
}

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

function appendLinkElement(gpx, indent, link) {
    const href = link.href === null || link.href === undefined ? '' : ` href="${escapeHtml(String(link.href))}"`;
    const hasText = link.text !== null && link.text !== undefined;
    const hasType = link.type !== null && link.type !== undefined;
    if (!hasText && !hasType) {
        gpx.push(`${indent}<link${href}/>`);
        return;
    }
    gpx.push(`${indent}<link${href}>`);
    if (hasText) {
        gpx.push(`${indent}\t<text>${formatText(link.text)}</text>`);
    }
    if (hasType) {
        gpx.push(`${indent}\t<type>${formatText(link.type)}</type>`);
    }
    gpx.push(`${indent}</link>`);
}

// Writes child elements of wpt/trkpt/rtept in the order defined by GPX 1.1 wptType
function appendPointElements(gpx, indent, {ele, time, name, cmt, desc, link, sym, type}) {
    if (ele !== null && ele !== undefined) {
        gpx.push(`${indent}<ele>${formatText(ele)}</ele>`);
    }
    if (time !== null && time !== undefined) {
        gpx.push(`${indent}<time>${formatText(time)}</time>`);
    }
    if (name !== null && name !== undefined) {
        gpx.push(`${indent}<name>${formatText(name)}</name>`);
    }
    if (cmt !== null && cmt !== undefined) {
        gpx.push(`${indent}<cmt>${formatText(cmt)}</cmt>`);
    }
    if (desc !== null && desc !== undefined) {
        gpx.push(`${indent}<desc>${formatText(desc)}</desc>`);
    }
    if (link) {
        appendLinkElement(gpx, indent, link);
    }
    if (sym !== null && sym !== undefined) {
        gpx.push(`${indent}<sym>${formatText(sym)}</sym>`);
    }
    if (type !== null && type !== undefined) {
        gpx.push(`${indent}<type>${formatText(type)}</type>`);
    }
}

const EXTENSIONS_ELEMENT_RE = /^<(?:[^:\s>]+:)?extensions[\s/>]/u;

function appendExtensions(gpx, indent, extensions) {
    if (!extensions || !extensions.length) {
        return;
    }
    const nodes = extensions
        .map((extension) => String(extension).trim())
        .filter((extension) => extension.length > 0);
    const wrappers = nodes.filter((extension) => EXTENSIONS_ELEMENT_RE.test(extension));
    const children = nodes.filter((extension) => !EXTENSIONS_ELEMENT_RE.test(extension));
    if (children.length) {
        gpx.push(`${indent}<extensions>`);
        for (const child of children) {
            for (const line of child.split('\n')) {
                if (line.trim().length) {
                    gpx.push(`${indent}\t${utf8.encode(line.trim())}`);
                }
            }
        }
        gpx.push(`${indent}</extensions>`);
    }
    for (const wrapper of wrappers) {
        for (const line of wrapper.split('\n')) {
            if (line.trim().length) {
                gpx.push(`${indent}${utf8.encode(line.trim())}`);
            }
        }
    }
}

function saveGpx(segments, name, points, withElevations = false) {
    const gpx = [];
    const fakeTime = '1970-01-01T00:00:01.000Z';
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

    points.forEach(function(marker) {
            const meta = marker.meta || {};
            const attributes = formatAttributes(meta.attributes);
            gpx.push(
                `\t<wpt lat="${marker.latlng.lat.toFixed(6)}" lon="${marker.latlng.lng.toFixed(6)}"${attributes}>`
            );
            appendPointElements(gpx, '\t\t', {
                ele: getPointElevation(marker.latlng.alt, meta, withElevations),
                time: meta.time,
                name: marker.label,
                cmt: meta.cmt,
                desc: meta.desc,
                link: meta.link,
                sym: meta.sym,
                type: meta.type,
            });
            appendExtensions(gpx, '\t\t', meta.extensions);
            gpx.push('\t</wpt>');
        }
    );
    if (segments.length > 0) {
        name = name || 'Track';
        name = formatText(name);
        gpx.push('\t<trk>');
        gpx.push('\t\t<name>' + name + '</name>');

        for (let segment of segments) {
            gpx.push('\t\t<trkseg>');
            for (let point of segment) {
                const meta = point.meta || {};
                const attributes = formatAttributes(meta.attributes);
                gpx.push(
                    `\t\t\t<trkpt lat="${point.lat.toFixed(6)}" lon="${point.lng.toFixed(6)}"${attributes}>`
                );
                appendPointElements(gpx, '\t\t\t\t', {
                    ele: getPointElevation(point.alt, meta, withElevations),
                    // time element is not necessary, added for compatibility to Garmin Connect only
                    time: meta.time || fakeTime,
                    name: meta.name,
                    cmt: meta.cmt,
                    desc: meta.desc,
                    link: meta.link,
                    sym: meta.sym,
                    type: meta.type,
                });
                appendExtensions(gpx, '\t\t\t\t', meta.extensions);
                gpx.push('\t\t\t</trkpt>');
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

    name = name || 'Track';
    name = escapeHtml(name);
    name = utf8.encode(name);

    kml.push('<?xml version="1.0" encoding="UTF-8"?>');
    kml.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
    kml.push('\t<Document>');
    kml.push(`\t\t<name>${name}</name>`);

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
            var label = marker.label;
            label = escapeHtml(label);
            label = utf8.encode(label);
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

