/*
 POI discovery panel: searches the selected categories in the current map area, in a drawn
 rectangle or around a track (within the corridor width and the kilometer range), shows the
 results on a dedicated layer and turns the selected results into waypoints of a new track.

 The panel is enabled on the layers control like the POI highlight panel and adds its own button
 to the top row of the control.
 */

import ko from 'knockout';
import L from 'leaflet';

import './style.css';
import {t} from '~/lib/lang';
import {RectangleSelect} from '~/lib/leaflet.control.jnx/selector';
import enableTopRow from '~/lib/leaflet.control.layers.top-row';
import {poiCategories} from '~/lib/leaflet.layer.poi/categories';
import {createCategoriesModel} from '~/lib/leaflet.layer.poi/categories-model';
import {getIconUrl} from '~/lib/leaflet.layer.poi/icons';
import {getCategoryTitle, getPoiName} from '~/lib/leaflet.layer.poi/poi';
import {PoiDiscoveryLayer} from '~/lib/leaflet.layer.poi-discovery';
import * as logging from '~/lib/logging';
import {notify} from '~/lib/notifications';
import {OverpassClient, orderOverpassUrls} from '~/lib/overpass';
import {
    getOverpassUrls,
    loadRememberedOverpassUrl,
    loadRuntimeKeyOnce,
    saveRememberedOverpassUrl,
} from '~/lib/overpass/settings';
import {getPoiCategory} from '~/lib/poi-discovery/categories';
import {buildSegmentsIndex, extractSubSegments} from '~/lib/poi-discovery/corridor';
import {formatDistance, formatKilometers} from '~/lib/poi-discovery/format';
import {poiSources} from '~/lib/poi-discovery/sources';
import {getUsername as getInatUsername, setUsername} from '~/lib/poi-discovery/sources/inaturalist';
import {buildWaypoints} from '~/lib/poi-discovery/waypoints';
import safeLocalStorage from '~/lib/safe-localstorage';

import layout from './control.html';

const storageKey = 'leafletPoiDiscoverySettings';
const windowPositionStorageKey = 'leafletPoiDiscoveryWindowPosition';
const defaultWidth = 200;
const maxCorridorWidth = 5000;
const maxSearchArea = 9;

/*
 Leaflet polylines may keep nested arrays of points (multi-part lines), the corridor needs a flat
 list of points.
 */
function flattenLatLngs(latlngs) {
    if (!latlngs.length) {
        return [];
    }
    if (Array.isArray(latlngs[0])) {
        const result = [];
        for (const item of latlngs) {
            result.push(...flattenLatLngs(item));
        }
        return result;
    }
    return latlngs;
}

class PoiDiscoveryModel {
    constructor({
        tracklist,
        getAreaBounds,
        onSearch,
        onCancel,
        onSaveWaypoints,
        onRectangleToggle,
        onClear,
        onClose,
        onShowResult,
        onSettingsChanged,
    }) {
        this._tracklist = tracklist;
        this._getAreaBounds = getAreaBounds;
        this._onSearch = onSearch;
        this._onCancel =
            onCancel ??
            (() => {
                // the search is not cancelled by default
            });
        this._onSaveWaypoints = onSaveWaypoints;
        this._onRectangleToggle = onRectangleToggle;
        this._onClear = onClear;
        this._onClose = onClose;
        this._onShowResult = onShowResult;
        this._onSettingsChanged =
            onSettingsChanged ??
            (() => {
                // settings are not persisted by default
            });

        this.visible = ko.observable(false);
        this.title = t('Поиск POI', 'POI search');
        this.closeText = t('Закрыть', 'Close');
        this.mode = ko.observable('area');
        this.areaModeText = t('В области', 'In area');
        this.corridorModeText = t('Вдоль трека', 'Along a track');
        this.searchText = t('Искать', 'Search');
        this.cancelText = t('Отменить', 'Cancel');
        this.searchButtonText = ko.pureComputed(() => (this.searching() ? this.cancelText : this.searchText));
        this.searching = ko.observable(false);
        this.status = ko.observable('');
        this.progressText = ko.observable('');
        this.progressWidth = ko.observable('0%');
        this.error = ko.observable('');
        this.warning = ko.observable('');
        this.rectangleActive = ko.observable(false);
        this.selectRectangleText = t('Прямоугольник', 'Rectangle');
        this.areaHint = ko.pureComputed(() => {
            if (this.rectangleActive()) {
                return t('Будет использован выделенный прямоугольник', 'The drawn rectangle will be searched');
            }
            return t('Будет использована видимая область карты', 'The visible map area will be searched');
        });
        this.trackLabel = t('Трек', 'Track');
        this.selectTrackText = t('— выберите трек —', '— select a track —');
        this.widthLabel = t('Ширина, м', 'Width, m');
        this.startKmLabel = t('С, км', 'From, km');
        this.endKmLabel = t('По, км', 'To, km');
        this.searchPlaceholder = t('Поиск категорий', 'Search categories');
        this.selectAllResultsText = t('Выбрать все', 'Select all');
        this.clearResultsText = t('Снять выбор', 'Clear selection');
        this.clearText = t('Очистить', 'Clear');
        this.sourcesTitle = t('Источники', 'Sources');
        this.inatUsernameLabel = t('Логин iNaturalist', 'iNaturalist login');
        this.inatUsernameHint = t(
            'Чтобы искать ненаблюдённые виды, укажи свой логин iNaturalist',
            'Enter your iNaturalist login to search for unobserved species'
        );
        this.sourceHintNotConfigured = t('нужен логин', 'login required');
        this.attributionText = poiSources
            .map((source) => source.attribution)
            .filter(Boolean)
            .join(' · ');
        this.width = ko.observable(String(defaultWidth));
        this.startKm = ko.observable('');
        this.endKm = ko.observable('');
        this.selectedTrack = ko.observable(null);
        this.results = ko.observableArray([]);
        this.keptCount = ko.observable(0);
        // the parameters of the search the shown results belong to, used for the track name
        this.lastSearch = null;
        this.categories = createCategoriesModel({onSelectionChange: () => this._onSettingsChanged()});
        this.inatUsername = ko.observable('');
        this.sources = poiSources.map((source) => {
            const model = {
                id: source.id,
                title: t(source.titleRu, source.titleEn),
                enabled: ko.observable(source.id !== 'inaturalist'),
                configured: ko.observable(source.isConfigured()),
                source,
                onChanged: () => this._onSettingsChanged(),
            };
            model.hint = ko.pureComputed(() => (model.configured() ? '' : this.sourceHintNotConfigured));
            return model;
        });
        this.inatUsername(getInatUsername());
        // the login is saved as it is typed, like the NextGIS key in the highlight panel
        this.inatUsername.subscribe((username) => {
            setUsername(username);
            this._updateSourcesConfigured();
            this._onSettingsChanged();
        });
        this.tabCategoriesText = t('Категории OSM', 'OSM categories');
        this.tabResultsText = t('Результаты', 'Results');
        this.emptyResultsText = t('Пока нет результатов — запусти поиск', 'No results yet — run a search');
        this.activeTab = ko.observable('categories');
        this.categoriesTabText = ko.pureComputed(() => {
            const count = this.categories.getSelectedIds().length;
            return count ? `${this.tabCategoriesText} (${count})` : this.tabCategoriesText;
        });
        this.resultsTabText = ko.pureComputed(() => {
            const count = this.results().length;
            return count ? `${this.tabResultsText} (${count})` : this.tabResultsText;
        });

        this.trackOptions = ko.pureComputed(() => {
            if (!this._tracklist) {
                return [];
            }
            return this._tracklist.tracks().filter((track) => track.feature.getLayers().length > 0);
        });
        this.trackOptionText = (track) => `${track.name()} — ${formatKilometers(track.length())}`;
        this.corridorHint = ko.pureComputed(() => {
            const track = this.selectedTrack();
            if (!track) {
                return '';
            }
            return t(
                `Длина трека: ${formatKilometers(track.length())}`,
                `Track length: ${formatKilometers(track.length())}`
            );
        });
        this.resultsText = ko.pureComputed(() =>
            t(`Найдено: ${this.results().length}`, `Found: ${this.results().length}`)
        );
        this.saveText = ko.pureComputed(() =>
            t(`Сохранить выбранные (${this.keptCount()})`, `Save selected (${this.keptCount()})`)
        );

        this.selectedTrack.subscribe(() => this._applyTrackDefaults());
        this.mode.subscribe(() => this._onSettingsChanged());
        this.width.subscribe(() => this._onSettingsChanged());
        // the progress block is shown while the search is running, even before the first response
        this.searching.subscribe((searching) => {
            if (searching) {
                this.setProgress({done: 0, total: 1});
            } else {
                this.setProgress(null);
            }
        });
    }

    onAreaMode() {
        this.mode('area');
    }

    onCorridorMode() {
        this.mode('corridor');
    }

    onSearchArea() {
        if (this.searching()) {
            this._onCancel();
            return;
        }
        this._startSearch();
    }

    onSearchCorridor() {
        if (this.searching()) {
            this._onCancel();
            return;
        }
        this._startSearch();
    }

    onToggleRectangle() {
        this._onRectangleToggle();
    }

    onSourceChanged() {
        this._onSettingsChanged();
    }

    onCategoriesTab() {
        this.activeTab('categories');
    }

    onResultsTab() {
        this.activeTab('results');
    }

    onInatUsernameChanged() {
        setUsername(this.inatUsername());
        this._updateSourcesConfigured();
        this._onSettingsChanged();
    }

    _updateSourcesConfigured() {
        for (const source of this.sources) {
            source.configured(source.source.isConfigured());
        }
    }

    /*
     Returns the sources enabled by the user. A source that needs a login but has none is
     reported by validate(), so the user gets a clear error instead of a silent skip.
     */
    getEnabledSources() {
        return this.sources.filter((source) => source.enabled()).map((source) => source.source);
    }

    setSources(ids) {
        for (const source of this.sources) {
            source.enabled(ids.includes(source.id));
        }
    }

    getEnabledSourceIds() {
        return this.sources.filter((source) => source.enabled()).map((source) => source.id);
    }

    onClose() {
        if (this.searching()) {
            this._onCancel();
        }
        this.visible(false);
        if (this._onClose) {
            this._onClose();
        }
    }

    onSelectAllResults() {
        for (const result of this.results()) {
            result.kept(true);
        }
    }

    onClearResultsSelection() {
        for (const result of this.results()) {
            result.kept(false);
        }
    }

    onClear() {
        if (this.searching()) {
            this._onCancel();
        }
        this.results([]);
        this.keptCount(0);
        this.status('');
        this.progressText('');
        this.progressWidth('0%');
        this.warning('');
        this.error('');
        this.categories.updateCounts({});
        if (this._onClear) {
            this._onClear();
        }
    }

    onSaveSelected() {
        const items = this.results()
            .filter((result) => result.kept())
            .map((result) => ({poi: result.poi, category: result.category}));
        if (!items.length) {
            return;
        }
        if (this._onSaveWaypoints(buildWaypoints(items)) === false) {
            this.error(t('Не удалось сохранить точки', 'Could not save the points'));
            return;
        }
        for (const result of this.results()) {
            result.kept(false);
        }
        this.status(t(`Сохранено точек: ${items.length}`, `Saved points: ${items.length}`));
    }

    getSelectedIds() {
        return this.categories.getSelectedIds();
    }

    setSelectedIds(ids) {
        this.categories.setSelectedIds(ids);
    }

    /*
     Returns a human readable error for the current parameters, or null when the search can start.
     */
    validate() {
        const sources = this.getEnabledSources();
        if (!sources.length) {
            return t('Включите хотя бы один источник', 'Enable at least one source');
        }
        const notConfigured = this.sources.find((source) => source.enabled() && !source.configured());
        if (notConfigured) {
            return t(
                `Укажи логин для источника «${notConfigured.title}»`,
                `Enter the login for "${notConfigured.title}"`
            );
        }
        const osmEnabled = sources.some((source) => source.id === 'osm');
        if (osmEnabled && !this.categories.getSelectedIds().length) {
            return t('Выберите хотя бы одну категорию', 'Select at least one category');
        }
        if (this.mode() !== 'corridor') {
            const [south, west, north, east] = this._getAreaBounds();
            const area = Math.max(0, north - south) * Math.max(0, east - west);
            if (area > maxSearchArea) {
                return t(
                    'Область слишком большая — приблизьте карту или уменьшите прямоугольник',
                    'The area is too large — zoom in or make the rectangle smaller'
                );
            }
            return null;
        }
        const track = this.selectedTrack();
        if (!track) {
            return t('Выберите трек', 'Select a track');
        }
        const width = Number(this.width());
        if (!Number.isFinite(width) || width <= 0) {
            return t('Ширина коридора должна быть положительным числом', 'Corridor width must be a positive number');
        }
        if (width > maxCorridorWidth) {
            return t(
                `Ширина коридора не больше ${maxCorridorWidth} м`,
                `The corridor width must not exceed ${maxCorridorWidth} m`
            );
        }
        const {start, end, totalKm} = this.getRange();
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
            return t('Введите числа для начала и конца', 'Enter valid numbers for the start and the end');
        }
        if (start < 0) {
            return t('Начало не может быть отрицательным', 'The start must not be negative');
        }
        if (start >= end) {
            return t('Начало должно быть меньше конца', 'The start must be less than the end');
        }
        if (end > totalKm + 0.1) {
            return t(
                `Конец дальше длины трека (${totalKm.toFixed(1)} км)`,
                `The end is beyond the track length (${totalKm.toFixed(1)} km)`
            );
        }
        return null;
    }

    /*
     Returns the kilometer range to search, in kilometers: the empty fields mean the whole track.
     */
    getRange() {
        const track = this.selectedTrack();
        const totalKm = track ? track.length() / 1000 : 0;
        const start = this.startKm().trim() === '' ? 0 : Number(this.startKm());
        const end = this.endKm().trim() === '' ? totalKm : Number(this.endKm());
        return {start, end, totalKm};
    }

    getSearchParams() {
        const categories = this.categories.getSelectedCategories();
        if (this.mode() === 'corridor') {
            const {start, end} = this.getRange();
            return {
                mode: 'corridor',
                track: this.selectedTrack(),
                widthMeters: Number(this.width()),
                startMeters: start * 1000,
                endMeters: end * 1000,
                categories,
            };
        }
        return {mode: 'area', bbox: this._getAreaBounds(), categories};
    }

    /*
     Shows the progress of the running search: the request counter when the search is split into
     several queries and the number of the points found so far. The progress of the last request
     stays on the screen until the results arrive.
     */
    setProgress(progress) {
        if (!progress) {
            this.progressText('');
            this.progressWidth('0%');
            return;
        }
        const parts = [];
        if (progress.sourceTitle) {
            parts.push(progress.sourceTitle);
        }
        if (progress.total > 1) {
            const done = Math.min(progress.done + 1, progress.total);
            parts.push(t(`Запрос ${done} из ${progress.total}`, `Request ${done} of ${progress.total}`));
        } else {
            parts.push(t('Идёт поиск…', 'Searching…'));
        }
        if (progress.found) {
            parts.push(t(`найдено: ${progress.found}`, `found: ${progress.found}`));
        }
        this.progressText(parts.join(' · '));
        const fraction = progress.total > 1 ? progress.done / progress.total : 1;
        this.progressWidth(`${Math.round(fraction * 100)}%`);
    }

    setSearchResults({pois, truncated, partial, searchMeta}) {
        // the parameters of the search that produced the results: the panel fields could have
        // been changed while the search was running
        this.lastSearch = searchMeta ?? {mode: this.mode(), track: this.selectedTrack(), range: this.getRange()};
        this.results(pois.map((poi) => this._createResult(poi)));
        this.keptCount(0);
        if (pois.length) {
            // the user is waiting for the results, show them right away
            this.activeTab('results');
        }
        const counts = {};
        for (const poi of pois) {
            counts[poi.categoryId] = (counts[poi.categoryId] ?? 0) + 1;
        }
        this.categories.updateCounts(counts);
        this.status(pois.length ? '' : t('Ничего не найдено', 'Nothing found'));
        const warnings = [];
        if (partial) {
            warnings.push(
                t('Часть области не загрузилась — попробуйте ещё раз', 'Part of the area failed to load — try again')
            );
        }
        if (truncated) {
            warnings.push(
                t(
                    'Показаны не все точки — сузьте область или коридор',
                    'Not all points are shown — narrow the area or the corridor'
                )
            );
        }
        this.warning(warnings.join(' '));
    }

    _createResult(poi) {
        const category = getPoiCategory(poi.categoryId);
        const info = [];
        if (poi.alongMeters !== undefined) {
            info.push(t(`км ${(poi.alongMeters / 1000).toFixed(1)}`, `km ${(poi.alongMeters / 1000).toFixed(1)}`));
        }
        if (poi.distance !== undefined) {
            info.push(formatDistance(poi.distance));
        }
        const result = {
            poi,
            category,
            name: getPoiName(poi.tags) || getCategoryTitle(category),
            categoryTitle: getCategoryTitle(category),
            iconUrl: getIconUrl(category.icon),
            infoText: info.join(' · '),
            kept: ko.observable(false),
        };
        result.kept.subscribe((kept) => this.keptCount(this.keptCount() + (kept ? 1 : -1)));
        // a click on the row (not on its checkbox) locates the point on the map and opens its popup
        result.onClick = () => {
            if (this._onShowResult) {
                this._onShowResult(result);
            }
        };
        return result;
    }

    _applyTrackDefaults() {
        const track = this.selectedTrack();
        if (!track) {
            this.startKm('');
            this.endKm('');
            return;
        }
        this.startKm('0');
        this.endKm((Math.ceil((track.length() / 1000) * 10) / 10).toFixed(1));
    }

    _startSearch() {
        this.error('');
        const error = this.validate();
        if (error) {
            this.error(error);
            return;
        }
        this._onSearch(this.getSearchParams());
    }
}

function enablePoiDiscovery(control, options = {}) {
    if (control._poiDiscoveryEnabled) {
        return;
    }

    enableTopRow(control);

    const originalOnAdd = control.onAdd;

    L.Util.extend(control, {
        _poiDiscoveryEnabled: true,

        onAdd: function (map) {
            const container = originalOnAdd.call(this, map);
            this._initPoiDiscovery();
            return container;
        },

        _initPoiDiscovery: function () {
            if (this._poiDiscoveryModel) {
                return;
            }
            this._overpassUrls = getOverpassUrls(options.overpassUrls ?? []);
            this._poiDiscoveryLayer = new PoiDiscoveryLayer();
            this._poiDiscoveryClient = new OverpassClient(
                orderOverpassUrls(this._overpassUrls, loadRememberedOverpassUrl(this._overpassUrls)),
                {
                    cacheStorage: safeLocalStorage,
                    onWorkingUrlChange: (url) => saveRememberedOverpassUrl(url, this._overpassUrls),
                }
            );
            this._poiDiscoveryModel = new PoiDiscoveryModel({
                tracklist: options.tracklist,
                getAreaBounds: () => this._getSearchAreaBounds(),
                onSearch: (params) => this._runPoiDiscoverySearch(params),
                onCancel: () => this._abortPoiDiscoverySearch(),
                onSaveWaypoints: (waypoints) => this._savePoiDiscoveryWaypoints(waypoints),
                onRectangleToggle: () => this._toggleSearchRectangle(),
                onClear: () => this._clearPoiDiscoveryResults(),
                onClose: () => this._removeSearchRectangle(),
                onShowResult: (result) => this._showPoiDiscoveryResult(result),
                onSettingsChanged: () => this._savePoiDiscoverySettings(),
            });
            this._injectPoiDiscoveryButton();
            this._initPoiDiscoveryWindow();
            this._poiDiscoveryModel.mode.subscribe((mode) => {
                if (mode !== 'area') {
                    this._removeSearchRectangle();
                }
            });
            this._poiDiscoveryModel.visible.subscribe((visible) =>
                this._poiDiscoveryButton.classList.toggle('poi-discovery-active', visible)
            );
            this._loadPoiDiscoverySettings();
            loadRuntimeKeyOnce().then(() => this._applyPoiDiscoveryOverpassUrls());
        },

        _injectPoiDiscoveryButton: function () {
            const button = L.DomUtil.create('div', 'button icon-poi-discovery');
            button.setAttribute('role', 'button');
            button.setAttribute('tabindex', '0');
            L.DomEvent.on(button, 'click', () => this._togglePoiDiscoveryWindow());
            L.DomEvent.on(button, 'keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    L.DomEvent.preventDefault(e);
                    this._togglePoiDiscoveryWindow();
                }
            });
            this._topRow.appendChild(button);
            this._poiDiscoveryButton = button;
            const title = t('Поиск POI в области или вдоль трека', 'Search POI in an area or along a track');
            button.title = title;
            button.setAttribute('aria-label', title);
        },

        _togglePoiDiscoveryWindow: function () {
            this._poiDiscoveryModel.visible(!this._poiDiscoveryModel.visible());
        },

        _initPoiDiscoveryWindow: function () {
            const container = L.DomUtil.create('div', 'leaflet-poi-discovery-dialog-wrapper');
            L.DomEvent.disableClickPropagation(container).disableScrollPropagation(container);
            container.setAttribute('data-bind', 'visible: visible');
            container.innerHTML = layout;
            ko.applyBindings(this._poiDiscoveryModel, container);
            this._map._controlContainer.appendChild(container);
            this._poiDiscoveryWindow = container;
            this._restorePoiDiscoveryWindowPosition(container);
            this._makePoiDiscoveryWindowDraggable(container);
            // the moved window keeps its own size: on a resize it is re-clamped to the new
            // visible area, so that it never sticks out of the screen
            L.DomEvent.on(
                window,
                'resize',
                () => {
                    const position = this._poiDiscoveryWindowPosition;
                    if (position) {
                        this._setPoiDiscoveryWindowPosition(container, position.left, position.top);
                    }
                },
                this
            );
        },

        /*
         The window is dragged by its header; the position is stored in the browser, so the panel
         opens where the user left it. The position is clamped, a part of the window always stays
         on the screen.
         */
        _makePoiDiscoveryWindowDraggable: function (container) {
            const header = container.querySelector('.poi-discovery-header');
            if (!header) {
                return;
            }
            L.DomEvent.on(header, 'mousedown', function (e) {
                if (e.button !== 0 || (e.target.closest && e.target.closest('button'))) {
                    return;
                }
                L.DomEvent.preventDefault(e);
                const rect = container.getBoundingClientRect();
                const startX = e.clientX;
                const startY = e.clientY;
                const startLeft = rect.left;
                const startTop = rect.top;
                function onMouseMove(moveEvent) {
                    control._setPoiDiscoveryWindowPosition(
                        container,
                        startLeft + (moveEvent.clientX - startX),
                        startTop + (moveEvent.clientY - startY)
                    );
                }
                function onMouseUp() {
                    L.DomEvent.off(document, 'mousemove', onMouseMove, control);
                    L.DomEvent.off(document, 'mouseup', onMouseUp);
                    const windowRect = container.getBoundingClientRect();
                    safeLocalStorage.setItem(
                        windowPositionStorageKey,
                        JSON.stringify({left: windowRect.left, top: windowRect.top})
                    );
                }
                L.DomEvent.on(document, 'mousemove', onMouseMove, control);
                L.DomEvent.on(document, 'mouseup', onMouseUp);
            });
        },

        _restorePoiDiscoveryWindowPosition: function (container) {
            let position = null;
            try {
                position = JSON.parse(safeLocalStorage.getItem(windowPositionStorageKey) ?? 'null');
            } catch (e) {
                logging.captureException(e, 'failed to parse the POI discovery window position');
            }
            if (position && Number.isFinite(position.left) && Number.isFinite(position.top)) {
                this._setPoiDiscoveryWindowPosition(container, position.left, position.top);
            }
        },

        _setPoiDiscoveryWindowPosition: function (container, left, topPx) {
            const margin = 40;
            const minVisible = 80;
            const maxLeft = window.innerWidth - minVisible;
            // the panel is always a bit smaller than the visible area (the same margins as in the
            // CSS), so that it never looks broken; the height is fixed while the window is moved
            // (the wrapper keeps its bottom padding inside the height because of border-box)
            const height = Math.max(240, window.innerHeight - 2 * margin);
            const clampedLeft = Math.max(0, Math.min(left, maxLeft));
            const maxTop = Math.max(0, window.innerHeight - height - 20);
            const clampedTop = Math.max(0, Math.min(topPx, maxTop));
            container.style.boxSizing = 'border-box';
            container.style.height = `${height}px`;
            container.style.bottom = 'auto';
            container.style.left = `${clampedLeft}px`;
            container.style.top = `${clampedTop}px`;
            container.style.transform = 'none';
            this._poiDiscoveryWindowPosition = {left: clampedLeft, top: clampedTop};
        },

        /*
         The endpoints follow the effective NextGIS key (user, runtime config or build time), like
         in the POI highlight panel.
         */
        _applyPoiDiscoveryOverpassUrls: function () {
            if (!this._poiDiscoveryClient) {
                return;
            }
            const urls = getOverpassUrls(options.overpassUrls ?? []);
            const previous = this._overpassUrls ?? [];
            if (urls.length === previous.length && urls.every((url, index) => url === previous[index])) {
                return;
            }
            this._overpassUrls = urls;
            this._poiDiscoveryClient.setUrls(orderOverpassUrls(urls, loadRememberedOverpassUrl(urls)));
        },

        _loadPoiDiscoverySettings: function () {
            let settings = {};
            try {
                settings = JSON.parse(safeLocalStorage.getItem(storageKey) ?? '{}');
            } catch (e) {
                logging.captureException(e, 'failed to parse POI discovery settings');
            }
            const model = this._poiDiscoveryModel;
            // the setters below trigger the settings subscriptions; a save in the middle of the
            // load would store the fields that are not applied yet (categories, sources, groups)
            this._poiDiscoverySettingsLoading = true;
            try {
                if (Array.isArray(settings.categories)) {
                    const known = new Set(poiCategories.map((category) => category.id));
                    model.setSelectedIds(settings.categories.filter((id) => known.has(id)));
                }
                if (settings.mode === 'area' || settings.mode === 'corridor') {
                    model.mode(settings.mode);
                }
                if (settings.width !== undefined && settings.width !== null) {
                    model.width(String(settings.width));
                }
                if (Array.isArray(settings.sources)) {
                    const known = new Set(poiSources.map((source) => source.id));
                    model.setSources(settings.sources.filter((id) => known.has(id)));
                }
                if (Array.isArray(settings.expandedGroups)) {
                    model.categories.setExpandedGroupIds(settings.expandedGroups);
                }
            } finally {
                this._poiDiscoverySettingsLoading = false;
            }
        },

        _savePoiDiscoverySettings: function () {
            if (!this._poiDiscoveryModel || this._poiDiscoverySettingsLoading) {
                return;
            }
            const model = this._poiDiscoveryModel;
            safeLocalStorage.setItem(
                storageKey,
                JSON.stringify({
                    mode: model.mode(),
                    width: model.width(),
                    categories: model.getSelectedIds(),
                    sources: model.getEnabledSourceIds(),
                    expandedGroups: model.categories.getExpandedGroupIds(),
                })
            );
        },

        /*
         Returns the bbox of the area to search: the drawn rectangle when it is shown, otherwise
         the current view.
         */
        _getSearchAreaBounds: function () {
            const bounds = this._searchRectangle ? this._searchRectangle.getBounds() : this._map.getBounds();
            return [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()];
        },

        _toggleSearchRectangle: function () {
            if (this._searchRectangle) {
                this._removeSearchRectangle();
                return;
            }
            this._searchRectangle = new RectangleSelect(this._map.getBounds()).addTo(this._map);
            this._poiDiscoveryModel.rectangleActive(true);
        },

        _removeSearchRectangle: function () {
            if (this._searchRectangle) {
                this._searchRectangle.removeFrom(this._map);
                this._searchRectangle = null;
            }
            if (this._poiDiscoveryModel) {
                this._poiDiscoveryModel.rectangleActive(false);
            }
        },

        /*
         Returns the track geometry as a list of parts (one per polyline): the parts are searched
         separately, so the gaps between them are not interpolated as if they were part of the
         track. Tracks whose coordinates cross the antimeridian are not supported: the track list
         unwraps the longitudes of the tracks loaded from files, but a track added by the route
         planner may keep wrapped coordinates.
         */
        _getTrackSegments: function (track) {
            const segments = [];
            for (const line of track.feature.getLayers()) {
                if (!(line instanceof L.Polyline)) {
                    continue;
                }
                const points = flattenLatLngs(line.getLatLngs()).map((latlng) => ({lat: latlng.lat, lng: latlng.lng}));
                if (points.length) {
                    segments.push(points);
                }
            }
            return segments;
        },

        _runPoiDiscoverySearch: function (params) {
            this._abortPoiDiscoverySearch();
            const model = this._poiDiscoveryModel;
            model.searching(true);
            model.error('');
            model.warning('');
            // the key could have been entered in the POI highlight panel since the last search
            this._applyPoiDiscoveryOverpassUrls();
            let searchParams;
            if (params.mode === 'corridor') {
                const trackIndex = buildSegmentsIndex(this._getTrackSegments(params.track).map((points) => ({points})));
                const parts = extractSubSegments(trackIndex, params.startMeters, params.endMeters);
                if (!parts.length) {
                    model.searching(false);
                    model.error(t('Не удалось выделить участок трека', 'Could not extract the track segment'));
                    return;
                }
                this._showCorridorLine(parts);
                searchParams = {
                    mode: 'corridor',
                    segments: parts,
                    widthMeters: params.widthMeters,
                    categories: params.categories,
                };
            } else {
                this._hideCorridorLine();
                searchParams = {mode: 'area', bbox: params.bbox, categories: params.categories};
            }
            const state = {aborted: false, handle: null};
            this._poiDiscoverySearchState = state;
            const searchMeta = {mode: model.mode(), track: model.selectedTrack(), range: model.getRange()};
            const runSources = async () => {
                const pois = [];
                let truncated = false;
                let partial = false;
                let failedSources = 0;
                const sources = model.getEnabledSources();
                let foundBefore = 0;
                for (const source of sources) {
                    const sourceTitle = sources.length > 1 ? t(source.titleRu, source.titleEn) : '';
                    const foundOffset = foundBefore;
                    let lastFound = 0;
                    const handle = source.search(searchParams, {
                        client: this._poiDiscoveryClient,
                        onProgress: (progress) => {
                            if (progress.found !== undefined) {
                                lastFound = progress.found;
                            }
                            model.setProgress({
                                ...progress,
                                found: foundOffset + lastFound,
                                sourceTitle,
                            });
                        },
                    });
                    state.handle = handle;
                    let result;
                    try {
                        result = await handle.promise;
                    } catch (e) {
                        if (state.aborted || failedSources === sources.length - 1) {
                            throw e;
                        }
                        // the other sources may still answer: show their results and warn
                        failedSources += 1;
                        partial = true;
                        logging.captureException(e, `failed to search POI in ${source.id}`);
                        continue;
                    }
                    pois.push(...result.pois);
                    foundBefore = pois.length;
                    truncated = truncated || result.truncated;
                    partial = partial || result.partial;
                }
                return {pois, truncated, partial};
            };
            runSources()
                .then(
                    (result) => {
                        if (state.aborted) {
                            return;
                        }
                        this._poiDiscoveryLayer.setPois(result.pois);
                        if (!this._map.hasLayer(this._poiDiscoveryLayer)) {
                            this._map.addLayer(this._poiDiscoveryLayer);
                        }
                        model.setSearchResults({...result, searchMeta});
                    },
                    (e) => {
                        if (state.aborted) {
                            return;
                        }
                        logging.captureException(e, 'failed to search POI');
                        model.error(t('Не удалось выполнить поиск', 'The search failed'));
                    }
                )
                .finally(() => {
                    if (this._poiDiscoverySearchState !== state) {
                        return;
                    }
                    this._poiDiscoverySearchState = null;
                    model.searching(false);
                    model.setProgress(null);
                });
        },

        /*
         Stops the running search at once: the panel stops showing the progress and the response of
         the in-flight request is not applied.
         */
        _abortPoiDiscoverySearch: function () {
            const state = this._poiDiscoverySearchState;
            if (!state) {
                return;
            }
            state.aborted = true;
            if (state.handle) {
                state.handle.abort();
            }
            this._poiDiscoverySearchState = null;
            if (this._poiDiscoveryModel) {
                this._poiDiscoveryModel.searching(false);
                this._poiDiscoveryModel.setProgress(null);
            }
        },

        _showCorridorLine: function (parts) {
            if (!this._corridorLine) {
                this._corridorLine = L.polyline([], {
                    color: '#2a6fbb',
                    weight: 4,
                    opacity: 0.7,
                    dashArray: '6 6',
                    interactive: false,
                });
            }
            this._corridorLine.setLatLngs(parts.map((part) => part.points.map((point) => [point.lat, point.lng])));
            if (!this._map.hasLayer(this._corridorLine)) {
                this._map.addLayer(this._corridorLine);
            }
        },

        _hideCorridorLine: function () {
            if (this._corridorLine && this._map.hasLayer(this._corridorLine)) {
                this._map.removeLayer(this._corridorLine);
            }
        },

        _clearPoiDiscoveryResults: function () {
            this._poiDiscoveryLayer.clear();
            this._hideCorridorLine();
        },

        /*
         Locates a point of the results on the map and opens its popup.
         */
        _showPoiDiscoveryResult: function (result) {
            if (this._poiDiscoveryLayer && this._poiDiscoveryLayer.showPoi) {
                this._poiDiscoveryLayer.showPoi(result.poi);
            }
        },

        _savePoiDiscoveryWaypoints: function (waypoints) {
            if (!waypoints.length || !options.tracklist) {
                return false;
            }
            const trackName = this._getPoiDiscoveryTrackName();
            options.tracklist.addTrack({name: trackName, points: waypoints});
            // the saved points have their own track line, the corridor highlight is not needed
            this._hideCorridorLine();
            notify(t(`Добавлен трек «${trackName}»`, `Track "${trackName}" added`));
            return true;
        },

        /*
         Names the new track after the search the results belong to, not after the current panel
         fields: the mode and the kilometer range could have been changed after the search.
         */
        _getPoiDiscoveryTrackName: function () {
            const search = this._poiDiscoveryModel.lastSearch;
            if (search && search.mode === 'corridor' && search.track) {
                return `POI: ${search.track.name()} ${search.range.start}–${search.range.end} km`;
            }
            return `POI: ${t('область', 'area')}`;
        },
    });
}

export {PoiDiscoveryModel};
export default enablePoiDiscovery;
