/*
 Category picker shared by the POI highlight panel and the POI discovery panel: groups with
 tri-state headers, a title search filter, per-category selection and found counts.
 */

import ko from 'knockout';

import './categories.css';
import {t} from '~/lib/lang';

import {poiGroups} from './categories';
import {getIconUrl} from './icons';

/*
 The indeterminate state is not a knockout built-in binding, and both category pickers need it.
 */
if (!ko.bindingHandlers.indeterminate) {
    ko.bindingHandlers.indeterminate = {
        update: function (element, valueAccessor) {
            element.indeterminate = Boolean(ko.unwrap(valueAccessor()));
        },
    };
}

function createCategoryModel(category, onSelectionChange) {
    const model = {
        id: category.id,
        category,
        title: t(category.titleRu, category.titleEn),
        searchText: `${category.titleRu} ${category.titleEn}`.toLowerCase(),
        tooltip: `${category.titleRu} / ${category.titleEn}`,
        iconUrl: getIconUrl(category.icon),
        selected: ko.observable(false),
        count: ko.observable(0),
        onChanged: () => onSelectionChange(),
    };
    model.countText = ko.pureComputed(() => (model.count() ? `(${model.count()})` : ''));
    return model;
}

/*
 Only the passed categories are toggled, so a group header does not enable categories hidden by
 the search filter.
 */
function createGroupSelection(categories, onSelectionChange) {
    return ko.pureComputed({
        read: () => categories.every((category) => category.selected()),
        write: (value) => {
            for (const category of categories) {
                category.selected(Boolean(value));
            }
            onSelectionChange();
        },
    });
}

function createSomeSelected(categories) {
    return ko.pureComputed(() => {
        const selectedCount = categories.filter((category) => category.selected()).length;
        return selectedCount > 0 && selectedCount < categories.length;
    });
}

function createGroupModel(group, allCategories, onSelectionChange) {
    const categories = group.categories.map((category) => createCategoryModel(category, onSelectionChange));
    allCategories.push(...categories);
    const model = {
        id: group.id,
        title: t(group.titleRu, group.titleEn),
        searchText: `${group.titleRu} ${group.titleEn}`.toLowerCase(),
        categories,
        allSelected: createGroupSelection(categories, onSelectionChange),
        someSelected: createSomeSelected(categories),
        // the groups are collapsed by default; the state is persisted by the panels that use it
        expanded: ko.observable(false),
    };
    model.onToggleExpanded = () => {
        model.expanded(!model.expanded());
        onSelectionChange();
    };
    return model;
}

/*
 The filtered view builds new group objects, so that a group header toggles only the categories
 visible under the current search. A non-empty search shows the groups expanded.
 */
function filterGroups(model, onSelectionChange) {
    const query = model.query().trim().toLowerCase();
    const result = [];
    for (const group of model.groups) {
        const groupMatches = query && group.searchText.includes(query);
        const categories = groupMatches
            ? group.categories
            : group.categories.filter((category) => !query || category.searchText.includes(query));
        if (categories.length) {
            result.push({
                id: group.id,
                title: group.title,
                categories,
                allSelected: createGroupSelection(categories, onSelectionChange),
                someSelected: createSomeSelected(categories),
                expanded: ko.pureComputed(() => Boolean(query) || group.expanded()),
                onToggleExpanded: group.onToggleExpanded,
            });
        }
    }
    return result;
}

function createCategoriesModel({onSelectionChange}) {
    const allCategories = [];
    const groups = poiGroups.map((group) => createGroupModel(group, allCategories, onSelectionChange));
    const model = {
        query: ko.observable(''),
        groups,
        allCategories,
        getSelectedIds() {
            return allCategories.filter((category) => category.selected()).map((category) => category.id);
        },
        getSelectedCategories() {
            return allCategories.filter((category) => category.selected()).map((category) => category.category);
        },
        setSelectedIds(ids) {
            const selected = new Set(ids);
            for (const category of allCategories) {
                category.selected(selected.has(category.id));
            }
        },
        /*
         The collapsed/expanded state of the groups, persisted by the panel.
         */
        getExpandedGroupIds() {
            return groups.filter((group) => group.expanded()).map((group) => group.id);
        },
        setExpandedGroupIds(ids) {
            const expanded = new Set(ids);
            for (const group of groups) {
                group.expanded(expanded.has(group.id));
            }
        },
        updateCounts(counts) {
            for (const category of allCategories) {
                category.count(counts[category.id] ?? 0);
            }
        },
        onSelectAll() {
            for (const category of allCategories) {
                category.selected(true);
            }
            onSelectionChange();
        },
        onClearAll() {
            for (const category of allCategories) {
                category.selected(false);
            }
            onSelectionChange();
        },
    };
    model.visibleGroups = ko.pureComputed(() => filterGroups(model, onSelectionChange));
    return model;
}

export {createCategoriesModel};
