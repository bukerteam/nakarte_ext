import L from 'leaflet';

import '~/lib/leaflet.layer.canvasMarkers'; // eslint-disable-line import/no-unassigned-import
import './style.css';
import {t} from '~/lib/lang';
import * as logging from '~/lib/logging';
import {OverpassClient, buildOverpassQuery, parseOverpassResponse} from '~/lib/overpass';

import {getCategory, matchCategory} from './categories';
import {getIconUrl} from './icons';
import {buildClusterPopupHtml, buildPoiPopupHtml, getPoiName} from './poi';

/*
 Persistent layer with OSM POIs loaded from Overpass API for the current map view.
 Selected categories are set with setCategories(); the layer queries only categories whose minZoom
 is not greater than the current zoom, caches responses and aborts stale requests.
 */
const PoiLayer = L.Layer.CanvasMarkers.extend({
    options: {
        pane: 'rasterMarker',
        zIndex: 620,
        iconBackground: true,
        clustering: true,
        maxClusterRadius: 50,
        disableClusterAtZoom: 17,
        useDevicePixelRatio: true,
        minZoom: 10,
        maxBboxArea: 4,
        maxPoints: 2000,
        debounceDelay: 500,
        iconScaleRefZoom: 14,
        iconScaleMin: 0.75,
        iconScaleMax: 1.5,
    },

    initialize: function (urls, options) {
        L.Layer.CanvasMarkers.prototype.initialize.call(this, null, options);
        this._client = new OverpassClient(urls, {
            onWorkingUrlChange: this.options.onOverpassUrlChange,
            cacheStorage: this.options.cacheStorage,
        });
        this._categoryIds = [];
        this._loadedPois = [];
        this._markers = [];
        this._counts = {};
        this._loadedBounds = null;
        this._loadedCategoryIds = null;
        this._loadedZoom = null;
        this._truncated = false;
        this._markersSignature = null;
        this._markersSource = null;
        this._request = null;
        this._requestId = 0;
        this._updateTimer = null;
        this.on('markerclick', this._onMarkerClick, this);
    },

    setCategories: function (categoryIds) {
        this._categoryIds = categoryIds ? [...categoryIds] : [];
        if (this._categoryIds.length) {
            this._updateMarkers();
            this._fireSelectedCounts();
        } else {
            this._setPois([], {});
        }
        // when the layer is not on the map yet, onAdd() will request the data itself
        if (this._map) {
            this.scheduleUpdate(0);
        }
    },

    /*
     Replaces the Overpass endpoints (for example when the NextGIS key changes) and refetches the
     current view through them.
     */
    setOverpassUrls: function (urls) {
        this._client.setUrls(urls);
        this._clearLoadedData();
        if (this._map) {
            this.scheduleUpdate(0);
        }
    },

    _fireSelectedCounts: function () {
        const counts = {};
        for (const id of this._categoryIds) {
            if (this._counts[id]) {
                counts[id] = this._counts[id];
            }
        }
        this.fire('countschanged', {counts});
    },

    getCounts: function () {
        return {...this._counts};
    },

    scheduleUpdate: function (delay = this.options.debounceDelay) {
        if (this._updateTimer) {
            clearTimeout(this._updateTimer);
        }
        this._updateTimer = setTimeout(() => {
            this._updateTimer = null;
            this.update();
        }, delay);
    },

    onAdd: function (map) {
        L.Layer.CanvasMarkers.prototype.onAdd.call(this, map);
        this._updateIconScale(map.getZoom());
        map.on('moveend', this._onViewChange, this);
        map.on('zoomend', this._onViewChange, this);
        this.update();
    },

    onRemove: function (map) {
        map.off('moveend', this._onViewChange, this);
        map.off('zoomend', this._onViewChange, this);
        if (this._updateTimer) {
            clearTimeout(this._updateTimer);
            this._updateTimer = null;
        }
        this._abortRequest();
        L.Layer.CanvasMarkers.prototype.onRemove.call(this, map);
    },

    _resetView: function (...args) {
        if (this._map) {
            this._updateIconScale(this._map.getZoom());
        }
        L.Layer.CanvasMarkers.prototype._resetView.apply(this, args);
    },

    _onViewChange: function () {
        this.scheduleUpdate();
    },

    _updateIconScale: function (zoom) {
        const {iconScaleRefZoom, iconScaleMin, iconScaleMax} = this.options;
        const scale = Math.max(iconScaleMin, Math.min(iconScaleMax, 2 ** (zoom - iconScaleRefZoom)));
        if (this.options.iconScale !== scale) {
            this.options.iconScale = scale;
            this.resetLabels();
        }
    },

    _abortRequest: function () {
        if (this._request) {
            this._request.abort();
            this._request = null;
        }
    },

    /*
     Resets the loaded data and invalidates an in-flight request, so that its response is not
     applied after the layer has left the state the request was made for.
     */
    _clearLoadedData: function () {
        this._abortRequest();
        this._requestId += 1;
        this._loadedBounds = null;
        this._loadedCategoryIds = null;
        this._loadedZoom = null;
        this._truncated = false;
    },

    _activeCategories: function (zoom) {
        const result = [];
        for (const id of this._categoryIds) {
            const category = getCategory(id);
            if (category && zoom >= category.minZoom) {
                result.push(category);
            }
        }
        return result;
    },

    /*
     Returns true when the loaded data already covers the current view: the view is inside the
     loaded bounds and all active categories are loaded. Truncated data still covers pans at the
     loaded zoom, but zooming in must refetch: a smaller bbox may fit into the points limit.
     */
    _isViewCovered: function (zoom, activeIds) {
        return Boolean(
            this._loadedBounds &&
                this._loadedCategoryIds &&
                this._loadedBounds.contains(this._map.getBounds()) &&
                [...activeIds].every((id) => this._loadedCategoryIds.has(id)) &&
                (!this._truncated || zoom <= this._loadedZoom)
        );
    },

    update: async function () {
        if (!this._map) {
            return;
        }
        const zoom = this._map.getZoom();
        const categories = this._activeCategories(zoom);
        if (!categories.length) {
            this._clearLoadedData();
            this._setPois([], {});
            this.fire('loadstate', {state: 'zoom'});
            return;
        }
        const bounds = this._map.getBounds().pad(0.2);
        const area = (bounds.getNorth() - bounds.getSouth()) * (bounds.getEast() - bounds.getWest());
        if (zoom < this.options.minZoom || area > this.options.maxBboxArea) {
            this._clearLoadedData();
            this._setPois([], {});
            this.fire('loadstate', {state: 'area'});
            return;
        }
        const activeIds = new Set(categories.map((category) => category.id));
        if (this._isViewCovered(zoom, activeIds)) {
            // the current view is already covered by the loaded data
            this._updateMarkers();
            if (this._truncated) {
                this.fire('loadstate', {state: 'limit'});
            } else {
                this.fire('loadstate', {state: 'loaded', count: this._loadedPois.length});
            }
            return;
        }
        const filters = [];
        for (const category of categories) {
            filters.push(...category.filters);
        }
        const query = buildOverpassQuery(
            filters,
            [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()],
            {maxPoints: this.options.maxPoints}
        );
        const requestId = this._requestId + 1;
        this._requestId = requestId;
        this._abortRequest();
        this.fire('loadstate', {state: 'loading'});
        const request = this._client.query(query);
        this._request = request;
        let data;
        try {
            data = await request.promise;
        } catch (e) {
            if (requestId !== this._requestId || this._request !== request) {
                return;
            }
            this._request = null;
            logging.captureException(e, 'failed to load POI from Overpass');
            this.fire('loadstate', {state: 'error'});
            return;
        }
        if (requestId !== this._requestId) {
            return;
        }
        this._request = null;
        this._loadedBounds = bounds;
        this._loadedCategoryIds = activeIds;
        this._loadedZoom = zoom;
        const elements = parseOverpassResponse(data);
        // count raw elements: the parser drops elements without coordinates, but the server-side
        // limit applies to them as well
        this._truncated = data.elements.length >= this.options.maxPoints;
        const pois = [];
        const counts = {};
        for (const element of elements) {
            const category = matchCategory(element.tags, categories);
            if (!category) {
                continue;
            }
            counts[category.id] = (counts[category.id] ?? 0) + 1;
            pois.push({...element, categoryId: category.id});
        }
        this._setPois(pois, counts);
        if (this._truncated) {
            this.fire('loadstate', {state: 'limit'});
        } else {
            this.fire('loadstate', {state: 'loaded', count: pois.length});
        }
    },

    _setPois: function (pois, counts) {
        this._loadedPois = pois;
        this._counts = counts;
        this._updateMarkers();
        this.fire('countschanged', {counts: {...counts}});
    },

    _updateMarkers: function () {
        const zoom = this._map ? this._map.getZoom() : 0;
        const signature = `${zoom}|${[...this._categoryIds].sort().join(',')}|${this._loadedPois.length}`;
        if (this._markersSignature === signature && this._markersSource === this._loadedPois) {
            return;
        }
        this._markersSignature = signature;
        this._markersSource = this._loadedPois;
        const selected = new Set(this._categoryIds);
        const markers = [];
        for (const poi of this._loadedPois) {
            const category = getCategory(poi.categoryId);
            if (!category || !selected.has(poi.categoryId) || zoom < category.minZoom) {
                continue;
            }
            markers.push(this._createMarker(poi, category));
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
        return {
            latlng: L.latLng(poi.lat, poi.lon),
            icon: {url: getIconUrl(category.icon)},
            tooltip: getPoiName(poi.tags) || t('Без названия', 'Unnamed'),
            properties: {poi, category},
        };
    },

    _onMarkerClick: function (e) {
        if (!this._map) {
            return;
        }
        const marker = e.marker;
        if (marker._cluster) {
            const {bounds} = marker._cluster;
            if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
                this._map.openPopup(buildClusterPopupHtml(marker._cluster), marker.latlng, {maxWidth: 400});
            } else {
                this._map.fitBounds(bounds, {
                    maxZoom: Math.min(this.options.disableClusterAtZoom, this._map.getMaxZoom()),
                });
            }
            return;
        }
        const {poi, category} = marker.properties;
        this._map.openPopup(buildPoiPopupHtml(poi, category), marker.latlng, {maxWidth: 400});
    },
});

export {PoiLayer};
