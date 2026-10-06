import L from 'leaflet';

import Contextmenu from '~/lib/contextmenu';
import {RoutePlanner} from '~/lib/leaflet.control.route-planner';
import {enableRoutePlanning} from '~/lib/route-planning';

const ROUTE_GEOMETRY = {
    type: 'LineString',
    coordinates: [
        [37.6, 55.75],
        [37.62, 55.76],
    ],
};

function createMap() {
    const container = document.createElement('div');
    container.style.width = '400px';
    container.style.height = '300px';
    document.body.appendChild(container);
    return L.map(container, {center: [55.75, 37.6], zoom: 10});
}

function createProviderStub() {
    const requests = [];
    return {
        requests,
        route: async function (request) {
            requests.push(request);
            return {
                geometry: ROUTE_GEOMETRY,
                distance: 2500,
                duration: 300,
            };
        },
    };
}

function createDeferredProvider() {
    const requests = [];
    return {
        requests,
        route: function (request) {
            return new Promise((resolve) => requests.push({request, resolve}));
        },
    };
}

function nextTick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function requestPoints(request) {
    return request.points.map((point) => [point.lat, point.lng]);
}

function countRouteLines(map) {
    let count = 0;
    map.eachLayer((layer) => {
        if (layer instanceof L.Path) {
            count += 1;
        }
    });
    return count;
}

function element(planner, selector) {
    return planner.getContainer().querySelector(selector);
}

function closeOpenContextMenu() {
    document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
}

suite('Route planner control');

test('requests a route through the provider and saves it as an engine-neutral route', async function () {
    const map = createMap();
    const provider = createProviderStub();
    const planner = new RoutePlanner({provider}).addTo(map);
    assert.isFalse(planner.getContainer().classList.contains('visible'));
    planner.onRoutePlannerPointSelect({point: 'from', latlng: L.latLng(55.75, 37.6)});
    planner.onRoutePlannerPointSelect({point: 'to', latlng: L.latLng(55.76, 37.62)});
    await nextTick();
    assert.equal(provider.requests.length, 1);
    assert.deepEqual(requestPoints(provider.requests[0]), [
        [55.75, 37.6],
        [55.76, 37.62],
    ]);
    assert.equal(provider.requests[0].profile, 'driving');
    assert.deepEqual(provider.requests[0].options, {
        avoidTolls: false,
        avoidUnpaved: false,
        preferShortest: false,
    });
    assert.isTrue(planner.getContainer().classList.contains('visible'));
    assert.equal(element(planner, '.route-planner-status').textContent, '5 min · 2.5 km');
    assert.isFalse(element(planner, '.route-planner-save').disabled);
    assert.equal(countRouteLines(map), 1);
    let savedRoute = null;
    planner.on('save', (e) => {
        savedRoute = e.route;
    });
    planner.saveRoute();
    assert.isNotNull(savedRoute);
    assert.deepEqual(savedRoute.geometry, ROUTE_GEOMETRY);
    assert.equal(savedRoute.distance, 2500);
    assert.equal(savedRoute.duration, 300);
    assert.deepEqual(savedRoute.from, {lat: 55.75, lng: 37.6, label: null});
    assert.deepEqual(savedRoute.to, {lat: 55.76, lng: 37.62, label: null});
    map.remove();
});

test('recalculates a route through the adapter when it is edited', async function () {
    const map = createMap();
    const provider = createProviderStub();
    const planner = new RoutePlanner({provider}).addTo(map);
    planner.editRoute({
        id: 7,
        from: {lat: 55.75, lng: 37.6, label: 'Start'},
        to: {lat: 55.76, lng: 37.62, label: 'Finish'},
        viaPoints: [{lat: 55.755, lng: 37.61, label: 'Meeting point'}],
        profile: 'cycling',
        options: {avoidTolls: true, avoidUnpaved: true},
        color: '#188038',
        geometry: ROUTE_GEOMETRY,
        duration: 300,
        distance: 2500,
    });
    await nextTick();
    assert.equal(provider.requests.length, 1);
    assert.equal(provider.requests[0].profile, 'cycling');
    assert.deepEqual(provider.requests[0].options, {
        avoidTolls: true,
        avoidUnpaved: true,
        preferShortest: false,
    });
    assert.deepEqual(requestPoints(provider.requests[0]), [
        [55.75, 37.6],
        [55.755, 37.61],
        [55.76, 37.62],
    ]);
    assert.equal(element(planner, '.route-planner-profile').value, 'cycling');
    assert.isTrue(element(planner, '.route-planner-avoid-tolls').disabled);
    assert.isTrue(element(planner, '.route-planner-avoid-tolls').checked);
    assert.equal(element(planner, '.route-planner-save').textContent, 'Update route');
    map.remove();
});

test('adds via points and swaps the endpoints', async function () {
    const map = createMap();
    const provider = createProviderStub();
    const planner = new RoutePlanner({provider}).addTo(map);
    planner.onRoutePlannerPointSelect({point: 'from', latlng: L.latLng(55.75, 37.6)});
    planner.onRoutePlannerPointSelect({point: 'to', latlng: L.latLng(55.76, 37.62)});
    await nextTick();
    planner.addViaPoint(L.latLng(55.755, 37.61), 'Meeting point');
    await nextTick();
    assert.deepEqual(requestPoints(provider.requests[1]), [
        [55.75, 37.6],
        [55.755, 37.61],
        [55.76, 37.62],
    ]);
    const viaLabel = element(planner, '.route-planner-point-via .route-planner-point-label');
    assert.equal(viaLabel.textContent, 'Meeting point');
    planner.swap();
    await nextTick();
    assert.deepEqual(requestPoints(provider.requests[2]), [
        [55.76, 37.62],
        [55.755, 37.61],
        [55.75, 37.6],
    ]);
    planner.clear();
    assert.isTrue(planner.getContainer().classList.contains('visible'));
    assert.isTrue(element(planner, '.route-planner-save').disabled);
    assert.equal(countRouteLines(map), 0);
    planner.hide();
    assert.isFalse(planner.getContainer().classList.contains('visible'));
    map.remove();
});

test('sends preferShortest and disables avoid options', async function () {
    const map = createMap();
    const provider = createProviderStub();
    const planner = new RoutePlanner({provider}).addTo(map);
    planner.onRoutePlannerPointSelect({point: 'from', latlng: L.latLng(55.75, 37.6)});
    planner.onRoutePlannerPointSelect({point: 'to', latlng: L.latLng(55.76, 37.62)});
    await nextTick();
    const shortest = element(planner, '.route-planner-prefer-shortest');
    shortest.checked = true;
    shortest.dispatchEvent(new Event('change'));
    await nextTick();
    const lastRequest = provider.requests[provider.requests.length - 1];
    assert.deepEqual(lastRequest.options, {avoidTolls: false, avoidUnpaved: false, preferShortest: true});
    assert.isTrue(element(planner, '.route-planner-avoid-tolls').disabled);
    assert.isTrue(element(planner, '.route-planner-avoid-unpaved').disabled);
    map.remove();
});

test('ignores the response of a request superseded by newer options', async function () {
    const map = createMap();
    const provider = createDeferredProvider();
    const planner = new RoutePlanner({provider}).addTo(map);
    planner.onRoutePlannerPointSelect({point: 'from', latlng: L.latLng(55.75, 37.6)});
    planner.onRoutePlannerPointSelect({point: 'to', latlng: L.latLng(55.76, 37.62)});
    await nextTick();
    assert.equal(provider.requests.length, 1);
    const shortest = element(planner, '.route-planner-prefer-shortest');
    shortest.checked = true;
    shortest.dispatchEvent(new Event('change'));
    await nextTick();
    assert.equal(provider.requests.length, 2);
    provider.requests[1].resolve({
        geometry: {
            type: 'LineString',
            coordinates: [
                [0, 0],
                [2, 2],
            ],
        },
        distance: 2,
        duration: 2,
    });
    await nextTick();
    provider.requests[0].resolve({
        geometry: {
            type: 'LineString',
            coordinates: [
                [0, 0],
                [1, 1],
            ],
        },
        distance: 1,
        duration: 1,
    });
    await nextTick();
    assert.equal(element(planner, '.route-planner-status').textContent, '0 min · 2 m');
    map.remove();
});

test('shows the provider error in the status', async function () {
    const map = createMap();
    const provider = {
        route: async function () {
            throw new Error('Routing service request timed out');
        },
    };
    const planner = new RoutePlanner({provider}).addTo(map);
    planner.onRoutePlannerPointSelect({point: 'from', latlng: L.latLng(55.75, 37.6)});
    planner.onRoutePlannerPointSelect({point: 'to', latlng: L.latLng(55.76, 37.62)});
    await nextTick();
    assert.equal(
        element(planner, '.route-planner-status').textContent,
        'Could not build a route: Routing service request timed out'
    );
    map.remove();
});

test('opens a single context menu on map right-click', function () {
    const map = createMap();
    new RoutePlanner({provider: createProviderStub()}).addTo(map);
    map.getContainer().dispatchEvent(
        new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: 100, clientY: 100})
    );
    const menus = document.querySelectorAll('.contextmenu');
    assert.equal(menus.length, 1);
    assert.include(menus[0].textContent, 'Route from');
    closeOpenContextMenu();
    assert.equal(document.querySelectorAll('.contextmenu').length, 0);
    map.remove();
});

test('ignores a contextmenu event already handled by another component', function () {
    const map = createMap();
    new RoutePlanner({provider: createProviderStub()}).addTo(map);
    const contextMenuEvent = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
    });
    Contextmenu.markHandled(contextMenuEvent);
    map.getContainer().dispatchEvent(contextMenuEvent);
    assert.equal(document.querySelectorAll('.contextmenu').length, 0);
    map.remove();
});

test('removes a via point with the remove button and recalculates the route', async function () {
    const map = createMap();
    const provider = createProviderStub();
    const planner = new RoutePlanner({provider}).addTo(map);
    planner.onRoutePlannerPointSelect({point: 'from', latlng: L.latLng(55.75, 37.6)});
    planner.onRoutePlannerPointSelect({point: 'to', latlng: L.latLng(55.76, 37.62)});
    await nextTick();
    planner.addViaPoint(L.latLng(55.755, 37.61), 'Meeting point');
    await nextTick();
    assert.equal(provider.requests.length, 2);
    element(planner, '.route-planner-point-via .route-planner-point-remove').click();
    await nextTick();
    assert.equal(provider.requests.length, 3);
    assert.deepEqual(requestPoints(provider.requests[2]), [
        [55.75, 37.6],
        [55.76, 37.62],
    ]);
    assert.isNull(element(planner, '.route-planner-point-via'));
    map.remove();
});

test('removes an endpoint with the remove button and discards the route', async function () {
    const map = createMap();
    const provider = createProviderStub();
    const planner = new RoutePlanner({provider}).addTo(map);
    planner.onRoutePlannerPointSelect({point: 'from', latlng: L.latLng(55.75, 37.6)});
    planner.onRoutePlannerPointSelect({point: 'to', latlng: L.latLng(55.76, 37.62)});
    await nextTick();
    element(planner, '.route-planner-point-from .route-planner-point-remove').click();
    await nextTick();
    assert.equal(element(planner, '.route-planner-status').textContent, 'Now choose a starting point.');
    assert.isTrue(element(planner, '.route-planner-save').disabled);
    assert.equal(countRouteLines(map), 0);
    assert.equal(provider.requests.length, 1);
    assert.include(element(planner, '.route-planner-point-from .route-planner-point-label').textContent, 'Choose');
    map.remove();
});

test('reorders points with drag and drop', async function () {
    const map = createMap();
    const provider = createProviderStub();
    const planner = new RoutePlanner({provider}).addTo(map);
    planner.onRoutePlannerPointSelect({point: 'from', latlng: L.latLng(55.75, 37.6)});
    planner.onRoutePlannerPointSelect({point: 'to', latlng: L.latLng(55.76, 37.62)});
    await nextTick();
    planner.addViaPoint(L.latLng(55.755, 37.61), 'Meeting point');
    await nextTick();
    const rows = planner.getContainer().querySelectorAll('.route-planner-point');
    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => rows[0];
    try {
        rows[1].dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0, clientX: 0, clientY: 0}));
        document.dispatchEvent(new PointerEvent('pointermove', {bubbles: true, clientX: 0, clientY: 40}));
        document.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, clientX: 0, clientY: 40}));
    } finally {
        document.elementFromPoint = originalElementFromPoint;
    }
    await nextTick();
    assert.deepEqual(requestPoints(provider.requests[provider.requests.length - 1]), [
        [55.755, 37.61],
        [55.75, 37.6],
        [55.76, 37.62],
    ]);
    const labels = Array.from(planner.getContainer().querySelectorAll('.route-planner-point-label'));
    assert.equal(labels[0].textContent, 'Meeting point');
    assert.equal(
        planner.getContainer().querySelector('.route-planner-point-via .route-planner-drag-handle').textContent,
        '⋮'
    );
    map.remove();
});

test('toggles panel visibility', function () {
    const map = createMap();
    const planner = new RoutePlanner({provider: createProviderStub()}).addTo(map);
    assert.isFalse(planner.isVisible());
    planner.toggle();
    assert.isTrue(planner.isVisible());
    planner.toggle();
    assert.isFalse(planner.isVisible());
    map.remove();
});

test('opens the routes panel from the toolbar button and attaches the trips list', function () {
    localStorage.removeItem('tripListState');
    const map = createMap();
    const tracklist = {
        addTrack: function () {
            return null;
        },
    };
    const {routePlanner} = enableRoutePlanning(map, tracklist);
    assert.isFalse(routePlanner.isVisible());
    assert.isTrue(routePlanner.getTripsContainer().classList.contains('trip-list'));
    assert.isNotNull(routePlanner.getTripsContainer().querySelector('.trip-list-header'));
    const button = map.getContainer().querySelector('.leaflet-control-single-button');
    button.click();
    assert.isTrue(routePlanner.isVisible());
    button.click();
    assert.isFalse(routePlanner.isVisible());
    map.remove();
    localStorage.removeItem('tripListState');
});
