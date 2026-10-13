/*
 Categories of the POI discovery results. The OSM points use the shared catalog; the other sources
 have their own pseudo-categories, so that the results list and the map layer can show an icon and
 a title for them.
 */

import {poiCategories} from '~/lib/leaflet.layer.poi/categories';

const sourceCategories = [
    {
        id: 'wikidata_place',
        titleRu: 'Достопримечательность (Wikidata)',
        titleEn: 'Attraction (Wikidata)',
        icon: 'maki:monument',
    },
    {
        id: 'inat_species',
        titleRu: 'Наблюдение вида (iNaturalist)',
        titleEn: 'Species observation (iNaturalist)',
        icon: 'maki:park',
    },
];

const categoriesById = new Map(poiCategories.map((category) => [category.id, category]));
for (const category of sourceCategories) {
    categoriesById.set(category.id, category);
}

function getPoiCategory(id) {
    return categoriesById.get(id);
}

export {getPoiCategory};
