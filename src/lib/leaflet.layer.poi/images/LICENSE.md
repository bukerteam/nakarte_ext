# POI icons

Icons in this directory are taken from the following projects and are licensed under CC0 1.0
(public domain dedication):

- `carto/` — [openstreetmap-carto](https://github.com/openstreetmap-carto/openstreetmap-carto)
  symbols (CC0 1.0), used by the OpenStreetMap standard map style.
- `maki/` — [Maki](https://github.com/mapbox/maki) icons by Mapbox (CC0 1.0).
- `maki/marker.svg` is used as the fallback icon for categories without their own icon.

Icon references in `categories.js` use the `carto:<path under symbols/>` and `maki:<name>` forms;
`icons.js` resolves them to bundled urls. Data displayed on the POI layer is
&copy; OpenStreetMap contributors, available under the ODbL.
