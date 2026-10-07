import ko from 'knockout';
import L from 'leaflet';

import './style.css';
import {t} from '~/lib/lang';
import enableTopRow from '~/lib/leaflet.control.layers.top-row';
import {hashState} from '~/lib/leaflet.hashState/hashState';
import {PoiLayer} from '~/lib/leaflet.layer.poi';
import {poiGroups, poiCategories} from '~/lib/leaflet.layer.poi/categories';
import {getIconUrl} from '~/lib/leaflet.layer.poi/icons';
import * as logging from '~/lib/logging';
import {orderOverpassUrls} from '~/lib/overpass';
import safeLocalStorage from '~/lib/safe-localstorage';

import layout from './control.html';

const storageKey = 'leafletPoiSettings';
const overpassUrlStorageKey = 'leafletPoiOverpassUrl';
const hashKey = 'poi';

ko.bindingHandlers.indeterminate = {
    update: function (element, valueAccessor) {
        element.indeterminate = Boolean(ko.unwrap(valueAccessor()));
    },
};

class PoiPanelModel {
    constructor(onSelectionChange) {
        this._onSelectionChange = onSelectionChange;
        this.visible = ko.observable(false);
        this.query = ko.observable('');
        this.status = ko.observable('');
        this.searchPlaceholder = t('Поиск категорий', 'Search categories');
        this.selectAllText = t('Выбрать все', 'Select all');
        this.clearAllText = t('Снять все', 'Clear all');
        this.closeText = t('Закрыть', 'Close');
        this.groups = poiGroups.map((group) => this._createGroupModel(group));
        this.allCategories = [];
        for (const group of this.groups) {
            this.allCategories.push(...group.categories);
        }
        this.visibleGroups = ko.pureComputed(() => this._filterGroups());
    }

    _createGroupModel(group) {
        const categories = group.categories.map((category) => {
            const model = {
                id: category.id,
                title: t(category.titleRu, category.titleEn),
                searchText: `${category.titleRu} ${category.titleEn}`.toLowerCase(),
                tooltip: `${category.titleRu} / ${category.titleEn}`,
                iconUrl: getIconUrl(category.icon),
                selected: ko.observable(false),
                count: ko.observable(0),
                countText: ko.pureComputed(() => (model.count() ? `(${model.count()})` : '')),
                onChanged: () => this._onSelectionChange(),
            };
            return model;
        });
        return {
            title: t(group.titleRu, group.titleEn),
            searchText: `${group.titleRu} ${group.titleEn}`.toLowerCase(),
            categories,
            allSelected: this._createGroupSelection(categories),
            someSelected: ko.pureComputed(() => {
                const selectedCount = categories.filter((category) => category.selected()).length;
                return selectedCount > 0 && selectedCount < categories.length;
            }),
        };
    }

    /*
     Creates the tri-state checkbox model for a list of categories. Only the passed categories
     are toggled, so a group header does not enable categories hidden by the search filter.
     */
    _createGroupSelection(categories) {
        return ko.pureComputed({
            read: () => categories.every((category) => category.selected()),
            write: (value) => {
                for (const category of categories) {
                    category.selected(Boolean(value));
                }
                this._onSelectionChange();
            },
        });
    }

    _filterGroups() {
        const query = this.query().trim().toLowerCase();
        const result = [];
        for (const group of this.groups) {
            const groupMatches = query && group.searchText.includes(query);
            const categories = groupMatches
                ? group.categories
                : group.categories.filter((category) => !query || category.searchText.includes(query));
            if (categories.length) {
                result.push({
                    title: group.title,
                    categories,
                    allSelected: this._createGroupSelection(categories),
                    someSelected: ko.pureComputed(() => {
                        const selectedCount = categories.filter((category) => category.selected()).length;
                        return selectedCount > 0 && selectedCount < categories.length;
                    }),
                });
            }
        }
        return result;
    }

    getSelectedIds() {
        return this.allCategories.filter((category) => category.selected()).map((category) => category.id);
    }

    setSelectedIds(ids) {
        const selected = new Set(ids);
        for (const category of this.allCategories) {
            category.selected(selected.has(category.id));
        }
    }

    updateCounts(counts) {
        for (const category of this.allCategories) {
            category.count(counts[category.id] ?? 0);
        }
    }

    onSelectAll() {
        for (const category of this.allCategories) {
            category.selected(true);
        }
        this._onSelectionChange();
    }

    onClearAll() {
        for (const category of this.allCategories) {
            category.selected(false);
        }
        this._onSelectionChange();
    }

    onClose() {
        this.visible(false);
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
            const configuredUrls = (poiOptions.overpassUrls ?? []).filter(Boolean);
            const overpassUrls = orderOverpassUrls(configuredUrls, this._loadRememberedOverpassUrl(configuredUrls));
            this._poiLayer = new PoiLayer(overpassUrls, {
                ...(poiOptions.layerOptions ?? {}),
                onOverpassUrlChange: (url) => this._saveRememberedOverpassUrl(url, configuredUrls),
                cacheStorage: safeLocalStorage,
            });
            this._poiModel = new PoiPanelModel(() => this._onPoiSelectionChanged());
            this._poiLayer.on('loadstate', (e) => this._poiModel.status(this._getPoiStatusText(e)));
            this._poiLayer.on('countschanged', (e) => this._poiModel.updateCounts(e.counts));
            this._injectPoiButton();
            this._initPoiWindow();
            this._loadPoiSettings();
            hashState.addEventListener(hashKey, (values) => this._onPoiHashChanged(values));
        },

        _loadRememberedOverpassUrl: function (configuredUrls) {
            try {
                const stored = JSON.parse(safeLocalStorage.getItem(overpassUrlStorageKey) ?? 'null');
                if (
                    stored &&
                    typeof stored.url === 'string' &&
                    Array.isArray(stored.urls) &&
                    stored.urls.length === configuredUrls.length &&
                    stored.urls.every((url, index) => url === configuredUrls[index])
                ) {
                    return stored.url;
                }
            } catch (e) {
                // the stored value is broken or from an older format, ignore it
            }
            return null;
        },

        _saveRememberedOverpassUrl: function (url, configuredUrls) {
            safeLocalStorage.setItem(overpassUrlStorageKey, JSON.stringify({url, urls: configuredUrls}));
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
    });
}

export {PoiPanelModel};
export default enablePoi;
