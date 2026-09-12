import { LOC } from '../../../data/localityIntel.js';
import { localityByName } from '../../../data/localities.js';

export const NAMES = Object.keys(LOC);
export const SIZES = { 1: 550, 2: 800, 3: 1150 };
export const RENT_MULT = { 1: 0.7, 2: 1, 3: 1.45 };
export const SUBKEYS = Object.keys(LOC.Baner.subs);
export const DEMAND_W = { Moderate: 1, High: 2, 'Very High': 3 };
export const SUB_ICON = { Safety: 'shield-check', Connectivity: 'navigation', Schools: 'graduation-cap', Healthcare: 'heart', Lifestyle: 'sparkles', Greenery: 'trees' };

/* The livability sub-scores and demand bands are stored as English ids in the
   curated dataset, so renaming a label can never orphan the data. Only the
   readable surface is keyed — look the id up here to render it. */
export const SUB_KEYS = {
  Safety: 'locality.subSafety',
  Connectivity: 'locality.subConnectivity',
  Schools: 'locality.subSchools',
  Healthcare: 'locality.subHealthcare',
  Lifestyle: 'locality.subLifestyle',
  Greenery: 'locality.subGreenery',
};
export const DEMAND_KEYS = {
  Moderate: 'locality.demandModerate',
  High: 'locality.demandHigh',
  'Very High': 'locality.demandVeryHigh',
};

export const fmtRs = (v) => '₹' + Math.round(v).toLocaleString('en-IN');
export const scoreOf = (n) => +(SUBKEYS.reduce((s, k) => s + LOC[n].subs[k], 0) / SUBKEYS.length).toFixed(1);
export const rentOf = (n, b) => Math.round(LOC[n].rent2 * RENT_MULT[b]);
export const yieldOf = (n, b) => +(((rentOf(n, b) * 12) / (LOC[n].price * SIZES[b])) * 100).toFixed(1);
export const puneAvgPrice = Math.round(NAMES.reduce((s, n) => s + LOC[n].price, 0) / NAMES.length);
export const puneAvgYoy = +(NAMES.reduce((s, n) => s + LOC[n].yoy, 0) / NAMES.length).toFixed(1);

export function buildTrend(price, yoy, rng, locale = 'en') {
  const g = yoy / 100, yv = [];
  for (let k = 5; k >= 0; k--) yv.push(price / Math.pow(1 + g, k));
  let labels = [], data = [];
  if (rng === '5Y') { labels = ['2021', '2022', '2023', '2024', '2025', '2026']; data = yv.slice(); }
  else if (rng === '3Y') { const s = yv[2], e = yv[5], n = 12, yr = ['2023', '2024', '2025', '2026']; for (let i = 0; i <= n; i++) { data.push(s * Math.pow(e / s, i / n)); labels.push(i % 4 === 0 ? yr[i / 4] : ''); } }
  else {
    // Intl already ships short month names for hi and mr, so the 1Y axis reads in
    // the visitor's language without a hand-maintained month table to drift.
    const fmtMonth = new Intl.DateTimeFormat(locale, { month: 'short' });
    const mo = [6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5].map((m) => fmtMonth.format(new Date(2024, m, 1)));
    const s = yv[4], e = yv[5];
    for (let i = 0; i < 12; i++) { data.push(s * Math.pow(e / s, i / 11)); labels.push(mo[i]); }
  }
  data = data.map(Math.round);
  const f1 = Math.round(price * (1 + g)), f2 = Math.round(price * Math.pow(1 + g, 2));
  return { labels: labels.concat(['2027 ▸', '2028 ▸']), actual: data.concat([null, null]), fc: new Array(data.length - 1).fill(null).concat([data[data.length - 1], f1, f2]) };
}
export const metricVal = (n, m) => (m === 'price' ? LOC[n].price : m === 'rent' ? LOC[n].rent2 : m === 'yield' ? yieldOf(n, 2) : m === 'yoy' ? LOC[n].yoy : scoreOf(n));
export const metricFmt = (m) => (m === 'price' ? (v) => '₹' + (v / 1000).toFixed(1) + 'k' : m === 'rent' ? (v) => '₹' + (v / 1000).toFixed(0) + 'k' : m === 'yoy' ? (v) => v + '%' : m === 'yield' ? (v) => v + '%' : (v) => v);

export const trendGradient = (ctx) => {
  const { chart } = ctx; const { ctx: c, chartArea } = chart;
  if (!chartArea) return 'rgba(20,184,166,0.2)';
  const grad = c.createLinearGradient(0, 0, 0, 300);
  grad.addColorStop(0, 'rgba(20,184,166,0.32)'); grad.addColorStop(1, 'rgba(20,184,166,0)');
  return grad;
};

export const slugifyLoc = (n) => n.toLowerCase().replace(/\s+/g, '-');
const toRad = (d) => (d * Math.PI) / 180;
export const haversineKm = (aLat, aLng, bLat, bLng) => {
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};
// Registry coordinates for the localities that have a full insight dashboard —
// used to point an emerging locality at its nearest covered neighbours.
export const INTEL_GEO = NAMES.map((n) => {
  const r = localityByName(n);
  return r ? { name: n, slug: r.slug, lat: r.lat, lng: r.lng } : null;
}).filter(Boolean);

// Broker-style "best for" tags, derived from the livability sub-scores + demand.
export const bestForTags = (n, y) => {
  const s = LOC[n].subs, out = [];
  if (s.Safety >= 8.7) out.push(['locality.bestFamilySafe', 'shield-check']);
  if (s.Connectivity >= 8.7) out.push(['locality.bestWellConnected', 'train-front']);
  if (s.Schools >= 8.7) out.push(['locality.bestTopSchools', 'graduation-cap']);
  if (y >= 4.5) out.push(['locality.bestHighYield', 'percent']);
  if (LOC[n].demand === 'Very High') out.push(['locality.bestHotDemand', 'flame']);
  if (s.Lifestyle >= 8.7) out.push(['locality.bestVibrant', 'sparkles']);
  return out.slice(0, 5);
};

export const dColor = (d) => (d === 'Very High' ? 'bg-rose-500/15 text-rose-400' : d === 'High' ? 'bg-amber-500/15 text-amber-400' : 'bg-teal-500/15 text-teal-400');
