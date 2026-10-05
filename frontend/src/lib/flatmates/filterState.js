import { clampNearRadius, nearMaxFor } from '../nearParams.js';

const STORAGE_KEY = 'draazy.flatmates.lastSearch.v1';
const DEFAULT_SORT = 'verified';
const VALID_SORTS = new Set(['match', 'verified', 'newest', 'budget-low', 'budget-high']);
const VALID_GENDERS = new Set(['male', 'female']);
const VALID_SHARING = new Set(['2', '3', '4', '5', '6']);
const VALID_HABITS = new Set(['Non-smoker', 'Vegetarian', 'Pet-friendly']);
const VALID_NEAR_MODES = new Set(['km', 'min']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NEAR_RE = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

const FILTER_PARAM_KEYS = [
  'q', 'loc', 'g', 'budget', 'movein', 'sharing', 'v', 'bath', 'habits',
  'near', 'nearlabel', 'nearr', 'nearmode',
];
const STATE_PARAM_KEYS = [...FILTER_PARAM_KEYS, 'sort', 'view', '__proto__', 'prototype', 'constructor'];

const fieldByParam = Object.assign(Object.create(null), {
  q: 'q',
  loc: 'locality',
  g: 'gender',
  sharing: 'sharing',
});

const cloneFilters = (defaults) => ({
  ...defaults,
  budget: [...defaults.budget],
  habits: [...defaults.habits],
});

const parseBudget = (value, defaults) => {
  if (!value) return [...defaults.budget];
  const parts = value.split('-');
  if (parts.length !== 2) return [...defaults.budget];
  const lo = Number(parts[0]);
  const hi = Number(parts[1]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) return [...defaults.budget];
  return [Math.max(defaults.budget[0], lo), Math.min(defaults.budget[1], hi)];
};

const budgetsEqual = (a, b) => a[0] === b[0] && a[1] === b[1];
const budgetChanged = (value, defaults) => !budgetsEqual(value, defaults.budget);
const splitCsv = (value) => (value ? value.split(',').map((item) => item.trim()).filter(Boolean) : []);
const findLocality = (value, localities) => {
  const needle = value.trim().toLowerCase();
  return localities.find((locality) => locality.toLowerCase() === needle) || '';
};

export const hasFlatmateSearchParams = (params) => params.toString() !== '';

export function flatmateFiltersFromParams(params, defaults, localities) {
  const filters = cloneFilters(defaults);
  const get = (key) => params.get(key) || '';

  Object.entries(fieldByParam).forEach(([param, field]) => {
    const value = field === 'q' ? get(param) : get(param).trim();
    if (!value) return;
    if (field === 'locality') {
      const locality = findLocality(value, localities);
      if (locality) filters.locality = locality;
    } else if (field === 'gender') {
      if (VALID_GENDERS.has(value)) filters.gender = value;
    } else if (field === 'sharing') {
      if (VALID_SHARING.has(value)) filters.sharing = value;
    } else {
      filters[field] = value;
    }
  });

  filters.budget = parseBudget(get('budget'), defaults);
  const moveIn = get('movein');
  if (moveIn === 'now' || DATE_RE.test(moveIn)) filters.moveIn = moveIn;
  if (get('v') === '1') filters.verifiedOnly = true;
  if (get('bath') === '1') filters.attachedBath = true;
  filters.habits = splitCsv(get('habits')).filter((habit) => VALID_HABITS.has(habit));

  const near = get('near').trim();
  if (NEAR_RE.test(near)) {
    filters.near = near;
    filters.nearLabel = get('nearlabel') || 'Selected place';
    const mode = get('nearmode');
    if (VALID_NEAR_MODES.has(mode)) filters.nearMode = mode;
    const radius = Number(get('nearr'));
    if (Number.isFinite(radius) && radius > 0) filters.nearRadius = clampNearRadius(radius, nearMaxFor(filters.nearMode));
  }

  return filters;
}

export function flatmateFiltersToParams(filters, defaults) {
  const params = Object.create(null);
  if (filters.q) params.q = filters.q;
  if (filters.locality) params.loc = filters.locality;
  if (filters.gender) params.g = filters.gender;
  if (budgetChanged(filters.budget, defaults)) params.budget = `${filters.budget[0]}-${filters.budget[1]}`;
  if (filters.moveIn) params.movein = filters.moveIn;
  if (filters.sharing) params.sharing = String(filters.sharing);
  if (filters.verifiedOnly) params.v = '1';
  if (filters.attachedBath) params.bath = '1';
  if (filters.habits.length) params.habits = filters.habits.join(',');
  if (filters.near) {
    params.near = filters.near;
    if (filters.nearLabel) params.nearlabel = filters.nearLabel;
    params.nearr = String(filters.nearRadius || defaults.nearRadius);
    params.nearmode = filters.nearMode || defaults.nearMode;
  }
  return params;
}

export function flatmateFiltersEqual(a, b) {
  return a.q === b.q
    && a.locality === b.locality
    && budgetsEqual(a.budget, b.budget)
    && a.moveIn === b.moveIn
    && a.gender === b.gender
    && a.sharing === b.sharing
    && a.verifiedOnly === b.verifiedOnly
    && a.attachedBath === b.attachedBath
    && a.near === b.near
    && a.nearLabel === b.nearLabel
    && a.nearRadius === b.nearRadius
    && a.nearMode === b.nearMode
    && a.habits.length === b.habits.length
    && a.habits.every((habit, index) => habit === b.habits[index]);
}

export function flatmateFiltersActive(filters, defaults) {
  return Object.keys(flatmateFiltersToParams(filters, defaults)).length > 0;
}

export function applyFlatmateStateToSearchParams(params, filters, defaults, { sort = DEFAULT_SORT, tab }) {
  const next = new URLSearchParams(params);
  STATE_PARAM_KEYS.forEach((key) => next.delete(key));
  Object.entries(flatmateFiltersToParams(filters, defaults)).forEach(([key, value]) => next.set(key, value));
  if (sort && sort !== DEFAULT_SORT) next.set('sort', sort);
  if (tab && tab !== 'move-in') next.set('view', tab);
  return next;
}

export function sortFromParams(params) {
  const sort = params.get('sort');
  return VALID_SORTS.has(sort) ? sort : DEFAULT_SORT;
}

export function readRememberedFlatmateSearch(defaults, localities) {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const source = stored && typeof stored === 'object' && stored.filters && typeof stored.filters === 'object'
      ? stored.filters
      : null;
    if (!source) return null;
    const filters = cloneFilters(defaults);
    ['q', 'moveIn', 'near', 'nearLabel', 'nearMode'].forEach((key) => {
      if (Object.hasOwn(source, key) && typeof source[key] === 'string') filters[key] = source[key];
    });
    if (Object.hasOwn(source, 'locality') && typeof source.locality === 'string') {
      filters.locality = findLocality(source.locality, localities);
    }
    if (Object.hasOwn(source, 'gender') && VALID_GENDERS.has(source.gender)) filters.gender = source.gender;
    if (Object.hasOwn(source, 'sharing') && VALID_SHARING.has(String(source.sharing))) filters.sharing = String(source.sharing);
    if (Object.hasOwn(source, 'budget') && Array.isArray(source.budget)) filters.budget = parseBudget(source.budget.join('-'), defaults);
    if (Object.hasOwn(source, 'verifiedOnly')) filters.verifiedOnly = source.verifiedOnly === true;
    if (Object.hasOwn(source, 'attachedBath')) filters.attachedBath = source.attachedBath === true;
    if (Object.hasOwn(source, 'habits') && Array.isArray(source.habits)) {
      filters.habits = source.habits.filter((habit) => VALID_HABITS.has(habit));
    }
    if (!NEAR_RE.test(filters.near)) {
      filters.near = '';
      filters.nearLabel = '';
      filters.nearRadius = defaults.nearRadius;
      filters.nearMode = defaults.nearMode;
    }
    if (!VALID_NEAR_MODES.has(filters.nearMode)) filters.nearMode = defaults.nearMode;
    const radius = Number(source.nearRadius);
    if (Number.isFinite(radius) && radius > 0) filters.nearRadius = clampNearRadius(radius, nearMaxFor(filters.nearMode));
    return flatmateFiltersActive(filters, defaults) ? filters : null;
  } catch {
    return null;
  }
}

export function saveRememberedFlatmateSearch(filters, defaults) {
  try {
    if (!flatmateFiltersActive(filters, defaults)) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      filters: {
        q: filters.q,
        locality: filters.locality,
        budget: [...filters.budget],
        moveIn: filters.moveIn,
        gender: filters.gender,
        sharing: filters.sharing,
        verifiedOnly: filters.verifiedOnly,
        attachedBath: filters.attachedBath,
        habits: [...filters.habits],
        near: filters.near,
        nearLabel: filters.nearLabel,
        nearRadius: filters.nearRadius,
        nearMode: filters.nearMode,
      },
      savedAt: Date.now(),
    }));
  } catch {
    /* ignore */
  }
}

export function clearRememberedFlatmateSearch() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
