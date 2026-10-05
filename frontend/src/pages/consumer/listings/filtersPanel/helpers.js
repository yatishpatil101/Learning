export const tLabel = (arr, keys) =>
  keys.size
    ? [...keys].map((k) => (arr.find(([x]) => x === k) || [])[1]).filter(Boolean).join(', ')
    : '';
