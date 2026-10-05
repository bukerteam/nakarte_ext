import L from 'leaflet';

import {RectangleSelect} from '~/lib/leaflet.control.jnx/selector';

function createSelector() {
    const container = L.DomUtil.create('div');
    container.style.width = '400px';
    container.style.height = '300px';
    document.body.appendChild(container);
    const map = L.map(container).setView([20, 30], 5);
    const selector = new RectangleSelect([
        [10, 20],
        [30, 40],
    ]).addTo(map);
    return {
        selector: selector,
        destroy: () => {
            map.remove();
            container.remove();
        },
    };
}

function dragHandle(selector, handleName, lat, lng) {
    const marker = selector.markers[handleName];
    marker.setLatLng([lat, lng]);
    selector.onHandleDrag({target: marker});
}

function boundsToArray(bounds) {
    return [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()];
}

suite('RectangleSelect - dragging handles');

test('edge handle moves only its side', function () {
    const {selector, destroy} = createSelector();
    dragHandle(selector, 'top', 12, 0);
    assert.deepEqual(boundsToArray(selector.getBounds()), [10, 20, 12, 40]);
    destroy();
});

test('corner handle moves two sides', function () {
    const {selector, destroy} = createSelector();
    dragHandle(selector, 'bottomright', 25, 45);
    assert.deepEqual(boundsToArray(selector.getBounds()), [25, 20, 30, 45]);
    destroy();
});

test('corner dragged past the opposite one does not invert the rectangle', function () {
    const {selector, destroy} = createSelector();
    dragHandle(selector, 'topleft', 50, 50);
    const bounds = selector.getBounds();
    assert.isBelow(bounds.getSouth(), bounds.getNorth());
    assert.isBelow(bounds.getWest(), bounds.getEast());
    destroy();
});

test('edge dragged past the opposite one does not invert the rectangle', function () {
    const {selector, destroy} = createSelector();
    dragHandle(selector, 'bottom', 50, 0);
    const bounds = selector.getBounds();
    assert.isBelow(bounds.getSouth(), bounds.getNorth());
    assert.isAtMost(bounds.getSouth(), 30);
    destroy();
});
