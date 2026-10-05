import ko from 'knockout';
import L from 'leaflet';

import {RectangleSelect} from '~/lib/leaflet.control.jnx/selector';

const BOUNDS_PADDING_RATIO = 0.1;
const MIN_BOUNDS_PADDING = 0.01;

// Bounds around all points of a track with some padding, so that the points
// are strictly inside the initial selection rectangle.
function getPointsBounds(points) {
    const bounds = L.latLngBounds([]);
    for (const point of points) {
        bounds.extend(point.latlng);
    }
    const latPadding = (bounds.getNorth() - bounds.getSouth()) * BOUNDS_PADDING_RATIO || MIN_BOUNDS_PADDING;
    const lngPadding = (bounds.getEast() - bounds.getWest()) * BOUNDS_PADDING_RATIO || MIN_BOUNDS_PADDING;
    return L.latLngBounds(
        [bounds.getSouth() - latPadding, bounds.getWest() - lngPadding],
        [bounds.getNorth() + latPadding, bounds.getEast() + lngPadding]
    );
}

function filterPointsInBounds(points, bounds) {
    return points.filter((point) => bounds.contains(point.latlng));
}

class PointsSelectionToolbar {
    constructor({container, getTrackCount, onDelete, onCopy, onMove, onCancel}) {
        this.isTargeting = ko.observable(false);
        this.count = ko.observable(0);
        this.canDelete = ko.pureComputed(() => this.count() > 0);
        this.canCopyMove = ko.pureComputed(() => this.count() > 0 && getTrackCount() > 1);
        this.hint = ko.pureComputed(() => {
            if (this.isTargeting()) {
                return 'Click target track in list or on map';
            }
            const count = this.count();
            return `${count} point${count === 1 ? '' : 's'} selected`;
        });
        this.onDelete = onDelete;
        this.onCopy = onCopy;
        this.onMove = onMove;
        this.onCancel = onCancel;

        this._element = L.DomUtil.create('div', 'points-selection-toolbar', container);
        L.DomEvent.disableClickPropagation(this._element);
        this._element.innerHTML = `
            <span class="points-selection-count" data-bind="text: hint"></span>
            <button class="points-btn points-btn-delete" type="button"
                data-bind="click: onDelete, enable: canDelete, visible: !isTargeting()">Delete</button>
            <button class="points-btn points-btn-copy" type="button"
                data-bind="click: onCopy, enable: canCopyMove, visible: !isTargeting()">Copy</button>
            <button class="points-btn points-btn-move" type="button"
                data-bind="click: onMove, enable: canCopyMove, visible: !isTargeting()">Move</button>
            <button class="points-btn points-btn-cancel" type="button"
                data-bind="click: onCancel">Cancel</button>
        `;
        ko.applyBindings(this, this._element);
    }

    destroy() {
        ko.cleanNode(this._element);
        this._element.parentNode.removeChild(this._element);
    }
}

// Interactive selection of track points. Has two mutually exclusive modes:
// - selection: a draggable rectangle picks points of one track;
// - targeting: the picked points are copied/moved to a track chosen by
//   a click on a track row or on a track segment.
class PointsSelection {
    constructor({map, trackListContainer, getTrackCount, getTrackColor, resolveTrackFromRow, onApply, onActivate}) {
        this._map = map;
        this._trackListContainer = trackListContainer;
        this._getTrackCount = getTrackCount;
        this._getTrackColor = getTrackColor;
        this._resolveTrackFromRow = resolveTrackFromRow;
        this._onApply = onApply;
        this._onActivate = onActivate;
        this._selection = null;
        this._targeting = null;
        this._highlightLayer = null;
        this._toolbar = null;
        this._rowClickHandler = null;
        this._onKeyDown = (e) => {
            if (e.keyCode === 27) {
                this.cancel();
            }
        };
    }

    start(track) {
        this.cancel();
        if (!track.markers.length) {
            return;
        }
        const selector = new RectangleSelect(getPointsBounds(track.markers)).addTo(this._map);
        selector.on('change', this._updateSelection, this);
        this._selection = {sourceTrack: track, selector: selector, points: []};
        this._beginInteraction();
        this._updateSelection();
    }

    startTargeting(track, points, action) {
        this.cancel();
        if (!points.length || this._getTrackCount() < 2) {
            return;
        }
        this._beginInteraction();
        this._startTargeting(track, points, action);
    }

    cancel() {
        if (!this._selection && !this._targeting) {
            return;
        }
        if (this._selection) {
            this._selection.selector.off('change', this._updateSelection, this);
            this._map.removeLayer(this._selection.selector);
            this._selection = null;
        }
        this._targeting = null;
        if (this._highlightLayer) {
            this._map.removeLayer(this._highlightLayer);
            this._highlightLayer = null;
        }
        if (this._toolbar) {
            this._toolbar.destroy();
            this._toolbar = null;
        }
        if (this._rowClickHandler) {
            const table = this._trackListContainer.querySelector('.tracks-rows');
            if (table) {
                table.removeEventListener('click', this._rowClickHandler, true);
            }
            this._rowClickHandler = null;
        }
        L.DomUtil.removeClass(this._map.getContainer(), 'leaflet-points-selecting');
        L.DomUtil.removeClass(this._trackListContainer, 'points-target-selecting');
        L.DomEvent.off(document, 'keydown', this._onKeyDown, this);
    }

    cancelIfSourceTrack(track) {
        const mode = this._selection || this._targeting;
        if (mode && mode.sourceTrack === track) {
            this.cancel();
        }
    }

    // Returns true if the click was consumed by the selection.
    handleSegmentClick(trackSegment, e) {
        const targeting = this._targeting;
        if (!targeting) {
            return false;
        }
        const track = trackSegment._parentTrack;
        if (track && track !== targeting.sourceTrack) {
            L.DomEvent.stopPropagation(e);
            this._executeAction(track);
        }
        return true;
    }

    _beginInteraction() {
        this._highlightLayer = L.featureGroup([]).addTo(this._map);
        L.DomUtil.addClass(this._map.getContainer(), 'leaflet-points-selecting');
        L.DomEvent.on(document, 'keydown', this._onKeyDown, this);
        this._toolbar = new PointsSelectionToolbar({
            container: this._map.getContainer(),
            getTrackCount: this._getTrackCount,
            onDelete: () => this._deleteSelected(),
            onCopy: () => this._startCopyMove('copy'),
            onMove: () => this._startCopyMove('move'),
            onCancel: () => this.cancel(),
        });
        this._onActivate();
    }

    _updateSelection() {
        const selection = this._selection;
        if (!selection) {
            return;
        }
        selection.points = filterPointsInBounds(selection.sourceTrack.markers, selection.selector.getBounds());
        this._updateHighlights(selection.sourceTrack, selection.points);
        this._toolbar.count(selection.points.length);
    }

    _updateHighlights(sourceTrack, points) {
        this._highlightLayer.clearLayers();
        const color = this._getTrackColor(sourceTrack);
        for (const point of points) {
            L.circleMarker(point.latlng, {
                radius: 12,
                color: color,
                weight: 2,
                fillColor: color,
                fillOpacity: 0.3,
                interactive: false,
            }).addTo(this._highlightLayer);
        }
    }

    _deleteSelected() {
        const selection = this._selection;
        if (!selection || !selection.points.length) {
            return;
        }
        this._onApply({action: 'delete', sourceTrack: selection.sourceTrack, points: selection.points});
        this.cancel();
    }

    _startCopyMove(action) {
        const selection = this._selection;
        if (!selection || !selection.points.length) {
            return;
        }
        const {sourceTrack, points} = selection;
        // Freeze the selection: the rectangle is no longer editable, so the
        // set of points cannot change after the action was chosen.
        selection.selector.off('change', this._updateSelection, this);
        this._map.removeLayer(selection.selector);
        this._selection = null;
        this._startTargeting(sourceTrack, points, action);
    }

    _startTargeting(sourceTrack, points, action) {
        this._targeting = {sourceTrack: sourceTrack, points: points, action: action};
        this._toolbar.isTargeting(true);
        this._updateHighlights(sourceTrack, points);
        L.DomUtil.addClass(this._trackListContainer, 'points-target-selecting');
        const table = this._trackListContainer.querySelector('.tracks-rows');
        this._rowClickHandler = (e) => {
            const row = e.target.closest('tr');
            if (!row) {
                return;
            }
            const targetTrack = this._resolveTrackFromRow(row);
            if (!targetTrack || targetTrack === sourceTrack) {
                return;
            }
            e.stopPropagation();
            e.preventDefault();
            this._executeAction(targetTrack);
        };
        table.addEventListener('click', this._rowClickHandler, true);
    }

    _executeAction(targetTrack) {
        const targeting = this._targeting;
        if (!targeting) {
            return;
        }
        this._onApply({
            action: targeting.action,
            sourceTrack: targeting.sourceTrack,
            targetTrack: targetTrack,
            points: targeting.points,
        });
        this.cancel();
    }
}

export {PointsSelection, getPointsBounds, filterPointsInBounds};
