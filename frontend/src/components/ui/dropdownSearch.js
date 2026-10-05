export const SEARCH_MIN_OPTIONS = 16;

export const isSearchableList = (searchable, asyncSearch, count) =>
  searchable ?? (asyncSearch ? true : count >= SEARCH_MIN_OPTIONS);
