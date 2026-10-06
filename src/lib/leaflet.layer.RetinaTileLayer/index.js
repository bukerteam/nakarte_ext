import L from 'leaflet';

class RetinaTileLayer extends L.TileLayer {
    constructor(urls, options, hiRes = 'auto') {
        const useHiResTiles = hiRes === 'auto' ? L.Browser.retina : hiRes;
        const newOptions = L.extend({}, options);
        const url = useHiResTiles ? urls[1] : urls[0];
        if (options.retinaOptionsOverrides) {
            L.extend(newOptions, options.retinaOptionsOverrides[useHiResTiles ? 1 : 0]);
        }
        super(url, newOptions);
        this.urls = urls;
    }
}

export {RetinaTileLayer};
