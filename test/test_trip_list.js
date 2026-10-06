import L from 'leaflet';

import {TripList} from '~/lib/leaflet.control.trip-list';

const STORAGE_KEY = 'tripListState';

function createMap() {
    const container = document.createElement('div');
    container.style.width = '400px';
    container.style.height = '300px';
    document.body.appendChild(container);
    return L.map(container, {center: [55.75, 37.6], zoom: 10});
}

function createTripList(map) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const tripList = new TripList();
    tripList.attach(map, container);
    return tripList;
}

function makeRouteData(geometry) {
    return {
        id: null,
        from: {lat: 55.75, lng: 37.6, label: 'Start'},
        to: {lat: 55.76, lng: 37.62, label: 'Finish'},
        viaPoints: [],
        profile: 'driving',
        options: {avoidTolls: false, avoidUnpaved: false, preferShortest: false},
        geometry,
        duration: 300,
        distance: 2500,
    };
}

function straightLine(count) {
    const coordinates = [];
    for (let index = 0; index < count; index += 1) {
        coordinates.push([37.6 + index * 0.00001, 55.75 + index * 0.000005]);
    }
    return {type: 'LineString', coordinates};
}

function storedRoutes() {
    const state = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return state.trips[0].routes;
}

suite('Trips list control');

test('saves a route, persists it and restores it', function () {
    localStorage.removeItem(STORAGE_KEY);
    const map = createMap();
    const tripList = createTripList(map);
    const route = tripList.saveRoute(makeRouteData(straightLine(50)));
    assert.equal(route.id, 1);
    assert.isTrue(map.hasLayer(route.layer));
    assert.equal(storedRoutes().length, 1);
    const secondMap = createMap();
    const secondTripList = createTripList(secondMap);
    assert.equal(secondTripList.getContainer().querySelectorAll('.trip-list-route').length, 1);
    assert.include(secondTripList.getContainer().textContent, 'Start → Finish');
    map.remove();
    secondMap.remove();
    localStorage.removeItem(STORAGE_KEY);
});

test('simplifies the geometry before storing it', function () {
    localStorage.removeItem(STORAGE_KEY);
    const map = createMap();
    const tripList = createTripList(map);
    tripList.saveRoute(makeRouteData(straightLine(500)));
    assert.isBelow(storedRoutes()[0].geometry.coordinates.length, 5);
    map.remove();
    localStorage.removeItem(STORAGE_KEY);
});

test('updates an existing route instead of duplicating it', function () {
    localStorage.removeItem(STORAGE_KEY);
    const map = createMap();
    const tripList = createTripList(map);
    const route = tripList.saveRoute(makeRouteData(straightLine(10)));
    const updated = tripList.saveRoute({...makeRouteData(straightLine(10)), id: route.id, distance: 3000});
    assert.equal(updated.id, route.id);
    assert.equal(tripList.getContainer().querySelectorAll('.trip-list-route').length, 1);
    assert.equal(storedRoutes().length, 1);
    assert.equal(storedRoutes()[0].distance, 3000);
    map.remove();
    localStorage.removeItem(STORAGE_KEY);
});

test('toggles route visibility and color', function () {
    localStorage.removeItem(STORAGE_KEY);
    const map = createMap();
    const tripList = createTripList(map);
    const route = tripList.saveRoute(makeRouteData(straightLine(10)));
    const visibility = tripList.getContainer().querySelector('.trip-list-route .trip-list-visibility');
    visibility.checked = false;
    visibility.dispatchEvent(new Event('change'));
    assert.isFalse(route.visible);
    assert.isFalse(map.hasLayer(route.layer));
    tripList.setRouteColor(route, '#d93025');
    assert.equal(storedRoutes()[0].color, '#d93025');
    map.remove();
    localStorage.removeItem(STORAGE_KEY);
});

test('deletes a route', function () {
    localStorage.removeItem(STORAGE_KEY);
    const map = createMap();
    const tripList = createTripList(map);
    const route = tripList.saveRoute(makeRouteData(straightLine(10)));
    const removeButton = tripList
        .getContainer()
        .querySelector('.trip-list-route .trip-list-action[title="Delete route"]');
    removeButton.click();
    assert.equal(tripList.getContainer().querySelectorAll('.trip-list-route').length, 0);
    assert.isFalse(map.hasLayer(route.layer));
    map.remove();
    localStorage.removeItem(STORAGE_KEY);
});
