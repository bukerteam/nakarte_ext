import L from 'leaflet';

import {RoutePlanner} from '~/lib/leaflet.control.route-planner';

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

function nextTick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function requestPoints(request) {
    return request.points.map((point) => [point.lat, point.lng]);
}

suite('Route planner control');

test('requests a route through the provider and saves it as an engine-neutral route', async function () {
    const map = createMap();
    const provider = createProviderStub();
    const planner = new RoutePlanner({provider}).addTo(map);
    assert.isFalse(planner._container.classList.contains('visible'));
    planner.onRoutePlannerPointSelect({point: 'from', latlng: L.latLng(55.75, 37.6)});
    planner.onRoutePlannerPointSelect({point: 'to', latlng: L.latLng(55.76, 37.62)});
    await nextTick();
    assert.equal(provider.requests.length, 1);
    assert.deepEqual(requestPoints(provider.requests[0]), [
        [55.75, 37.6],
        [55.76, 37.62],
    ]);
    assert.equal(provider.requests[0].profile, 'driving');
    assert.deepEqual(provider.requests[0].options, {avoidTolls: false, avoidUnpaved: false});
    assert.isTrue(planner._container.classList.contains('visible'));
    assert.equal(planner._status.textContent, '5 min · 2.5 km');
    assert.isFalse(planner._saveButton.disabled);
    assert.equal(planner._routeLayer.getLayers().length, 1);
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
    assert.deepEqual(provider.requests[0].options, {avoidTolls: true, avoidUnpaved: true});
    assert.deepEqual(requestPoints(provider.requests[0]), [
        [55.75, 37.6],
        [55.755, 37.61],
        [55.76, 37.62],
    ]);
    assert.equal(planner._profileSelect.value, 'cycling');
    assert.isTrue(planner._avoidTollsInput.disabled);
    assert.isTrue(planner._avoidTollsInput.checked);
    assert.equal(planner._saveButton.textContent, 'Update route');
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
    const viaLabel = planner._container.querySelector('.route-planner-point-via .route-planner-via-label');
    assert.equal(viaLabel.textContent, 'Meeting point');
    planner.swap();
    await nextTick();
    assert.deepEqual(requestPoints(provider.requests[2]), [
        [55.76, 37.62],
        [55.755, 37.61],
        [55.75, 37.6],
    ]);
    planner.clear();
    assert.isTrue(planner._container.classList.contains('visible'));
    assert.isTrue(planner._saveButton.disabled);
    assert.equal(planner._routeLayer.getLayers().length, 0);
    planner.hide();
    assert.isFalse(planner._container.classList.contains('visible'));
    map.remove();
});
