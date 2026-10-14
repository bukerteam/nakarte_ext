/*
 OpenStreetMap source: the area mode queries a bbox, the corridor mode queries the neighborhoods
 of the track and filters the candidates by the distance to the geometry (see ../search).
 */

import {searchArea, searchCorridor} from '../search';

const osmSource = {
    id: 'osm',
    titleRu: 'OpenStreetMap',
    titleEn: 'OpenStreetMap',
    attribution: '© OpenStreetMap contributors (ODbL)',
    // the OSM points are colored by their category group, not by the source
    color: null,
    isConfigured: () => true,
    search: (params, context) => {
        const handle =
            params.mode === 'corridor' ? searchCorridor({...params, ...context}) : searchArea({...params, ...context});
        return {
            ...handle,
            promise: handle.promise.then((result) => ({
                ...result,
                pois: result.pois.map((poi) => ({...poi, sourceId: osmSource.id})),
            })),
        };
    },
};

export {osmSource};
