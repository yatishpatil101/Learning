/* The localities that have a guide in src/content/localities. The edge renderer cannot read Markdown and the
   home page must not bundle it, so both read this list; vite-plugin-content-index.mjs fails the build if it drifts. */
export const GUIDE_LOCALITIES = {
  aundh: 'Aundh',
  balewadi: 'Balewadi',
  baner: 'Baner',
  hadapsar: 'Hadapsar',
  hinjawadi: 'Hinjawadi',
  kharadi: 'Kharadi',
  'koregaon-park': 'Koregaon Park',
  kothrud: 'Kothrud',
  magarpatta: 'Magarpatta',
  'pimple-saudagar': 'Pimple Saudagar',
  'viman-nagar': 'Viman Nagar',
  wakad: 'Wakad',
};

const slugOf = (name) => String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The guide slug for a listing's locality, matched by its slug and then by its name. */
export const guideSlugFor = ({ localitySlug, locality }) => [localitySlug, slugOf(locality)].find((s) => Object.hasOwn(GUIDE_LOCALITIES, s)) || null;
