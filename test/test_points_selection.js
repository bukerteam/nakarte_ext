import L from 'leaflet';

import {getPointsBounds, filterPointsInBounds} from '~/lib/leaflet.control.track-list/points-selection';

function makePoint(lat, lng) {
    return {latlng: L.latLng(lat, lng)};
}

suite('PointsSelection - getPointsBounds');

test('bounds contain all points', function () {
    const points = [makePoint(49.741, 33.451), makePoint(49.743, 33.453)];
    const bounds = getPointsBounds(points);
    assert.isBelow(bounds.getSouth(), 49.741);
    assert.isAbove(bounds.getNorth(), 49.743);
    assert.isBelow(bounds.getWest(), 33.451);
    assert.isAbove(bounds.getEast(), 33.453);
    for (const point of points) {
        assert.isTrue(bounds.contains(point.latlng));
    }
});

test('bounds of a single point have minimum padding', function () {
    const bounds = getPointsBounds([makePoint(49.741, 33.451)]);
    assert.isBelow(bounds.getSouth(), 49.741);
    assert.isAbove(bounds.getNorth(), 49.741);
    assert.isBelow(bounds.getWest(), 33.451);
    assert.isAbove(bounds.getEast(), 33.451);
});

suite('PointsSelection - filterPointsInBounds');

test('filters points by bounds and preserves order', function () {
    const inside1 = makePoint(49.741, 33.451);
    const inside2 = makePoint(49.743, 33.453);
    const outside = makePoint(50, 34);
    const bounds = getPointsBounds([inside1, inside2]);
    const filtered = filterPointsInBounds([inside1, outside, inside2], bounds);
    assert.deepEqual(filtered, [inside1, inside2]);
});

test('returns empty list when no points are inside', function () {
    const bounds = getPointsBounds([makePoint(49.741, 33.451)]);
    const filtered = filterPointsInBounds([makePoint(50, 34)], bounds);
    assert.deepEqual(filtered, []);
});
