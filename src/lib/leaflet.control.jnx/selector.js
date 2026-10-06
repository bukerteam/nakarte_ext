import L from 'leaflet';

import './selector.css';

// Minimum size of the rectangle in degrees, to prevent it from inverting
// when a handle is dragged past the opposite side.
const MIN_SIZE = 1e-7;

// Draggable handles. Every handle changes the bounds sides listed
// in `controls`; the opposite sides stay in place.
const HANDLES = [
    {name: 'top', kind: 'edge', controls: {north: true}},
    {name: 'right', kind: 'edge', controls: {east: true}},
    {name: 'bottom', kind: 'edge', controls: {south: true}},
    {name: 'left', kind: 'edge', controls: {west: true}},
    {name: 'topleft', kind: 'corner', controls: {north: true, west: true}},
    {name: 'topright', kind: 'corner', controls: {north: true, east: true}},
    {name: 'bottomleft', kind: 'corner', controls: {south: true, west: true}},
    {name: 'bottomright', kind: 'corner', controls: {south: true, east: true}},
];

const RectangleSelect = L.Rectangle.extend({
        includes: L.Mixin.Events,

        options: {
            opacity: 1,
            weight: 0.5,
            fillOpacity: 0.2,
            color: '#3388ff',
            fillColor: '#3388ff',

        },

        onAdd: function(map) {
            L.Rectangle.prototype.onAdd.call(this, map);
            this.markers = {};
            for (const handle of HANDLES) {
                const marker = L.marker([0, 0], {
                        icon: L.divIcon({
                            className: `leaflet-rectangle-select-${handle.kind} ${handle.kind}-${handle.name}`
                        }),
                        draggable: true
                    }
                )
                    .addTo(map);
                marker._handle = handle;
                if (handle.kind === 'corner') {
                    marker._icon.style.borderColor = this.options.color;
                }
                marker.on({
                        drag: this.onHandleDrag,
                        dragend: this.onHandleDragEnd
                    }, this
                );
                this.markers[handle.name] = marker;
            }
            this.placeMarkers();
            map.on('zoomend', this.placeMarkers, this);
        },

        placeMarkers: function() {
            const bounds = this.getBounds();
            const topLeftPixel = this._map.project(bounds.getNorthWest());
            const bottomRightPixel = this._map.project(bounds.getSouthEast());
            const size = bottomRightPixel.subtract(topLeftPixel);
            let center = topLeftPixel.add(size.divideBy(2));
            center = this._map.unproject(center);
            for (const handle of HANDLES) {
                const marker = this.markers[handle.name];
                if (handle.kind === 'corner') {
                    const lat = handle.controls.north ? bounds.getNorth() : bounds.getSouth();
                    const lng = handle.controls.west ? bounds.getWest() : bounds.getEast();
                    marker.setLatLng([lat, lng]);
                } else if (handle.controls.north || handle.controls.south) {
                    const lat = handle.controls.north ? bounds.getNorth() : bounds.getSouth();
                    marker.setLatLng([lat, center.lng]);
                    marker._icon.style.width = `${size.x}px`;
                    marker._icon.style.marginLeft = `-${size.x / 2}px`;
                } else {
                    const lng = handle.controls.east ? bounds.getEast() : bounds.getWest();
                    marker.setLatLng([center.lat, lng]);
                    marker._icon.style.height = `${size.y}px`;
                    marker._icon.style.marginTop = `-${size.y / 2}px`;
                }
            }
        },

        onRemove: function(map) {
            for (let marker of Object.values(this.markers)) {
                this._map.removeLayer(marker);
            }
            this.markers = null;
            map.off('zoomend', this.placeMarkers, this);
            L.Rectangle.prototype.onRemove.call(this, map);
        },

        onHandleDrag: function(e) {
            const handle = e.target._handle;
            const latlng = e.target.getLatLng();
            const bounds = this.getBounds();
            let north = bounds.getNorth();
            let south = bounds.getSouth();
            let east = bounds.getEast();
            let west = bounds.getWest();
            if (handle.controls.north) {
                north = Math.max(latlng.lat, south + MIN_SIZE);
            }
            if (handle.controls.south) {
                south = Math.min(latlng.lat, north - MIN_SIZE);
            }
            if (handle.controls.east) {
                east = Math.max(latlng.lng, west + MIN_SIZE);
            }
            if (handle.controls.west) {
                west = Math.min(latlng.lng, east - MIN_SIZE);
            }
            this.setBounds([[north, west], [south, east]]);
        },

        onHandleDragEnd: function() {
            this.placeMarkers();
            this.fire('change');
        }
    }
);

export {RectangleSelect};
