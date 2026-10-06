import L from 'leaflet';

import Contextmenu from '~/lib/contextmenu';
import '~/lib/leaflet.lineutil.simplifyLatLngs';
import {ROUTE_COLORS, formatDistance, formatDuration} from '~/lib/route-planning/common';
import safeLocalStorage from '~/lib/safe-localstorage';
import './style.css';

const STORAGE_KEY = 'tripListState';
// Same tolerance as the track list: simplifies stored geometry without visible loss.
const SIMPLIFY_TOLERANCE = 360 / (1 << 24);

function routeTitle(route) {
    return `${route.from.label || 'Start'} → ${route.to.label || 'Destination'}`;
}

function routeColor(route) {
    if (route.color) {
        return route.color;
    }
    const id = Math.abs(Number(route.id)) || 1;
    return ROUTE_COLORS[(id - 1) % ROUTE_COLORS.length];
}

function simplifyGeometry(geometry) {
    if (!geometry || geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates)) {
        return geometry;
    }
    const latlngs = geometry.coordinates.map(([lng, lat]) => L.latLng(lat, lng));
    const simplified = L.LineUtil.simplifyLatlngs(latlngs, SIMPLIFY_TOLERANCE);
    return {
        type: 'LineString',
        coordinates: simplified.map((point) => [point.lng, point.lat]),
    };
}

function serializeRoute(route) {
    return {
        id: route.id,
        name: route.name,
        color: route.color,
        visible: route.visible,
        from: route.from,
        to: route.to,
        viaPoints: route.viaPoints,
        profile: route.profile,
        options: route.options,
        geometry: route.geometry,
        duration: route.duration,
        distance: route.distance,
    };
}

const TripList = L.Class.extend({
    includes: L.Mixin.Events,

    initialize: function () {
        this._trips = [];
        this._selectedTrip = null;
        this._nextTripId = 1;
        this._nextRouteId = 1;
        this.restoreState();
    },

    attach: function (map, container) {
        this._map = map;
        this._container = container;
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        this._trips.forEach((trip) => {
            trip.routes.forEach((route) => {
                route.layer = this.createRouteLayer(route);
                if (trip.visible && route.visible) {
                    this._map.addLayer(route.layer);
                }
            });
        });
        this.render();
    },

    getContainer: function () {
        return this._container;
    },

    createTrip: function () {
        const trip = {
            id: this._nextTripId,
            name: `Trip ${this._nextTripId}`,
            expanded: true,
            visible: true,
            routes: [],
        };
        this._nextTripId += 1;
        this._trips.push(trip);
        this._selectedTrip = trip;
        this.persistState();
        return trip;
    },

    createRouteLayer: function (route) {
        return L.geoJSON(
            {type: 'Feature', geometry: route.geometry},
            {style: {color: routeColor(route), weight: 6, opacity: 0.9}}
        );
    },

    showRouteMenu: function (e, trip, route) {
        Contextmenu.markHandled(e);
        L.DomEvent.stopPropagation(e);
        new Contextmenu([
            {text: 'Rename route', callback: () => this.renameRoute(route)},
            {text: 'Convert to track', callback: () => this.fire('converttotrack', {trip, route})},
        ]).show(e);
    },

    showRouteColorMenu: function (e, route) {
        L.DomEvent.stopPropagation(e);
        new Contextmenu(
            ROUTE_COLORS.map((color) => ({
                text: `<span class="trip-list-color-menu-item" style="background-color: ${color}"></span>`,
                callback: () => this.setRouteColor(route, color),
            }))
        ).show(e);
    },

    persistState: function () {
        const trips = this._trips.map((trip) => ({
            id: trip.id,
            name: trip.name,
            expanded: trip.expanded,
            visible: trip.visible,
            routes: trip.routes.map(serializeRoute),
        }));
        try {
            safeLocalStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    trips,
                    selectedTripId: this._selectedTrip && this._selectedTrip.id,
                    nextTripId: this._nextTripId,
                    nextRouteId: this._nextRouteId,
                })
            );
        } catch (error) {
            // Routes remain available in the current page if browser storage is unavailable or full.
        }
    },

    restoreState: function () {
        try {
            const state = JSON.parse(safeLocalStorage.getItem(STORAGE_KEY) || '{}');
            if (!Array.isArray(state.trips)) {
                return;
            }
            this._trips = state.trips.filter((trip) => Array.isArray(trip.routes));
            this._trips.forEach((trip) => {
                trip.expanded = trip.expanded !== false;
                trip.visible = trip.visible !== false;
                trip.routes = trip.routes.filter((route) => route.geometry && route.from && route.to);
                trip.routes.forEach((route) => {
                    route.visible = route.visible !== false;
                    route.name = route.name || routeTitle(route);
                    route.color = routeColor(route);
                    route.viaPoints = route.viaPoints || [];
                    route.options = route.options || {};
                });
            });
            this._selectedTrip = this._trips.find((trip) => trip.id === state.selectedTripId) || this._trips[0] || null;
            const maxTripId = Math.max(0, ...this._trips.map((trip) => trip.id));
            const maxRouteId = Math.max(0, ...this._trips.flatMap((trip) => trip.routes.map((route) => route.id)));
            this._nextTripId = Math.max(Number(state.nextTripId) || 0, maxTripId + 1);
            this._nextRouteId = Math.max(Number(state.nextRouteId) || 0, maxRouteId + 1);
        } catch (error) {
            safeLocalStorage.removeItem(STORAGE_KEY);
        }
    },

    saveRoute: function (routeData) {
        const simplified = {...routeData, geometry: simplifyGeometry(routeData.geometry)};
        let routeId = simplified.id;
        let trip = this._selectedTrip;
        if (routeId) {
            const routeTrip = this._trips.find((item) => item.routes.some((route) => route.id === routeId));
            if (routeTrip) {
                trip = routeTrip;
                this._selectedTrip = trip;
            } else {
                routeId = null;
            }
        }
        if (!trip) {
            trip = this.createTrip();
        }
        let route = trip.routes.find((item) => item.id === routeId);
        if (route) {
            this._map.removeLayer(route.layer);
            Object.assign(route, simplified);
        } else {
            route = {...simplified, id: this._nextRouteId, visible: true};
            this._nextRouteId += 1;
            trip.routes.push(route);
        }
        route.name = routeTitle(route);
        route.color = routeColor(route);
        route.layer = this.createRouteLayer(route);
        if (trip.visible && route.visible) {
            this._map.addLayer(route.layer);
        }
        this.finishRouteEditing(route.id);
        this.persistState();
        this.render();
        return route;
    },

    setRouteVisibility: function (trip, route, visible) {
        route.visible = visible;
        if (visible && trip.visible && this._editingRoute !== route) {
            this._map.addLayer(route.layer);
        } else {
            this._map.removeLayer(route.layer);
        }
        this.persistState();
        this.render();
    },

    setRouteColor: function (route, color) {
        route.color = color;
        route.layer.setStyle({color});
        this.persistState();
        this.render();
    },

    setTripVisibility: function (trip, visible) {
        trip.visible = visible;
        trip.routes.forEach((route) => {
            if (visible && route.visible && this._editingRoute !== route) {
                this._map.addLayer(route.layer);
            } else {
                this._map.removeLayer(route.layer);
            }
        });
        this.persistState();
        this.render();
    },

    focusRoute: function (route) {
        this._map.fitBounds(route.layer.getBounds(), {padding: [40, 40], maxZoom: 15});
    },

    editRoute: function (route) {
        this.cancelRouteEditing();
        this._editingRoute = route;
        this._map.removeLayer(route.layer);
        this.fire('editroute', {route});
    },

    finishRouteEditing: function (routeId) {
        if (this._editingRoute && this._editingRoute.id === routeId) {
            this._editingRoute = null;
        }
    },

    cancelRouteEditing: function (routeId = null) {
        if (!this._editingRoute || (routeId && this._editingRoute.id !== routeId)) {
            return;
        }
        const route = this._editingRoute;
        const trip = this._trips.find((item) => item.routes.includes(route));
        if (trip && trip.visible && route.visible) {
            this._map.addLayer(route.layer);
        }
        this._editingRoute = null;
    },

    deleteRoute: function (trip, route) {
        this._map.removeLayer(route.layer);
        this.finishRouteEditing(route.id);
        trip.routes.splice(trip.routes.indexOf(route), 1);
        this.fire('routedeleted', {routeId: route.id});
        this.persistState();
        this.render();
    },

    renameTrip: function (trip) {
        const newName = window.prompt('Trip name', trip.name);
        if (newName && newName.trim()) {
            trip.name = newName.trim();
            this.persistState();
            this.render();
        }
    },

    renameRoute: function (route) {
        const newName = window.prompt('Route name', route.name);
        if (newName && newName.trim()) {
            route.name = newName.trim();
            this.persistState();
            this.render();
        }
    },

    deleteTrip: function (trip) {
        if (!window.confirm(`Delete ${trip.name}?`)) {
            return;
        }
        trip.routes.forEach((route) => {
            this._map.removeLayer(route.layer);
            this.fire('routedeleted', {routeId: route.id});
        });
        this._trips.splice(this._trips.indexOf(trip), 1);
        this._selectedTrip = this._trips[0] || null;
        this.persistState();
        this.render();
    },

    render: function () {
        if (!this._container) {
            return;
        }
        this._container.innerHTML = '';
        const header = L.DomUtil.create('header', 'trip-list-header', this._container);
        header.innerHTML = '<strong>Trips</strong>';
        const addButton = L.DomUtil.create('button', 'trip-list-add', header);
        addButton.type = 'button';
        addButton.textContent = '+';
        addButton.title = 'New trip';
        addButton.addEventListener('click', () => {
            this.createTrip();
            this.render();
        });
        if (!this._trips.length) {
            const empty = L.DomUtil.create('p', 'trip-list-empty', this._container);
            empty.textContent = 'Save a route to create your first trip.';
            return;
        }
        this._trips.forEach((trip) => this.renderTrip(trip));
    },

    renderTrip: function (trip) {
        const tripElement = L.DomUtil.create('div', 'trip-list-trip', this._container);
        if (trip === this._selectedTrip) {
            tripElement.classList.add('selected');
        }
        const row = L.DomUtil.create('div', 'trip-list-trip-row', tripElement);
        const visible = L.DomUtil.create('input', 'trip-list-visibility', row);
        visible.type = 'checkbox';
        visible.checked = trip.visible;
        visible.addEventListener('change', () => this.setTripVisibility(trip, visible.checked));
        const title = L.DomUtil.create('button', 'trip-list-trip-name', row);
        title.type = 'button';
        title.textContent = `${trip.expanded ? '▾' : '▸'} ${trip.name} (${trip.routes.length})`;
        title.addEventListener('click', () => {
            this._selectedTrip = trip;
            trip.expanded = !trip.expanded;
            this.persistState();
            this.render();
        });
        const rename = L.DomUtil.create('button', 'trip-list-action', row);
        rename.type = 'button';
        rename.textContent = '✎';
        rename.title = 'Rename trip';
        rename.addEventListener('click', () => this.renameTrip(trip));
        const remove = L.DomUtil.create('button', 'trip-list-action', row);
        remove.type = 'button';
        remove.textContent = '×';
        remove.title = 'Delete trip';
        remove.addEventListener('click', () => this.deleteTrip(trip));
        if (trip.expanded) {
            trip.routes.forEach((route) => this.renderRoute(trip, route, tripElement));
        }
    },

    renderRoute: function (trip, route, parentElement) {
        const row = L.DomUtil.create('div', 'trip-list-route', parentElement);
        row.addEventListener('contextmenu', (e) => this.showRouteMenu(e, trip, route));
        const visible = L.DomUtil.create('input', 'trip-list-visibility', row);
        visible.type = 'checkbox';
        visible.checked = route.visible;
        visible.addEventListener('change', () => this.setRouteVisibility(trip, route, visible.checked));
        const color = L.DomUtil.create('span', 'trip-list-color', row);
        color.style.backgroundColor = routeColor(route);
        color.title = 'Change route color';
        color.addEventListener('click', (e) => this.showRouteColorMenu(e, route));
        const title = L.DomUtil.create('button', 'trip-list-route-name', row);
        title.type = 'button';
        title.textContent = route.name;
        title.title = route.name;
        title.addEventListener('click', () => this.focusRoute(route));
        const details = L.DomUtil.create('span', 'trip-list-route-details', row);
        details.textContent = `${formatDuration(route.duration)} · ${formatDistance(route.distance)}`;
        const edit = L.DomUtil.create('button', 'trip-list-action', row);
        edit.type = 'button';
        edit.textContent = '✎';
        edit.title = 'Edit route';
        edit.addEventListener('click', () => this.editRoute(route));
        const remove = L.DomUtil.create('button', 'trip-list-action', row);
        remove.type = 'button';
        remove.textContent = '×';
        remove.title = 'Delete route';
        remove.addEventListener('click', () => this.deleteRoute(trip, route));
    },
});

export {TripList};
