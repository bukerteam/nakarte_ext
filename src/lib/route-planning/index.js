import {RoutePlanner} from '~/lib/leaflet.control.route-planner';
import {TripList} from '~/lib/leaflet.control.trip-list';

// Wires the directions panel and the trips list to each other and to the map.
// Saved routes are converted into tracks through the existing track list.
function enableRoutePlanning(map, tracklist) {
    const routePlanner = new RoutePlanner({position: 'topleft'}).addTo(map);
    const tripList = new TripList({position: 'bottomright'}).addTo(map);
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
