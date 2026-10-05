export const HEADLINE_MAX = 120;

/** What gets posted: the poster's own words, else the suggestion they left in the placeholder. */
export const headlineOf = (typed, suggestion) => (String(typed ?? '').trim() || suggestion || '').slice(0, HEADLINE_MAX);
