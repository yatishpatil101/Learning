// Pure label/option helpers shared across the filter panel sections.
export const tLabel = (arr, keys) =>
  keys.size
    ? [...keys].map((k) => (arr.find(([x]) => x === k) || [])[1]).filter(Boolean).join(', ')
    : '';

export const optsOf = (arr) => arr.map(([value, label]) => ({ value, label }));
