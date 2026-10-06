import L from 'leaflet';

import {
    PointsSelection,
    POINTS_ACTION,
    getPointsBounds,
    filterPointsInBounds,
} from '~/lib/leaflet.control.track-list/points-selection';

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

function createTrack(points) {
    return {
        markers: points.map(([lat, lng]) => ({latlng: L.latLng(lat, lng), label: 'point'})),
    };
}

function createFakeMap() {
    return {
        removedLayers: [],
        addLayer: () => undefined,
        removeLayer(layer) {
            this.removedLayers.push(layer);
        },
        getContainer: () => document.createElement('div'),
    };
}

function createFakeToolbar() {
    return {
        counts: [],
        targetingStates: [],
        destroyed: false,
        count(value) {
            this.counts.push(value);
        },
        isTargeting(value) {
            this.targetingStates.push(value);
        },
        destroy() {
            this.destroyed = true;
        },
    };
}

function createController({hasOtherTracks = () => true} = {}) {
    const map = createFakeMap();
    const toolbarStub = createFakeToolbar();
    const applied = [];
    const targetingChanges = [];
    const controller = new PointsSelection({
        map,
        hasOtherTracks,
        getTrackColor: () => '#ff0000',
        createToolbar: (handlers) => {
            toolbarStub.handlers = handlers;
            return toolbarStub;
        },
        onApply: (result) => applied.push(result),
        onActivate: () => undefined,
        onTargetingChange: (value) => targetingChanges.push(value),
    });
    return {controller, map, toolbarStub, applied, targetingChanges};
}

suite('PointsSelection - selection mode');

test('selects all points of a track and reports the count', function () {
    const {controller, toolbarStub} = createController();
    const track = createTrack([
        [49.741, 33.451],
        [49.742, 33.452],
        [49.743, 33.453],
    ]);
    controller.start(track);
    assert.deepEqual(toolbarStub.counts, [3]);
    controller.cancel();
    assert.isTrue(toolbarStub.destroyed);
});

test('delete applies the selected points', function () {
    const {controller, toolbarStub, applied} = createController();
    const track = createTrack([
        [49.741, 33.451],
        [49.742, 33.452],
    ]);
    controller.start(track);
    toolbarStub.handlers.onDelete();
    assert.deepEqual(applied, [{action: POINTS_ACTION.DELETE, sourceTrack: track, points: track.markers}]);
});

test('cancelIfSourceTrack cancels only the selection of the given track', function () {
    const {controller, toolbarStub} = createController();
    const track = createTrack([[49.741, 33.451]]);
    controller.start(track);
    controller.cancelIfSourceTrack(createTrack([]));
    assert.isFalse(toolbarStub.destroyed);
    controller.cancelIfSourceTrack(track);
    assert.isTrue(toolbarStub.destroyed);
});

suite('PointsSelection - targeting mode');

test('copy freezes the selection and applies it to the picked track', function () {
    const {controller, map, toolbarStub, applied, targetingChanges} = createController();
    const sourceTrack = createTrack([[49.741, 33.451]]);
    const targetTrack = createTrack([]);
    controller.start(sourceTrack);
    toolbarStub.handlers.onCopy();
    assert.lengthOf(map.removedLayers, 1);
    assert.deepEqual(toolbarStub.targetingStates, [true]);
    assert.deepEqual(targetingChanges, [true]);
    assert.isTrue(controller.pickTarget(targetTrack));
    assert.deepEqual(applied, [
        {
            action: POINTS_ACTION.COPY,
            sourceTrack: sourceTrack,
            targetTrack: targetTrack,
            points: sourceTrack.markers,
        },
    ]);
    assert.deepEqual(targetingChanges, [true, false]);
    assert.isTrue(toolbarStub.destroyed);
});

test('picking the source track consumes the click without applying', function () {
    const {controller, toolbarStub, applied} = createController();
    const sourceTrack = createTrack([[49.741, 33.451]]);
    controller.start(sourceTrack);
    toolbarStub.handlers.onMove();
    assert.isTrue(controller.pickTarget(sourceTrack));
    assert.lengthOf(applied, 0);
    controller.cancel();
});

test('pickTarget does nothing outside the targeting mode', function () {
    const {controller} = createController();
    assert.isFalse(controller.pickTarget(createTrack([])));
});

test('startTargeting applies a single point to the picked track', function () {
    const {controller, applied, targetingChanges} = createController();
    const sourceTrack = createTrack([[49.741, 33.451]]);
    const targetTrack = createTrack([]);
    controller.startTargeting(sourceTrack, [sourceTrack.markers[0]], POINTS_ACTION.MOVE);
    assert.deepEqual(targetingChanges, [true]);
    controller.pickTarget(targetTrack);
    assert.deepEqual(applied, [
        {
            action: POINTS_ACTION.MOVE,
            sourceTrack: sourceTrack,
            targetTrack: targetTrack,
            points: [sourceTrack.markers[0]],
        },
    ]);
});

test('startTargeting does nothing when there is no other track', function () {
    const {controller, toolbarStub, targetingChanges} = createController({hasOtherTracks: () => false});
    const sourceTrack = createTrack([[49.741, 33.451]]);
    controller.startTargeting(sourceTrack, [sourceTrack.markers[0]], POINTS_ACTION.COPY);
    assert.deepEqual(targetingChanges, []);
    assert.isFalse(toolbarStub.destroyed);
});
