import { useEffect, useState } from 'react';
import { getLocality } from '../../../services/localityService.js';
import { slugOfName } from '../../../lib/searchEntities.js';

export const localitySlugOf = (p) => p?.localitySlug || slugOfName(p?.locality);

const TTL_MS = 30_000;
const inflight = new Map();

const fetchLocality = (slug) => {
  if (!inflight.has(slug)) {
    const drop = () => inflight.delete(slug);
    const req = getLocality(slug);
    req.then(() => setTimeout(drop, TTL_MS), drop);
    inflight.set(slug, req);
  }
  return inflight.get(slug);
};

/** The property's locality from GET /localities/{slug} (listing-derived figures), or null until it loads / if unknown. */
export function useLocalityStats(p) {
  const slug = localitySlugOf(p);
  const [state, setState] = useState({ slug: '', loc: null });
  useEffect(() => {
    if (!slug) return undefined;
    let alive = true;
    fetchLocality(slug).then((loc) => { if (alive) setState({ slug, loc }); }).catch(() => {});
    return () => { alive = false; };
  }, [slug]);
  return state.slug === slug ? state.loc : null;
}
