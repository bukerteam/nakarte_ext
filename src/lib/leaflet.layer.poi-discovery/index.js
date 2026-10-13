/*
 Layer with the POIs found by the discovery panel. Independent of the highlight POI layer and of
 the base layer: the markers live until the next search or an explicit clear().
 */

import L from 'leaflet';

import '~/lib/leaflet.layer.canvasMarkers'; // eslint-disable-line import/no-unassigned-import
import {t} from '~/lib/lang';
import {buildPoiPopupHtml, createPoiMarker, handleClusterClick, updateIconScale} from '~/lib/leaflet.layer.poi/poi';
import {getPoiCategory} from '~/lib/poi-discovery/categories';
import {formatDistance} from '~/lib/poi-discovery/format';
import {getSource} from '~/lib/poi-discovery/sources';

import './style.css';

const PoiDiscoveryLayer = L.Layer.CanvasMarkers.extend({
    options: {
        pane: 'rasterMarker',
        zIndex: 630,
        iconBackground: true,
        clustering: true,
        maxClusterRadius: 50,
        disableClusterAtZoom: 17,
        useDevicePixelRatio: true,
        iconScaleRefZoom: 14,
        iconScaleMin: 0.75,
        iconScaleMax: 1.5,
    },

    initialize: function (options) {
        L.Layer.CanvasMarkers.prototype.initialize.call(this, null, options);
        this._pois = [];
        this._markers = [];
        this.on('markerclick', this._onMarkerClick, this);
    },

    setPois: function (pois) {
        this._pois = pois ?? [];
        this._updateMarkers();
    },

    clear: function () {
        this.setPois([]);
    },

    getPois: function () {
        return this._pois;
    },

    onAdd: function (map) {
        L.Layer.CanvasMarkers.prototype.onAdd.call(this, map);
        this._updateIconScale(map.getZoom());
        map.on('zoomend', this._onZoomChange, this);
    },

    onRemove: function (map) {
        map.off('zoomend', this._onZoomChange, this);
        L.Layer.CanvasMarkers.prototype.onRemove.call(this, map);
    },

    _onZoomChange: function () {
        this._updateIconScale(this._map.getZoom());
    },

    _updateIconScale: function (zoom) {
        updateIconScale(this, zoom);
    },

    _updateMarkers: function () {
        const markers = [];
        for (const poi of this._pois) {
            const category = getPoiCategory(poi.categoryId);
            if (category) {
                markers.push(this._createMarker(poi, category));
            }
        }
        if (this._markers.length) {
            this.removeMarkers(this._markers);
        }
        this._markers = markers;
        if (markers.length) {
            this.addMarkers(markers);
        }
    },

    _createMarker: function (poi, category) {
        return createPoiMarker(poi, category);
    },

    /*
     Pans the map to the point of the search results and opens its popup, so that a click in the
     results list shows where the point is.
     */
    showPoi: function (poi) {
        if (!this._map) {
            return;
        }
        const marker = this._markers.find((item) => {
            const markerPoi = item.properties.poi;
            return markerPoi === poi || (markerPoi.type === poi.type && String(markerPoi.id) === String(poi.id));
        });
        if (!marker) {
            return;
        }
        this._map.panTo(marker.latlng);
        this._onMarkerClick({marker});
    },

    _onMarkerClick: function (e) {
        if (!this._map) {
            return;
        }
        const marker = e.marker;
        if (marker._cluster) {
            handleClusterClick(this._map, marker, this.options.disableClusterAtZoom);
            return;
        }
        const {poi, category} = marker.properties;
        this._map.openPopup(
            buildPoiPopupHtml(poi, category, this._buildExtraInfo(poi), this._getAttribution(poi)),
            marker.latlng,
            {
                maxWidth: 400,
            }
        );
    },

    /*
     The attribution of the point source, so that the popup credits Wikidata or iNaturalist.
     */
    _getAttribution: function (poi) {
        const source = getSource(poi.sourceId);
        return (source && source.attribution) || '';
    },

    /*
     The popup of a search result additionally shows the source and, in the corridor mode, the
     position along the track and the distance to it.
     */
    _buildExtraInfo: function (poi) {
        const parts = [];
        const source = getSource(poi.sourceId);
        if (source) {
            parts.push(t(source.titleRu, source.titleEn));
        }
        if (poi.alongMeters !== undefined) {
            parts.push(t(`км ${(poi.alongMeters / 1000).toFixed(1)}`, `km ${(poi.alongMeters / 1000).toFixed(1)}`));
        }
        if (poi.distance !== undefined) {
            parts.push(t(`${formatDistance(poi.distance)} от трека`, `${formatDistance(poi.distance)} from the track`));
        }
        if (!parts.length) {
            return '';
        }
        return `<div class="poi-discovery-popup-info">${parts.join(' · ')}</div>`;
    },
});

export {PoiDiscoveryLayer};
