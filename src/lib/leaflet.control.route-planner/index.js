import L from 'leaflet';

import config from '~/config';
import Contextmenu from '~/lib/contextmenu';
import {ElevationProfile, calcSamplingInterval} from '~/lib/leaflet.control.elevation-profile';
import {DEFAULT_ROUTE_COLOR, formatDistance, formatDuration} from '~/lib/route-planning/common';
import {createRoutingProvider} from '~/lib/routing';
import {createAbortController} from '~/lib/routing/abort';
import {PROFILES} from '~/lib/routing/profiles';
import './style.css';

const PROFILE_OPTIONS_HTML = PROFILES.map(({id, label}) => `<option value="${id}">${label}</option>`).join('');

// Very old browsers (for example Firefox 52) have no pointer events: the point list drag falls
// back to mouse events there.
const POINTER_EVENTS_SUPPORTED = typeof PointerEvent !== 'undefined';
const DRAG_START_EVENT = POINTER_EVENTS_SUPPORTED ? 'pointerdown' : 'mousedown';
const DRAG_MOVE_EVENT = POINTER_EVENTS_SUPPORTED ? 'pointermove' : 'mousemove';
const DRAG_END_EVENTS = POINTER_EVENTS_SUPPORTED ? ['pointerup', 'pointercancel'] : ['mouseup'];

function formatCoordinate(latlng) {
    return `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
}

const RoutePlanner = L.Control.extend({
    includes: L.Mixin.Events,

    options: {
        position: 'topleft',
    },

    initialize: function (options) {
        L.Control.prototype.initialize.call(this, options);
        this._provider = (options && options.provider) || null;
        this._profile = PROFILES[0].id;
        this._avoidTolls = false;
        this._avoidUnpaved = false;
        this._preferShortest = false;
        this._routeLayer = L.geoJSON(null, {
            style: {color: DEFAULT_ROUTE_COLOR, weight: 6, opacity: 0.9},
        });
        this._markers = L.layerGroup();
        this._viaPoints = [];
        this._viaLabels = [];
        this._route = null;
        this._projectedRoute = null;
        this._editingRouteId = null;
    },

    onAdd: function (map) {
        this._map = map;
        this._container = L.DomUtil.create('section', 'route-planner');
        this._container.innerHTML = `
            <header class="route-planner-header">
                <h2>Routes</h2>
                <button type="button" class="route-planner-close" aria-label="Close routes">×</button>
            </header>
            <div class="route-planner-points"></div>
            <label class="route-planner-mode">
                Mode
                <select class="route-planner-profile" aria-label="Mode of transportation">
                    ${PROFILE_OPTIONS_HTML}
                </select>
            </label>
            <div class="route-planner-avoid-options">
                <label><input type="checkbox" class="route-planner-avoid-tolls"/><span>Avoid toll roads</span></label>
                <label>
                    <input type="checkbox" class="route-planner-avoid-unpaved"/><span>Avoid unpaved roads</span>
                </label>
                <label>
                    <input type="checkbox" class="route-planner-prefer-shortest"/><span>Prefer shortest route</span>
                </label>
            </div>
            <div class="route-planner-actions">
                <button type="button" class="route-planner-swap" title="Swap start and destination">⇅ Swap</button>
                <button type="button" class="route-planner-clear">Clear</button>
                <button type="button" class="route-planner-save" disabled>Save route</button>
                <button type="button" class="route-planner-elevation" disabled>Show elevation profile</button>
            </div>
            <p class="route-planner-status">Right-click a point on the map to set the route.</p>
            <div class="route-planner-trips trip-list"></div>
        `;
        this._status = this._container.querySelector('.route-planner-status');
        this._pointsContainer = this._container.querySelector('.route-planner-points');
        this._tripsContainer = this._container.querySelector('.route-planner-trips');
        this._profileSelect = this._container.querySelector('.route-planner-profile');
        this._avoidTollsInput = this._container.querySelector('.route-planner-avoid-tolls');
        this._avoidUnpavedInput = this._container.querySelector('.route-planner-avoid-unpaved');
        this._preferShortestInput = this._container.querySelector('.route-planner-prefer-shortest');
        this._saveButton = this._container.querySelector('.route-planner-save');
        this._elevationButton = this._container.querySelector('.route-planner-elevation');
        this._container.querySelector('.route-planner-close').addEventListener('click', this.hide.bind(this));
        this._container.querySelector('.route-planner-clear').addEventListener('click', this.clear.bind(this));
        this._container.querySelector('.route-planner-swap').addEventListener('click', this.swap.bind(this));
        this._saveButton.addEventListener('click', this.saveRoute.bind(this));
        this._elevationButton.addEventListener('click', this.toggleElevationProfile.bind(this));
        this._profileSelect.addEventListener('change', this.onRoutingOptionsChange.bind(this));
        this._avoidTollsInput.addEventListener('change', this.onRoutingOptionsChange.bind(this));
        this._avoidUnpavedInput.addEventListener('change', this.onRoutingOptionsChange.bind(this));
        this._preferShortestInput.addEventListener('change', this.onRoutingOptionsChange.bind(this));
        this.updateAvoidOptions();

        L.DomEvent.disableClickPropagation(this._container);
        L.DomEvent.disableScrollPropagation(this._container);
        map.on('contextmenu', this.onMapContextMenu, this);
        map.on('click', this.onMapClick, this);
        map.on('routeplanner:setpoint', this.onRoutePlannerPointSelect, this);
        map.on('resize', this.updatePanelSize, this);
        this._routeLayer.on('mousedown', this.startViaPointDrag, this);
        map.addLayer(this._routeLayer);
        map.addLayer(this._markers);
        return this._container;
    },

    onRemove: function (map) {
        map.off('contextmenu', this.onMapContextMenu, this);
        map.off('click', this.onMapClick, this);
        map.off('routeplanner:setpoint', this.onRoutePlannerPointSelect, this);
        map.off('resize', this.updatePanelSize, this);
        this._routeLayer.off('mousedown', this.startViaPointDrag, this);
        this.stopViaPointDrag();
        this.stopPointListDrag();
        this.hideElevationProfile();
        map.removeLayer(this._routeLayer);
        map.removeLayer(this._markers);
    },

    getTripsContainer: function () {
        return this._tripsContainer;
    },

    getRoutingProvider: function () {
        if (!this._provider) {
            this._provider = createRoutingProvider(config.routing);
        }
        return this._provider;
    },

    onMapContextMenu: function (e) {
        const originalEvent = e.originalEvent;
        if (Contextmenu.isHandled(originalEvent)) {
            return;
        }
        Contextmenu.markHandled(originalEvent);
        new Contextmenu([
            {text: 'Route from', callback: () => this.setPoint('from', e.latlng)},
            {text: 'Route to', callback: () => this.setPoint('to', e.latlng)},
            {text: 'Route via', callback: () => this.addViaPoint(e.latlng)},
        ]).show(e);
    },

    onRoutePlannerPointSelect: function (e) {
        if (e.point === 'via') {
            this.addViaPoint(e.latlng, e.label);
        } else {
            this.setPoint(e.point, e.latlng, e.label);
        }
    },

    onRoutingOptionsChange: function () {
        this._profile = this._profileSelect.value;
        this._avoidTolls = this._avoidTollsInput.checked;
        this._avoidUnpaved = this._avoidUnpavedInput.checked;
        this._preferShortest = this._preferShortestInput.checked;
        this.updateAvoidOptions();
        if (this._from && this._to) {
            this.buildRoute();
        }
    },

    updateAvoidOptions: function () {
        const available = (this._profile === 'driving' || this._profile === 'motorcycle') && !this._preferShortest;
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
            this.discardRoute(point === 'from' ? 'Now choose a destination.' : 'Now choose a starting point.');
        }
    },

    discardRoute: function (message = null) {
        this._request?.abort();
        this._request = null;
        this.hideElevationProfile();
        this._routeLayer.clearLayers();
        this._route = null;
        this._projectedRoute = null;
        this.updateSaveButton();
        if (message) {
            this._status.textContent = message;
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
        this._pointsContainer.innerHTML = '';
        this.renderPointRow({kind: 'from', icon: 'A', latlng: this._from, label: this._fromLabel});
        this._viaPoints.forEach((latlng, index) => {
            this.renderPointRow({
                kind: 'via',
                index,
                icon: String(index + 1),
                latlng,
                label: this._viaLabels[index],
            });
        });
        this.renderPointRow({kind: 'to', icon: 'B', latlng: this._to, label: this._toLabel});
    },

    renderPointRow: function ({kind, index, icon, latlng, label}) {
        const row = L.DomUtil.create('div', `route-planner-point route-planner-point-${kind}`, this._pointsContainer);
        row.dataset.pointKind = kind;
        row.addEventListener(DRAG_START_EVENT, this.startPointListDrag.bind(this, row));
        const iconElement = L.DomUtil.create('span', 'route-planner-point-icon', row);
        iconElement.textContent = icon;
        const labelElement = L.DomUtil.create('span', 'route-planner-point-label', row);
        if (latlng) {
            labelElement.textContent = label || formatCoordinate(latlng);
        } else {
            row.classList.add('empty');
            labelElement.textContent = kind === 'from' ? 'Choose a starting point' : 'Choose a destination';
        }
        if (!latlng) {
            return;
        }
        const dragHandle = L.DomUtil.create('span', 'route-planner-drag-handle', row);
        dragHandle.textContent = '⋮';
        dragHandle.title = 'Drag to reorder';
        const removeButton = L.DomUtil.create('button', 'route-planner-point-remove', row);
        removeButton.type = 'button';
        removeButton.title = 'Remove point';
        removeButton.textContent = '×';
        removeButton.addEventListener('click', () => this.removePoint(kind, index));
    },

    startPointListDrag: function (row, e) {
        if (e.button !== 0 || e.target.closest('button')) {
            return;
        }
        e.preventDefault();
        this._pointListDrag = {row, startY: e.clientY};
        this._onPointListDrag = this._onPointListDrag || this.dragPointList.bind(this);
        this._onPointListDrop = this._onPointListDrop || this.finishPointListDrag.bind(this);
        document.addEventListener(DRAG_MOVE_EVENT, this._onPointListDrag);
        for (const eventName of DRAG_END_EVENTS) {
            document.addEventListener(eventName, this._onPointListDrop);
        }
    },

    dragPointList: function (e) {
        const drag = this._pointListDrag;
        if (!drag || Math.abs(e.clientY - drag.startY) <= 3) {
            return;
        }
        drag.dragged = true;
        drag.row.classList.add('dragging');
        if (!this._from || !this._to) {
            return;
        }
        const element = document.elementFromPoint(e.clientX, e.clientY);
        const target = element && element.closest('.route-planner-point');
        const validTarget =
            target && target !== drag.row && target.parentElement === this._pointsContainer ? target : null;
        drag.target = validTarget;
        for (const child of this._pointsContainer.children) {
            child.classList.toggle('drag-target', child === validTarget);
        }
    },

    finishPointListDrag: function (e) {
        const drag = this._pointListDrag;
        if (!drag) {
            return;
        }
        const {row, dragged, target} = drag;
        const kind = row.dataset.pointKind;
        this.stopPointListDrag();
        if (e.type === 'pointercancel') {
            return;
        }
        if (!dragged) {
            if (kind === 'from' || kind === 'to') {
                this.pickPoint(kind);
            }
            return;
        }
        if (!target || !this._from || !this._to) {
            return;
        }
        const fromIndex = Array.prototype.indexOf.call(this._pointsContainer.children, row);
        const targetIndex = Array.prototype.indexOf.call(this._pointsContainer.children, target);
        const insertAfter = e.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
        let toIndex = targetIndex + (insertAfter ? 1 : 0);
        if (fromIndex < toIndex) {
            toIndex -= 1;
        }
        this.reorderPoint(fromIndex, toIndex);
    },

    stopPointListDrag: function () {
        const drag = this._pointListDrag;
        this._pointListDrag = null;
        if (drag) {
            drag.row.classList.remove('dragging');
        }
        for (const child of this._pointsContainer.children) {
            child.classList.remove('drag-target');
        }
        document.removeEventListener(DRAG_MOVE_EVENT, this._onPointListDrag);
        for (const eventName of DRAG_END_EVENTS) {
            document.removeEventListener(eventName, this._onPointListDrop);
        }
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
        this.updatePoints();
        this.buildRoute();
    },

    addViaPoint: function (latlng, label = null) {
        if (!this._from || !this._to) {
            this.show();
            this._status.textContent = 'Choose a starting point and destination first.';
            return;
        }
        this._viaPoints.push(L.latLng(latlng));
        this._viaLabels.push(label);
        this.updatePoints();
        this.updateMarkers();
        this.buildRoute();
    },

    getOrderedPoints: function () {
        const points = [];
        if (this._from) {
            points.push({latlng: this._from, label: this._fromLabel});
        }
        this._viaPoints.forEach((latlng, index) => {
            points.push({latlng, label: this._viaLabels[index]});
        });
        if (this._to) {
            points.push({latlng: this._to, label: this._toLabel});
        }
        return points;
    },

    reorderPoint: function (fromIndex, toIndex) {
        if (fromIndex === toIndex) {
            return;
        }
        const points = this.getOrderedPoints();
        const [moved] = points.splice(fromIndex, 1);
        points.splice(toIndex, 0, moved);
        this._from = L.latLng(points[0].latlng);
        this._fromLabel = points[0].label || null;
        this._to = L.latLng(points[points.length - 1].latlng);
        this._toLabel = points[points.length - 1].label || null;
        const viaPoints = points.slice(1, -1);
        this._viaPoints = viaPoints.map((point) => L.latLng(point.latlng));
        this._viaLabels = viaPoints.map((point) => point.label || null);
        this.updatePoints();
        this.updateMarkers();
        this.buildRoute();
    },

    removePoint: function (kind, index) {
        if (kind === 'from') {
            this._from = null;
            this._fromLabel = null;
        } else if (kind === 'to') {
            this._to = null;
            this._toLabel = null;
        } else {
            this._viaPoints.splice(index, 1);
            this._viaLabels.splice(index, 1);
        }
        this.updatePoints();
        this.updateMarkers();
        if (this._from && this._to) {
            this.buildRoute();
        } else {
            this.discardRoute(kind === 'from' ? 'Now choose a starting point.' : 'Now choose a destination.');
        }
    },

    removeViaPoint: function (index, e) {
        L.DomEvent.stopPropagation(e.originalEvent);
        this.removePoint('via', index);
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
        this._viaLabels.splice(index, 0, null);
        this.updateMarkers();
        this.updatePoints();
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

    getProjectedRoute: function () {
        if (!this._route) {
            return null;
        }
        if (this._projectedRoute && this._projectedRoute.route === this._route) {
            return this._projectedRoute.points;
        }
        const points = this._route.geometry.coordinates.map(([lng, lat]) => this._map.project([lat, lng], 18));
        this._projectedRoute = {route: this._route, points};
        return points;
    },

    getRoutePosition: function (latlng) {
        const points = this.getProjectedRoute();
        if (!points || points.length < 2) {
            return null;
        }
        const point = this._map.project(latlng, 18);
        let distanceAlongRoute = 0;
        let closestDistance = Infinity;
        let closestPosition = null;
        for (let index = 1; index < points.length; index += 1) {
            const start = points[index - 1];
            const end = points[index];
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
            preferShortest: this._preferShortest,
        };
    },

    buildRoute: async function () {
        this.hideElevationProfile();
        this._routeLayer.clearLayers();
        this._route = null;
        this._projectedRoute = null;
        this.updateSaveButton();
        this._status.textContent = 'Building route…';
        this._request?.abort();
        const request = createAbortController();
        this._request = request;
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
                signal: request.signal,
            });
            if (this._request !== request) {
                return;
            }
            this._route = route;
            route.viaPositions = this.computeViaPositions();
            this._routeLayer.addData({type: 'Feature', geometry: route.geometry});
            this.updateSaveButton();
            this._status.textContent = `${formatDuration(route.duration)} · ${formatDistance(route.distance)}`;
            this._map.fitBounds(this._routeLayer.getBounds(), {padding: [40, 40], maxZoom: 15});
        } catch (error) {
            if (error.name !== 'AbortError' && this._request === request) {
                this._status.textContent = `Could not build a route: ${error.message}`;
            }
        }
    },

    computeViaPositions: function () {
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
                    label: this._viaLabels[index] || null,
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
        this._viaLabels = (route.viaPoints || []).map((point) => point.label || null);
        this._profile = route.profile;
        this._avoidTolls = Boolean(options.avoidTolls);
        this._avoidUnpaved = Boolean(options.avoidUnpaved);
        this._preferShortest = Boolean(options.preferShortest);
        this._profileSelect.value = this._profile;
        this._avoidTollsInput.checked = this._avoidTolls;
        this._avoidUnpavedInput.checked = this._avoidUnpaved;
        this._preferShortestInput.checked = this._preferShortest;
        this.updateAvoidOptions();
        this.updatePoints();
        this.updateMarkers();
        this.show();
        this.buildRoute();
    },

    clear: function () {
        this.discardRoute();
        if (this._editingRouteId) {
            this.fire('editcancelled', {routeId: this._editingRouteId});
        }
        this._from = null;
        this._to = null;
        this._fromLabel = null;
        this._toLabel = null;
        this._viaPoints = [];
        this._viaLabels = [];
        this.setRouteColor(DEFAULT_ROUTE_COLOR);
        this._editingRouteId = null;
        this._pickingPoint = null;
        this._map.getContainer().classList.remove('route-planner-picking');
        this._markers.clearLayers();
        this.updatePoints();
        this.updateSaveButton();
        this._status.textContent = 'Right-click a point on the map to set the route.';
    },

    isVisible: function () {
        return Boolean(this._container && L.DomUtil.hasClass(this._container, 'visible'));
    },

    updatePanelSize: function () {
        if (!this.isVisible()) {
            return;
        }
        const available = this._map.getSize().y - this._container.offsetTop - 10;
        this._container.style.maxHeight = `${Math.max(120, available)}px`;
    },

    toggle: function () {
        if (this.isVisible()) {
            this.hide();
        } else {
            this.show();
        }
    },

    show: function () {
        L.DomUtil.addClass(this._container, 'visible');
        this.updatePanelSize();
        this.fire('visibilitychange', {visible: true});
    },

    hide: function () {
        this.clear();
        L.DomUtil.removeClass(this._container, 'visible');
        this.fire('visibilitychange', {visible: false});
    },
});

export {RoutePlanner};
