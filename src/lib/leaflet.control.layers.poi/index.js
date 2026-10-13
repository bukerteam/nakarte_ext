import ko from 'knockout';
import L from 'leaflet';

import './style.css';
import {t} from '~/lib/lang';
import enableTopRow from '~/lib/leaflet.control.layers.top-row';
import {hashState} from '~/lib/leaflet.hashState/hashState';
import {PoiLayer} from '~/lib/leaflet.layer.poi';
import {poiCategories} from '~/lib/leaflet.layer.poi/categories';
import {createCategoriesModel} from '~/lib/leaflet.layer.poi/categories-model';
import * as logging from '~/lib/logging';
import {orderOverpassUrls} from '~/lib/overpass';
import {getEffectiveKey, getUserKey, setUserKey} from '~/lib/overpass/key';
import {
    getOverpassUrls,
    loadRememberedOverpassUrl,
    loadRuntimeKeyOnce,
    saveRememberedOverpassUrl,
} from '~/lib/overpass/settings';
import safeLocalStorage from '~/lib/safe-localstorage';

import layout from './control.html';

const storageKey = 'leafletPoiSettings';
const hashKey = 'poi';

class PoiPanelModel {
    constructor(onSelectionChange) {
        this.visible = ko.observable(false);
        this.status = ko.observable('');
        this.searchPlaceholder = t('Поиск категорий', 'Search categories');
        this.selectAllText = t('Выбрать все', 'Select all');
        this.clearAllText = t('Снять все', 'Clear all');
        this.closeText = t('Закрыть', 'Close');
        this.nextgisKey = ko.observable('');
        this.siteKeyActive = ko.observable(false);
        this.sourceText = ko.observable('');
        this.nextgisKeyPlaceholder = t('Ключ NextGIS (необязательно)', 'NextGIS key (optional)');
        this.nextgisKeyHint = ko.pureComputed(() => {
            if (this.nextgisKey().trim()) {
                return t('Ключ сохранён в этом браузере', 'The key is stored in this browser');
            }
            if (this.siteKeyActive()) {
                return t('Используется ключ сайта', 'The site key is used');
            }
            return t('Ключ ускоряет загрузку POI', 'The key speeds up POI loading');
        });
        this.categories = createCategoriesModel({onSelectionChange});
        // the panel template and the tests use the category model fields directly
        this.query = this.categories.query;
        this.groups = this.categories.groups;
        this.allCategories = this.categories.allCategories;
        this.visibleGroups = this.categories.visibleGroups;
    }

    getSelectedIds() {
        return this.categories.getSelectedIds();
    }

    setSelectedIds(ids) {
        this.categories.setSelectedIds(ids);
    }

    updateCounts(counts) {
        this.categories.updateCounts(counts);
    }

    onSelectAll() {
        this.categories.onSelectAll();
    }

    onClearAll() {
        this.categories.onClearAll();
    }

    onClose() {
        this.visible(false);
    }

    onNextgisKeyChanged() {
        if (this.onNextgisKeyChange) {
            this.onNextgisKeyChange(this.nextgisKey());
        }
    }
}

function enablePoi(control, poiOptions = {}) {
    if (control._poiEnabled) {
        return;
    }

    enableTopRow(control);

    const originalOnAdd = control.onAdd;

    L.Util.extend(control, {
        _poiEnabled: true,

        onAdd: function (map) {
            const container = originalOnAdd.call(this, map);
            this._initPoi();
            return container;
        },

        _initPoi: function () {
            if (this._poiLayer) {
                return;
            }
            this._overpassUrls = this._getOverpassUrls();
            const overpassUrls = orderOverpassUrls(
                this._overpassUrls,
                this._loadRememberedOverpassUrl(this._overpassUrls)
            );
            this._poiLayer = new PoiLayer(overpassUrls, {
                ...(poiOptions.layerOptions ?? {}),
                onOverpassUrlChange: (url) => this._saveRememberedOverpassUrl(url, this._overpassUrls),
                cacheStorage: safeLocalStorage,
            });
            this._poiModel = new PoiPanelModel(() => this._onPoiSelectionChanged());
            this._poiModel.nextgisKey(getUserKey() ?? '');
            this._poiModel.siteKeyActive(Boolean(!getUserKey() && getEffectiveKey()));
            this._poiModel.onNextgisKeyChange = (key) => this._onNextgisKeyChanged(key);
            // save the value as it is typed, so that a reload right after pasting keeps the key
            this._poiModel.nextgisKey.subscribe((key) => setUserKey(key));
            this._poiLayer.on('loadstate', (e) => {
                this._poiModel.status(this._getPoiStatusText(e));
                this._poiModel.sourceText(this._getPoiSourceText(e));
            });
            this._poiLayer.on('countschanged', (e) => this._poiModel.updateCounts(e.counts));
            this._injectPoiButton();
            this._initPoiWindow();
            this._loadPoiSettings();
            hashState.addEventListener(hashKey, (values) => this._onPoiHashChanged(values));
            this._loadRuntimeOverpassKey();
        },

        /*
         Returns the Overpass endpoints to use: with a key (user, runtime config or build time) the
         NextGIS instance comes first, otherwise the endpoints from the options.
         */
        _getOverpassUrls: function () {
            return getOverpassUrls(poiOptions.overpassUrls ?? []);
        },

        _onNextgisKeyChanged: function (key) {
            setUserKey(key);
            this._applyOverpassUrls();
            if (this._poiModel) {
                this._poiModel.siteKeyActive(Boolean(!getUserKey() && getEffectiveKey()));
            }
        },

        /*
         Applies the endpoint list when the effective key changed, and refetches the current view.
         */
        _applyOverpassUrls: function () {
            if (!this._poiLayer) {
                return;
            }
            const urls = this._getOverpassUrls();
            const previous = this._overpassUrls ?? [];
            if (urls.length === previous.length && urls.every((url, index) => url === previous[index])) {
                return;
            }
            this._overpassUrls = urls;
            this._poiLayer.setOverpassUrls(orderOverpassUrls(urls, this._loadRememberedOverpassUrl(urls)));
        },

        /*
         config.json next to the site may provide a key; the user key has priority over it.
         */
        _loadRuntimeOverpassKey: function () {
            loadRuntimeKeyOnce().then(() => {
                if (getUserKey()) {
                    return;
                }
                this._applyOverpassUrls();
                if (this._poiModel) {
                    this._poiModel.siteKeyActive(Boolean(getEffectiveKey()));
                }
            });
        },

        _loadRememberedOverpassUrl: function (configuredUrls) {
            return loadRememberedOverpassUrl(configuredUrls);
        },

        _saveRememberedOverpassUrl: function (url, configuredUrls) {
            saveRememberedOverpassUrl(url, configuredUrls);
        },

        _injectPoiButton: function () {
            const button = L.DomUtil.create('div', 'button icon-poi');
            button.setAttribute('role', 'button');
            button.setAttribute('tabindex', '0');
            L.DomEvent.on(button, 'click', () => this._togglePoiWindow());
            L.DomEvent.on(button, 'keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    L.DomEvent.preventDefault(e);
                    this._togglePoiWindow();
                }
            });
            this._topRow.appendChild(button);
            this._poiButton = button;
            this._updatePoiButtonTitle(0);
        },

        _togglePoiWindow: function () {
            this._poiModel.visible(!this._poiModel.visible());
        },

        _initPoiWindow: function () {
            const container = L.DomUtil.create('div', 'leaflet-poi-dialog-wrapper');
            L.DomEvent.disableClickPropagation(container).disableScrollPropagation(container);
            container.setAttribute('data-bind', 'visible: visible');
            container.innerHTML = layout;
            ko.applyBindings(this._poiModel, container);
            this._map._controlContainer.appendChild(container);
            this._poiWindow = container;
        },

        _filterKnownCategories: function (values) {
            const known = new Set(poiCategories.map((category) => category.id));
            return (values ?? []).filter((id) => known.has(id));
        },

        _loadPoiSettings: function () {
            let ids = [];
            try {
                const settings = JSON.parse(safeLocalStorage.getItem(storageKey) ?? '{}');
                if (Array.isArray(settings.categories)) {
                    ids = settings.categories;
                }
            } catch (e) {
                logging.captureException(e, 'failed to parse POI settings');
            }
            const hashIds = hashState.getState(hashKey);
            if (Array.isArray(hashIds)) {
                ids = hashIds;
            }
            ids = this._filterKnownCategories(ids);
            this._poiModel.setSelectedIds(ids);
            this._applyPoiSelection(ids);
            this._updatePoiButtonTitle(ids.length);
        },

        _savePoiSettings: function (ids) {
            safeLocalStorage.setItem(storageKey, JSON.stringify({categories: ids}));
        },

        _onPoiSelectionChanged: function () {
            const ids = this._poiModel.getSelectedIds();
            this._savePoiSettings(ids);
            hashState.updateState(hashKey, ids.length ? ids : null);
            this._applyPoiSelection(ids);
            this._updatePoiButtonTitle(ids.length);
        },

        _onPoiHashChanged: function (values) {
            if (!this._poiModel) {
                return;
            }
            const ids = this._filterKnownCategories(values);
            this._poiModel.setSelectedIds(ids);
            this._savePoiSettings(ids);
            this._applyPoiSelection(ids);
            this._updatePoiButtonTitle(ids.length);
        },

        _applyPoiSelection: function (ids) {
            if (!this._map || !this._poiLayer) {
                return;
            }
            if (ids.length) {
                this._poiLayer.setCategories(ids);
                if (!this._map.hasLayer(this._poiLayer)) {
                    this._map.addLayer(this._poiLayer);
                }
            } else {
                this._poiLayer.setCategories([]);
                if (this._map.hasLayer(this._poiLayer)) {
                    this._map.removeLayer(this._poiLayer);
                }
            }
        },

        _updatePoiButtonTitle: function (count) {
            if (!this._poiButton) {
                return;
            }
            const title = count
                ? t(`Слои POI: выбрано ${count}`, `OSM POI layers: ${count} selected`)
                : t('Слои POI из OpenStreetMap', 'OSM POI layers');
            this._poiButton.title = title;
            this._poiButton.setAttribute('aria-label', title);
            this._poiButton.classList.toggle('poi-active', count > 0);
        },

        _getPoiStatusText: function (e) {
            switch (e.state) {
                case 'loading':
                    return t('Загрузка…', 'Loading…');
                case 'zoom':
                    return t('Приблизьте карту, чтобы загрузить POI', 'Zoom in to load POI');
                case 'area':
                    return t('Слишком большая область — приблизьте карту', 'Area is too large — zoom in');
                case 'limit':
                    return t('Возможно, точек больше — приблизьте карту', 'There may be more points — zoom in');
                case 'error':
                    return t('Не удалось загрузить POI', 'Failed to load POI');
                default:
                    return '';
            }
        },

        /*
         Shows which interpreter served the load, so that it is clear whether the key works.
         */
        _getPoiSourceText: function (e) {
            if (e.state !== 'loaded' && e.state !== 'limit') {
                return '';
            }
            const url = this._poiLayer?.getWorkingUrl?.() ?? '';
            if (url.includes('overpass.nextgis.com')) {
                return 'NextGIS';
            }
            if (url.includes('maps.mail.ru')) {
                return t('зеркало VK Maps', 'VK Maps mirror');
            }
            if (url.includes('overpass-api.de')) {
                return 'overpass-api.de';
            }
            return '';
        },
    });
}

export {PoiPanelModel};
export default enablePoi;
