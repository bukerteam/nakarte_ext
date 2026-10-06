import L from 'leaflet';

import {makeButton} from '~/lib/leaflet.control.commons';
import {RoutePlanner} from '~/lib/leaflet.control.route-planner';
import {TripList} from '~/lib/leaflet.control.trip-list';

const RoutesButton = L.Control.extend({
    options: {
        position: 'topleft',
    },

    initialize: function (routePlanner) {
        L.Control.prototype.initialize.call(this);
        this._routePlanner = routePlanner;
    },

    onAdd: function () {
        const {container} = makeButton('', 'Routes', 'icon-tracks');
        this._container = container;
        L.DomEvent.on(container, 'click', this.onClick, this);
        this._routePlanner.on('visibilitychange', this.onVisibilityChange, this);
        this.onVisibilityChange();
        return container;
    },

    onRemove: function () {
        L.DomEvent.off(this._container, 'click', this.onClick, this);
        this._routePlanner.off('visibilitychange', this.onVisibilityChange, this);
    },

    onClick: function () {
        this._routePlanner.toggle();
    },

    onVisibilityChange: function () {
        const method = this._routePlanner.isVisible() ? 'addClass' : 'removeClass';
        L.DomUtil[method](this._container, 'active');
        L.DomUtil[method](this._container, 'highlight');
    },
});

// Wires the routes panel (directions + saved trips) to the map and the track list.
// Saved routes are converted into tracks through the existing track list.
function enableRoutePlanning(map, tracklist) {
    const routePlanner = new RoutePlanner({position: 'topleft'});
    new RoutesButton(routePlanner).addTo(map);
    routePlanner.addTo(map);
    const tripList = new TripList();
    tripList.attach(map, routePlanner.getTripsContainer());
    routePlanner.on('save', (e) => routePlanner.markRouteSaved(tripList.saveRoute(e.route)));
    tripList.on('editroute', (e) => routePlanner.editRoute(e.route));
    routePlanner.on('editcancelled', (e) => tripList.cancelRouteEditing(e.routeId));
    tripList.on('routedeleted', (e) => routePlanner.discardSavedRoute(e.routeId));
    tripList.on('converttotrack', (e) => {
        const track = e.route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        tracklist.addTrack({name: e.route.name, tracks: [track]});
    });
    return {routePlanner, tripList};
}

export {enableRoutePlanning};
