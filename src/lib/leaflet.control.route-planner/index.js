import L from 'leaflet';

import config from '~/config';
import Contextmenu from '~/lib/contextmenu';
import {ElevationProfile, calcSamplingInterval} from '~/lib/leaflet.control.elevation-profile';
import {createRoutingProvider} from '~/lib/routing';
import './style.css';

const DEFAULT_ROUTE_COLOR = '#1a73e8';

function formatCoordinate(latlng) {
    return `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
}

function formatDistance(meters) {
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`;
    }
    return `${Math.round(meters)} m`;
}

function formatDuration(seconds) {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `${minutes} min`;
    }
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const RoutePlanner = L.Control.extend({
    includes: L.Mixin.Events,

    options: {
        position: 'topleft',
    },

    initialize: function (options) {
        L.Control.prototype.initialize.call(this, options);
        this._provider = (options && options.provider) || null;
        this._profile = 'driving';
        this._avoidTolls = false;
        this._avoidUnpaved = false;
        this._routeLayer = L.geoJSON(null, {
            style: {color: DEFAULT_ROUTE_COLOR, weight: 6, opacity: 0.9},
        });
        this._markers = L.layerGroup();
        this._viaPoints = [];
        this._viaPointDetails = [];
        this._route = null;
        this._editingRouteId = null;
    },

    onAdd: function (map) {
        this._map = map;
        this._container = L.DomUtil.create('section', 'route-planner');
        this._container.innerHTML = `
            <header class="route-planner-header">
                <h2>Directions</h2>
                <button type="button" class="route-planner-close" aria-label="Close directions">×</button>
            </header>
            <div class="route-planner-points">
                <div class="route-planner-point route-planner-point-from">
                    <span class="route-planner-point-icon">A</span>
                    <button type="button" class="route-planner-place" data-point="from">Choose a starting point</button>
                </div>
                <div class="route-planner-via-points"></div>
                <div class="route-planner-point route-planner-point-to">
                    <span class="route-planner-point-icon">B</span>
                    <button type="button" class="route-planner-place" data-point="to">Choose a destination</button>
                </div>
            </div>
            <label class="route-planner-mode">
                Mode
                <select class="route-planner-profile" aria-label="Mode of transportation">
                    <option value="driving">Car</option>
                    <option value="cycling">Bike</option>
                    <option value="motorcycle">Motorcycle</option>
                    <option value="walking">Foot</option>
                </select>
            </label>
            <div class="route-planner-avoid-options">
                <label><input type="checkbox" class="route-planner-avoid-tolls"/><span>Avoid toll roads</span></label>
                <label>
                    <input type="checkbox" class="route-planner-avoid-unpaved"/><span>Avoid unpaved roads</span>
                </label>
            </div>
            <div class="route-planner-actions">
                <button type="button" class="route-planner-swap" title="Swap start and destination">⇅ Swap</button>
                <button type="button" class="route-planner-clear">Clear</button>
                <button type="button" class="route-planner-save" disabled>Save route</button>
                <button type="button" class="route-planner-elevation" disabled>Show elevation profile</button>
            </div>
            <p class="route-planner-status">Right-click a point on the map to set the route.</p>
        `;
        this._status = this._container.querySelector('.route-planner-status');
        this._fromButton = this._container.querySelector('[data-point="from"]');
        this._toButton = this._container.querySelector('[data-point="to"]');
        this._viaPointsContainer = this._container.querySelector('.route-planner-via-points');
        this._profileSelect = this._container.querySelector('.route-planner-profile');
        this._avoidTollsInput = this._container.querySelector('.route-planner-avoid-tolls');
        this._avoidUnpavedInput = this._container.querySelector('.route-planner-avoid-unpaved');
        this._saveButton = this._container.querySelector('.route-planner-save');
        this._elevationButton = this._container.querySelector('.route-planner-elevation');
        this._container.querySelector('.route-planner-close').addEventListener('click', this.hide.bind(this));
        this._container.querySelector('.route-planner-clear').addEventListener('click', this.clear.bind(this));
        this._container.querySelector('.route-planner-swap').addEventListener('click', this.swap.bind(this));
        this._saveButton.addEventListener('click', this.saveRoute.bind(this));
        this._elevationButton.addEventListener('click', this.toggleElevationProfile.bind(this));
        this._fromButton.addEventListener('click', this.pickPoint.bind(this, 'from'));
        this._toButton.addEventListener('click', this.pickPoint.bind(this, 'to'));
        this._profileSelect.addEventListener('change', this.onRoutingOptionsChange.bind(this));
        this._avoidTollsInput.addEventListener('change', this.onRoutingOptionsChange.bind(this));
        this._avoidUnpavedInput.addEventListener('change', this.onRoutingOptionsChange.bind(this));
        this.updateAvoidOptions();

        L.DomEvent.disableClickPropagation(this._container);
        L.DomEvent.disableScrollPropagation(this._container);
        map.on('contextmenu', this.onMapContextMenu, this);
        map.on('click', this.onMapClick, this);
        map.on('routeplanner:setpoint', this.onRoutePlannerPointSelect, this);
        this._routeLayer.on('mousedown', this.startViaPointDrag, this);
        map.addLayer(this._routeLayer);
        map.addLayer(this._markers);
        return this._container;
    },

    onRemove: function (map) {
        map.off('contextmenu', this.onMapContextMenu, this);
        map.off('click', this.onMapClick, this);
        map.off('routeplanner:setpoint', this.onRoutePlannerPointSelect, this);
        this._routeLayer.off('mousedown', this.startViaPointDrag, this);
        this.stopViaPointDrag();
        this.stopViaPointListDrag();
        this.hideElevationProfile();
        map.removeLayer(this._routeLayer);
        map.removeLayer(this._markers);
    },

    getRoutingProvider: function () {
        if (!this._provider) {
            this._provider = createRoutingProvider(config.routing);
        }
        return this._provider;
    },

    onMapContextMenu: function (e) {
        const originalEvent = e.originalEvent;
        setTimeout(() => {
            if (originalEvent._routePlannerHandled) {
                return;
            }
            originalEvent._routePlannerHandled = true;
            new Contextmenu([
                {text: 'Route from', callback: () => this.setPoint('from', e.latlng)},
                {text: 'Route to', callback: () => this.setPoint('to', e.latlng)},
                {text: 'Route via', callback: () => this.addViaPoint(e.latlng)},
            ]).show(e);
        }, 0);
    },

    onRoutePlannerPointSelect: function (e) {
        if (e.point === 'via') {
            this.addViaPoint(e.latlng, e.label, e.iconUrl, e.iconScale);
        } else {
            this.setPoint(e.point, e.latlng, e.label);
        }
    },

    onRoutingOptionsChange: function () {
        this._profile = this._profileSelect.value;
        this._avoidTolls = this._avoidTollsInput.checked;
        this._avoidUnpaved = this._avoidUnpavedInput.checked;
        this.updateAvoidOptions();
        if (this._from && this._to) {
            this.buildRoute();
        }
    },

    updateAvoidOptions: function () {
        const available = this._profile === 'driving' || this._profile === 'motorcycle';
        this._avoidTollsInput.disabled = !available;
        this._avoidUnpavedInput.disabled = !available;
    },

    pickPoint: function (point) {
        this.show();
        this._pickingPoint = point;
        this._status.textContent = `Click the map to choose the ${
            point === 'from' ? 'starting point' : 'destination'
        }.`;
        this._map.getContainer().classList.add('route-planner-picking');
    },

    onMapClick: function (e) {
        if (this._pickingPoint) {
            this.setPoint(this._pickingPoint, e.latlng);
        }
    },

    setPoint: function (point, latlng, label = null) {
        this._pickingPoint = null;
        this._map.getContainer().classList.remove('route-planner-picking');
        this[`_${point}`] = L.latLng(latlng);
        this[`_${point}Label`] = label;
        this.show();
        this.updatePoints();
        this.updateMarkers();
        if (this._from && this._to) {
            this.buildRoute();
        } else {
            this._routeLayer.clearLayers();
            this._route = null;
            this.updateSaveButton();
            this._status.textContent = point === 'from' ? 'Now choose a destination.' : 'Now choose a starting point.';
        }
    },

    updateSaveButton: function () {
        this._saveButton.disabled = !this._route;
        this._saveButton.textContent = this._editingRouteId ? 'Update route' : 'Save route';
        this._elevationButton.disabled = !this._route;
        this._elevationButton.textContent = this._elevationControl
            ? 'Hide elevation profile'
            : 'Show elevation profile';
    },

    toggleElevationProfile: function () {
        if (this._elevationControl) {
            this.hideElevationProfile();
        } else {
            this.showElevationProfile();
        }
    },

    showElevationProfile: function () {
        if (!this._route) {
            return;
        }
        this.hideElevationProfile();
        const path = this._route.geometry.coordinates.map(([lng, lat]) => L.latLng(lat, lng));
        const pathLength = path.slice(1).reduce((total, point, index) => total + point.distanceTo(path[index]), 0);
        const elevationControl = new ElevationProfile(this._map, path, {
            samplingInterval: calcSamplingInterval(pathLength),
        });
        this._elevationControl = elevationControl;
        elevationControl.once('remove', () => {
            if (this._elevationControl === elevationControl) {
                this._elevationControl = null;
                this.updateSaveButton();
            }
        });
        this.updateSaveButton();
        this.fire('elevation-shown');
    },

    hideElevationProfile: function () {
        if (this._elevationControl) {
            this._elevationControl.removeFrom(this._map);
        }
        this._elevationControl = null;
        this.updateSaveButton();
    },

    setRouteColor: function (color) {
        this._routeLayer.options.style.color = color;
        this._routeLayer.setStyle({color});
    },

    updatePoints: function () {
        this._fromButton.textContent = this._from
            ? this._fromLabel || formatCoordinate(this._from)
            : 'Choose a starting point';
        this._toButton.textContent = this._to ? this._toLabel || formatCoordinate(this._to) : 'Choose a destination';
        this.updateViaPoints();
    },

    updateViaPoints: function () {
        this._viaPointsContainer.innerHTML = '';
        this._viaPoints.forEach((point, index) => {
            const details = this._viaPointDetails[index];
            const row = L.DomUtil.create(
                'div',
                'route-planner-point route-planner-point-via',
                this._viaPointsContainer
            );
            row.addEventListener('pointerdown', this.startViaPointListDrag.bind(this, index));
            const icon = L.DomUtil.create('span', 'route-planner-point-icon', row);
            if (details && details.iconUrl) {
                icon.classList.add('route-planner-point-icon-image');
                const image = L.DomUtil.create('img', '', icon);
                image.src = details.iconUrl;
                image.alt = '';
            } else {
                icon.textContent = index + 1;
            }
            const label = L.DomUtil.create('span', 'route-planner-via-label', row);
            label.textContent = (details && details.label) || formatCoordinate(point);
            const dragHandle = L.DomUtil.create('span', 'route-planner-drag-handle', row);
            dragHandle.textContent = '↕';
        });
    },

    startViaPointListDrag: function (index, e) {
        if (e.button !== 0) {
            return;
        }
        e.preventDefault();
        this._viaPointListDrag = {index, startY: e.clientY};
        this._onViaPointListDrag = this._onViaPointListDrag || this.dragViaPointList.bind(this);
        this._onViaPointListDrop = this._onViaPointListDrop || this.finishViaPointListDrag.bind(this);
        document.addEventListener('pointermove', this._onViaPointListDrag);
        document.addEventListener('pointerup', this._onViaPointListDrop);
        document.addEventListener('pointercancel', this._onViaPointListDrop);
    },

    dragViaPointList: function (e) {
        if (!this._viaPointListDrag || Math.abs(e.clientY - this._viaPointListDrag.startY) <= 3) {
            return;
        }
        const row = document.elementFromPoint(e.clientX, e.clientY);
        const target = row && row.closest('.route-planner-point-via');
        if (target && target.parentElement === this._viaPointsContainer) {
            this._viaPointListDrag.target = target;
        }
    },

    finishViaPointListDrag: function (e) {
        if (!this._viaPointListDrag) {
            return;
        }
        const {index, target} = this._viaPointListDrag;
        this.stopViaPointListDrag();
        if (!target) {
            return;
        }
        const targetIndex = Array.prototype.indexOf.call(this._viaPointsContainer.children, target);
        const insertAfter = e.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
        let newIndex = targetIndex + (insertAfter ? 1 : 0);
        if (index < newIndex) {
            newIndex -= 1;
        }
        this.reorderViaPoint(index, newIndex);
    },

    stopViaPointListDrag: function () {
        this._viaPointListDrag = null;
        document.removeEventListener('pointermove', this._onViaPointListDrag);
        document.removeEventListener('pointerup', this._onViaPointListDrop);
        document.removeEventListener('pointercancel', this._onViaPointListDrop);
    },

    updateMarkers: function () {
        this._markers.clearLayers();
        for (const [point, label] of [
            ['from', 'A'],
            ['to', 'B'],
        ]) {
            if (this[`_${point}`]) {
                const marker = L.marker(this[`_${point}`], {
                    draggable: true,
                    icon: L.divIcon({
                        className: `route-planner-marker route-planner-marker-${point}`,
                        html: label,
                        iconSize: [28, 28],
                        iconAnchor: [14, 14],
                    }),
                });
                marker.on('dragend', () => this.moveEndpoint(point, marker.getLatLng()));
                this._markers.addLayer(marker);
            }
        }
        this._viaPoints.forEach((latlng, index) => {
            const marker = L.marker(latlng, {
                draggable: true,
                icon: L.divIcon({
                    className: 'route-planner-marker route-planner-marker-via',
                    html: index + 1,
                    iconSize: [22, 22],
                    iconAnchor: [11, 11],
                }),
            });
            marker.on('dragend', () => this.moveViaPoint(index, marker.getLatLng()));
            marker.on('dblclick', (e) => this.removeViaPoint(index, e));
            this._markers.addLayer(marker);
        });
    },

    moveEndpoint: function (point, latlng) {
        this[`_${point}`] = L.latLng(latlng);
        this[`_${point}Label`] = null;
        this.updatePoints();
        this.buildRoute();
    },

    moveViaPoint: function (index, latlng) {
        this._viaPoints[index] = L.latLng(latlng);
        this.updateViaPoints();
        this.buildRoute();
    },

    addViaPoint: function (latlng, label = null, iconUrl = null, iconScale = null) {
        if (!this._from || !this._to) {
            this.show();
            this._status.textContent = 'Choose a starting point and destination first.';
            return;
        }
        this._viaPoints.push(L.latLng(latlng));
        this._viaPointDetails.push({label, iconUrl, iconScale});
        this.updateViaPoints();
        this.updateMarkers();
        this.buildRoute();
    },

    reorderViaPoint: function (fromIndex, toIndex) {
        if (fromIndex === toIndex) {
            return;
        }
        const [point] = this._viaPoints.splice(fromIndex, 1);
        const [details] = this._viaPointDetails.splice(fromIndex, 1);
        this._viaPoints.splice(toIndex, 0, point);
        this._viaPointDetails.splice(toIndex, 0, details);
        this.updatePoints();
        this.updateMarkers();
        this.buildRoute();
    },

    removeViaPoint: function (index, e) {
        L.DomEvent.stopPropagation(e.originalEvent);
        this._viaPoints.splice(index, 1);
        this._viaPointDetails.splice(index, 1);
        this.updateMarkers();
        this.updateViaPoints();
        this.buildRoute();
    },

    startViaPointDrag: function (e) {
        if (!this._from || !this._to || this._viaPointDrag) {
            return;
        }
        L.DomEvent.stopPropagation(e.originalEvent);
        this._viaPointDrag = {
            dragged: false,
            startPoint: e.containerPoint,
            mapDraggingEnabled: this._map.dragging.enabled(),
            marker: L.marker(e.latlng, {
                icon: L.divIcon({
                    className: 'route-planner-marker route-planner-marker-via',
                    html: this._viaPoints.length + 1,
                    iconSize: [22, 22],
                    iconAnchor: [11, 11],
                }),
            }).addTo(this._markers),
        };
        this._map.dragging.disable();
        this._map.on('mousemove', this.dragViaPoint, this);
        this._map.once('mouseup', this.finishViaPointDrag, this);
    },

    dragViaPoint: function (e) {
        if (!this._viaPointDrag) {
            return;
        }
        if (this._viaPointDrag.startPoint.distanceTo(e.containerPoint) > 3) {
            this._viaPointDrag.dragged = true;
        }
        this._viaPointDrag.marker.setLatLng(e.latlng);
    },

    finishViaPointDrag: function (e) {
        if (!this._viaPointDrag) {
            return;
        }
        const {dragged} = this._viaPointDrag;
        const latlng = e.latlng || this._viaPointDrag.marker.getLatLng();
        this.stopViaPointDrag();
        if (!dragged) {
            return;
        }
        const index = this.getViaPointInsertIndex(latlng);
        this._viaPoints.splice(index, 0, L.latLng(latlng));
        this._viaPointDetails.splice(index, 0, null);
        this.updateMarkers();
        this.updateViaPoints();
        this.buildRoute();
    },

    getViaPointInsertIndex: function (latlng) {
        const position = this.getRoutePosition(latlng);
        if (position === null) {
            return this._viaPoints.length;
        }
        const positions = (this._route && this._route.viaPositions) || [];
        const nextIndex = positions.findIndex((viaPosition) => viaPosition > position);
        return nextIndex === -1 ? this._viaPoints.length : nextIndex;
    },

    getRoutePosition: function (latlng) {
        const coordinates = this._route && this._route.geometry.coordinates;
        if (!coordinates || !coordinates.length) {
            return null;
        }
        const point = this._map.project(latlng, 18);
        let distanceAlongRoute = 0;
        let closestDistance = Infinity;
        let closestPosition = null;
        for (let index = 1; index < coordinates.length; index += 1) {
            const start = this._map.project([coordinates[index - 1][1], coordinates[index - 1][0]], 18);
            const end = this._map.project([coordinates[index][1], coordinates[index][0]], 18);
            const segment = end.subtract(start);
            const segmentLength = start.distanceTo(end);
            const segmentLengthSquared = segment.x ** 2 + segment.y ** 2;
            const projection = point.subtract(start);
            const factor = segmentLengthSquared
                ? Math.max(0, Math.min(1, (projection.x * segment.x + projection.y * segment.y) / segmentLengthSquared))
                : 0;
            const closestPoint = start.add(segment.multiplyBy(factor));
            const distance = point.distanceTo(closestPoint);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestPosition = distanceAlongRoute + factor * segmentLength;
            }
            distanceAlongRoute += segmentLength;
        }
        return closestPosition;
    },

    stopViaPointDrag: function () {
        if (!this._viaPointDrag) {
            return;
        }
        const {marker, mapDraggingEnabled} = this._viaPointDrag;
        this._markers.removeLayer(marker);
        this._viaPointDrag = null;
        this._map.off('mousemove', this.dragViaPoint, this);
        this._map.off('mouseup', this.finishViaPointDrag, this);
        if (mapDraggingEnabled) {
            this._map.dragging.enable();
        }
    },

    getRoutingOptions: function () {
        return {
            avoidTolls: this._avoidTolls,
            avoidUnpaved: this._avoidUnpaved,
        };
    },

    isRouteStale: function ({from, to, viaPoints, profile}) {
        return (
            this._from !== from ||
            this._to !== to ||
            this._profile !== profile ||
            this._viaPoints.length !== viaPoints.length ||
            this._viaPoints.some((point, index) => point !== viaPoints[index])
        );
    },

    buildRoute: async function () {
        this.hideElevationProfile();
        this._routeLayer.clearLayers();
        this._route = null;
        this.updateSaveButton();
        this._status.textContent = 'Building route…';
        this._request?.abort();
        this._request = new AbortController();
        const from = this._from;
        const to = this._to;
        const viaPoints = this._viaPoints.slice();
        const profile = this._profile;
        const options = this.getRoutingOptions();
        try {
            const route = await this.getRoutingProvider().route({
                points: [from, ...viaPoints, to],
                profile,
                options,
                signal: this._request.signal,
            });
            if (this.isRouteStale({from, to, viaPoints, profile})) {
                return;
            }
            route.viaPositions = this.computeViaPositions(route.geometry.coordinates);
            this._routeLayer.addData({type: 'Feature', geometry: route.geometry});
            this._route = route;
            this.updateSaveButton();
            this._status.textContent = `${formatDuration(route.duration)} · ${formatDistance(route.distance)}`;
            this._map.fitBounds(this._routeLayer.getBounds(), {padding: [40, 40], maxZoom: 15});
        } catch (error) {
            if (error.name !== 'AbortError' && !this.isRouteStale({from, to, viaPoints, profile})) {
                this._status.textContent = `Could not build a route: ${error.message}`;
            }
        }
    },

    computeViaPositions: function (coordinates) {
        if (!coordinates.length) {
            return [];
        }
        return this._viaPoints.map((point) => this.getRoutePosition(point)).filter((position) => position !== null);
    },

    swap: function () {
        if (!this._from && !this._to) {
            return;
        }
        [this._from, this._to] = [this._to, this._from];
        [this._fromLabel, this._toLabel] = [this._toLabel, this._fromLabel];
        this.updatePoints();
        this.updateMarkers();
        if (this._from && this._to) {
            this.buildRoute();
        }
    },

    saveRoute: function () {
        if (!this._route || !this._from || !this._to) {
            return;
        }
        this.fire('save', {
            route: {
                id: this._editingRouteId,
                from: {lat: this._from.lat, lng: this._from.lng, label: this._fromLabel},
                to: {lat: this._to.lat, lng: this._to.lng, label: this._toLabel},
                viaPoints: this._viaPoints.map((point, index) => ({
                    lat: point.lat,
                    lng: point.lng,
                    ...(this._viaPointDetails[index] || {}),
                })),
                profile: this._profile,
                options: this.getRoutingOptions(),
                geometry: this._route.geometry,
                duration: this._route.duration,
                distance: this._route.distance,
            },
        });
    },

    markRouteSaved: function (route) {
        this._editingRouteId = route.id;
        this._routeLayer.clearLayers();
        this.updateSaveButton();
        this._status.textContent = 'Route saved.';
    },

    discardSavedRoute: function (routeId) {
        if (this._editingRouteId === routeId) {
            this._editingRouteId = null;
            this.updateSaveButton();
        }
    },

    editRoute: function (route) {
        if (this._editingRouteId && this._editingRouteId !== route.id) {
            this.fire('editcancelled', {routeId: this._editingRouteId});
        }
        const options = route.options || {};
        this._editingRouteId = route.id;
        this.setRouteColor(route.color || DEFAULT_ROUTE_COLOR);
        this._from = L.latLng(route.from);
        this._to = L.latLng(route.to);
        this._fromLabel = route.from.label;
        this._toLabel = route.to.label;
        this._viaPoints = (route.viaPoints || []).map((point) => L.latLng(point));
        this._viaPointDetails = (route.viaPoints || []).map(({label, iconUrl, iconScale}) => ({
            label,
            iconUrl,
            iconScale,
        }));
        this._profile = route.profile;
        this._avoidTolls = Boolean(options.avoidTolls);
        this._avoidUnpaved = Boolean(options.avoidUnpaved);
        this._profileSelect.value = this._profile;
        this._avoidTollsInput.checked = this._avoidTolls;
        this._avoidUnpavedInput.checked = this._avoidUnpaved;
        this.updateAvoidOptions();
        this.updatePoints();
        this.updateMarkers();
        this.show();
        this.buildRoute();
    },

    clear: function () {
        this._request?.abort();
        this.hideElevationProfile();
        if (this._editingRouteId) {
            this.fire('editcancelled', {routeId: this._editingRouteId});
        }
        this._from = null;
        this._to = null;
        this._fromLabel = null;
        this._toLabel = null;
        this._viaPoints = [];
        this._viaPointDetails = [];
        this.setRouteColor(DEFAULT_ROUTE_COLOR);
        this._route = null;
        this._editingRouteId = null;
        this._pickingPoint = null;
        this._map.getContainer().classList.remove('route-planner-picking');
        this._routeLayer.clearLayers();
        this._markers.clearLayers();
        this.updatePoints();
        this.updateSaveButton();
        this._status.textContent = 'Right-click a point on the map to set the route.';
    },

    show: function () {
        L.DomUtil.addClass(this._container, 'visible');
    },

    hide: function () {
        this.clear();
        L.DomUtil.removeClass(this._container, 'visible');
    },
});

export {RoutePlanner};
