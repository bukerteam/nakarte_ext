/* eslint-disable camelcase -- GPX element names use snake_case */
import L from 'leaflet';
import utf8 from 'utf8';

import {saveGpx, saveGpxWithElevations} from '~/lib/leaflet.control.track-list/lib/geo_file_exporters';
import parseGpx from '~/lib/leaflet.control.track-list/lib/parsers/gpx';
// eslint-disable-next-line import/no-unassigned-import -- registers L.Control.TrackList
import '~/lib/leaflet.control.track-list/track-list';

// eslint-disable-next-line import/no-unresolved -- .gpx files are handled by raw-loader
import gpxFixture from './track_load_data/files/gpx_metadata_roundtrip.gpx';

const OSMAND_NS = 'https://osmand.net';
const GPXTPX_NS = 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1';

const OSMAND_COLOR_XML = `<osmand:color xmlns:osmand="${OSMAND_NS}">#ff0000</osmand:color>`;
const OSMAND_ICON_XML = `<osmand:icon xmlns:osmand="${OSMAND_NS}">special_star</osmand:icon>`;
const GPXTPX_HR_XML =
    `<gpxtpx:TrackPointExtension xmlns:gpxtpx="${GPXTPX_NS}">` +
    '<gpxtpx:hr>142</gpxtpx:hr></gpxtpx:TrackPointExtension>';

function canonicalXml(xml) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (!doc || doc.documentElement.nodeName === 'parsererror') {
        return xml;
    }
    return new XMLSerializer().serializeToString(doc.documentElement);
}

function clean(value) {
    if (Array.isArray(value)) {
        return value.map(clean);
    }
    if (value && typeof value === 'object') {
        const result = {};
        for (const [key, entryValue] of Object.entries(value)) {
            if (entryValue !== undefined) {
                result[key] = clean(entryValue);
            }
        }
        return result;
    }
    return value;
}

function normalizePoint(point) {
    const result = clean({lat: point.lat, lng: point.lng, alt: point.alt, meta: point.meta});
    if (result.meta && result.meta.extensions) {
        result.meta.extensions = result.meta.extensions.map(canonicalXml);
    }
    return result;
}

function normalizeWaypoint(point) {
    return clean({...normalizePoint(point), name: point.name, symbol_name: point.symbol_name});
}

function normalizeGeodata(geodata) {
    return {
        points: geodata.points.map(normalizeWaypoint),
        tracks: geodata.tracks.map((segment) => segment.map(normalizePoint)),
    };
}

function parseFixture() {
    return parseGpx(utf8.encode(gpxFixture), 'fixture')[0];
}

function waypointsToMarkers(points) {
    return points.map((point) => ({
        latlng: L.latLng(point.lat, point.lng, point.alt),
        label: point.name,
        meta: point.meta,
    }));
}

function exportParsedGeodata(geodata) {
    return saveGpx(geodata.tracks, geodata.name, waypointsToMarkers(geodata.points));
}

// The track list control needs a map only for rendering, the data model works without it
function createTrackListWithoutMap() {
    const trackList = new L.Control.TrackList();
    trackList.map = {addLayer: () => null, removeLayer: () => null};
    trackList._markerLayer = {
        addMarkers: () => null,
        removeMarkers: () => null,
        updateMarkers: () => null,
    };
    trackList.scrollListToTrack = () => null;
    return trackList;
}

suite('GPX metadata');

test('parses waypoint metadata', function () {
    const geodata = parseFixture();
    assert.deepEqual(normalizeWaypoint(geodata.points[0]), {
        lat: 56.1,
        lng: 28.1,
        alt: 123.4,
        name: 'Waypoint & один',
        symbol_name: 'Flag, Blue',
        meta: {
            ele: '123.4',
            time: '2020-01-02T03:04:05Z',
            name: 'Waypoint & один',
            cmt: 'Комментарий',
            desc: 'Описание <test>',
            link: {href: 'https://example.com/wpt', text: 'Ссылка', type: 'text/html'},
            sym: 'Flag, Blue',
            type: 'user',
            attributes: {'data-source': 'fixture'},
            extensions: [canonicalXml(OSMAND_COLOR_XML), canonicalXml(OSMAND_ICON_XML)],
        },
    });
    assert.deepEqual(normalizeWaypoint(geodata.points[1]), {
        lat: 56.2,
        lng: 28.2,
        name: 'Plain waypoint',
        symbol_name: null,
        meta: {name: 'Plain waypoint'},
    });
});

test('parses trackpoint and routepoint metadata', function () {
    const geodata = parseFixture();
    assert.deepEqual(normalizePoint(geodata.tracks[0][0]), {
        lat: 56.3,
        lng: 28.3,
        alt: 10.5,
        meta: {
            ele: '10.5',
            time: '2020-01-02T03:04:05Z',
            name: 'TP1',
            cmt: 'комментарий 1',
            desc: 'описание <1>',
            link: {href: 'https://example.com/1', text: 'one', type: 'text/html'},
            sym: 'Dot',
            type: 't1',
            attributes: {'data-source': 'fixture'},
            extensions: [canonicalXml(GPXTPX_HR_XML)],
        },
    });
    assert.deepEqual(normalizePoint(geodata.tracks[0][2]), {
        lat: 56.302,
        lng: 28.3,
        alt: 30,
        meta: {
            ele: '30',
            time: '2020-01-02T03:04:25Z',
            desc: 'только описание',
        },
    });
    assert.deepEqual(normalizePoint(geodata.tracks[2][0]), {
        lat: 56.4,
        lng: 28.4,
        alt: 100,
        meta: {
            ele: '100',
            time: '2020-01-02T04:00:00Z',
            name: 'RP1',
            sym: 'Waypoint',
        },
    });
});

test('parser-exporter round trip preserves metadata', function () {
    const geodata = parseFixture();
    const exported = exportParsedGeodata(geodata);
    assert.include(exported, OSMAND_COLOR_XML);
    const reimported = parseGpx(exported, 'fixture')[0];
    assert.deepEqual(normalizeGeodata(reimported), normalizeGeodata(geodata));
});

test('track list model round trip preserves metadata', async function () {
    const geodata = parseFixture();
    const trackList = createTrackListWithoutMap();
    trackList.addTracksFromGeodataArray([geodata]);
    const track = trackList.tracks()[0];

    const firstTrackPoint = trackList.getTrackPolylines(track)[0].getLatLngs()[0];
    assert.equal(firstTrackPoint.meta.desc, 'описание <1>');
    assert.deepEqual(firstTrackPoint.meta.extensions.map(canonicalXml), [canonicalXml(GPXTPX_HR_XML)]);
    const firstWaypoint = trackList.getTrackPoints(track)[0];
    assert.equal(firstWaypoint.meta.desc, 'Описание <test>');
    assert.equal(firstWaypoint.latlng.alt, 123.4);

    const {content} = await trackList.exportTrackAsFile(track, saveGpx, '.gpx', false, false);
    const reimported = parseGpx(content, 'fixture')[0];
    assert.deepEqual(normalizeGeodata(reimported), normalizeGeodata(parseFixture()));
});

test('saveGpxWithElevations uses provided elevations', function () {
    const point = {lat: 1, lng: 2, alt: 7.77, meta: {ele: '5'}};
    assert.include(saveGpx([[point]], 'track', []), '<ele>5</ele>');
    assert.include(saveGpxWithElevations([[point]], 'track', []), '<ele>7.8</ele>');
    assert.include(saveGpx([[{lat: 1, lng: 2}]], 'track', []), '<time>1970-01-01T00:00:01.000Z</time>');
});

test('parses files with undeclared namespace prefixes using legacy fallback', function () {
    const txt =
        '<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>' +
        '<trkpt lat="1" lon="2"><ele>3</ele><osmand:color>red</osmand:color></trkpt>' +
        '</trkseg></trk></gpx>';
    const geodata = parseGpx(txt, 'test')[0];
    assert.equal(geodata.tracks[0][0].alt, 3);
    assert.deepEqual(geodata.tracks[0][0].meta.extensions, ['<osmand_color>red</osmand_color>']);
});
