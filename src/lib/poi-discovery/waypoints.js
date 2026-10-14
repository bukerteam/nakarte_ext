/*
 Turns selected search results into waypoints for the track list (see track-list.addTrack):
 {lat, lng, name, meta}. The description keeps the category, the position along the track and the
 OSM link; the osmand:color extension colors the waypoint icon in OsmAnd. The track list exports
 the metadata to GPX as is.
 */

import {t} from '~/lib/lang';
import {getCategoryTitle, getPoiLink, getPoiName} from '~/lib/leaflet.layer.poi/poi';

import {formatDistance} from './format';
import {getSource} from './sources';

const OSMAND_GPX_NAMESPACE = 'https://osmand.net/docs/technical/osmand-file-formats/osmand-gpx';

// One color per POI group, used for the osmand:color extension
const groupColors = {
    water: '#2196F3',
    camping: '#4CAF50',
    food: '#FF9800',
    transport: '#607D8B',
    health: '#E53935',
    attractions: '#9C27B0',
    nature: '#795548',
    service: '#00BCD4',
};
const defaultColor = '#FF9800';

/*
 The OSM points are colored by their category group, the points of other sources by the color of
 the source.
 */
function getWaypointColor(item) {
    const {category, poi} = item;
    if (category.groupId && groupColors[category.groupId]) {
        return groupColors[category.groupId];
    }
    const source = getSource(poi.sourceId);
    return (source && source.color) || defaultColor;
}

function buildWaypointDescription(item) {
    const lines = [getCategoryTitle(item.category)];
    const details = [];
    if (item.alongMeters !== undefined) {
        details.push(t(`км ${(item.alongMeters / 1000).toFixed(1)}`, `km ${(item.alongMeters / 1000).toFixed(1)}`));
    }
    if (item.distance !== undefined) {
        details.push(t(`${formatDistance(item.distance)} от трека`, `${formatDistance(item.distance)} from the track`));
    }
    if (details.length) {
        lines.push(details.join(', '));
    }
    if (item.poi.description) {
        lines.push(item.poi.description);
    }
    if (item.poi.tags.description) {
        lines.push(item.poi.tags.description);
    }
    const link = getPoiLink(item.poi);
    if (link) {
        lines.push(link.url);
    }
    return lines.join('\n');
}

/*
 Turns selected search results into waypoints for the track list (see track-list.addTrack):
 {lat, lng, name, meta}. A point without its own OSM name gets an empty label, so the track list
 does not draw a wall of identical labels on the map; the category name is kept in meta.name and
 goes to the GPX. The description keeps the category, the position along the track and the OSM
 link; the osmand:color extension colors the waypoint icon in OsmAnd. The track list exports the
 metadata to GPX as is.
 */
function buildWaypoints(items) {
    return items.map((item) => {
        const category = item.category;
        const poiName = getPoiName(item.poi.tags);
        return {
            lat: item.poi.lat,
            lng: item.poi.lon,
            name: poiName || '',
            meta: {
                name: poiName ? undefined : getCategoryTitle(category),
                desc: buildWaypointDescription(item),
                extensions: [
                    {
                        name: 'osmand:color',
                        attributes: {},
                        namespaces: {osmand: OSMAND_GPX_NAMESPACE},
                        children: [getWaypointColor(item)],
                    },
                ],
            },
        };
    });
}

export {buildWaypointDescription, buildWaypoints};
