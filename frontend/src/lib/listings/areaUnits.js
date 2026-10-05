import { typeGroups } from './filterRelevance.js';

export const BUILT_AREA_RANGE = [0, 6000];

const UNIT_FACTORS = {
  sqft: 1,
  sqyd: 9,
  sqm: 10.7639,
  guntha: 1089,
  acre: 43560,
  hectare: 107639.1,
};

const UNIT_LABELS = {
  sqft: 'sq.ft',
  sqyd: 'sq.yd',
  sqm: 'sq.m.',
  guntha: 'guntha',
  acre: 'acre',
  hectare: 'hectare',
};

const PROFILES = {
  built: { kind: 'built', defaultUnit: 'sqft', units: ['sqft'], max: { sqft: 6000 }, step: { sqft: 50 } },
  plot: { kind: 'plot', defaultUnit: 'sqft', units: ['sqft', 'sqyd', 'sqm'], max: { sqft: 100000, sqyd: 12000, sqm: 93000 }, step: { sqft: 500, sqyd: 50, sqm: 100 } },
  farmland: { kind: 'farmland', defaultUnit: 'acre', units: ['guntha', 'acre'], max: { guntha: 80, acre: 20 }, step: { guntha: 1, acre: 0.25 } },
};

const roundSqft = (n) => Math.round((Number(n) || 0) * UNIT_FACTORS.sqft);
const clean = (n) => {
  const fixed = Number(Number(n).toFixed(2));
  return Number.isInteger(fixed) ? String(fixed) : String(fixed);
};

export const unitLabel = (unit) => UNIT_LABELS[unit] || UNIT_LABELS.sqft;

export function areaProfileForTypes(types, preferredUnit) {
  const groups = typeGroups(types || new Set());
  const landOnly = types?.size > 0 && groups.size === 1 && groups.has('land');
  const base = landOnly ? (types.has('farmland') ? PROFILES.farmland : PROFILES.plot) : PROFILES.built;
  const unit = base.units.includes(preferredUnit) ? preferredUnit : base.defaultUnit;
  return { ...base, unit, label: unitLabel(unit), min: 0, max: base.max[unit], step: base.step[unit] };
}

export const toSqft = (value, unit) => roundSqft((Number(value) || 0) * (UNIT_FACTORS[unit] || 1));
export const fromSqft = (value, unit) => (Number(value) || 0) / (UNIT_FACTORS[unit] || 1);

export function defaultAreaRangeSqft(profile) {
  return [toSqft(profile.min, profile.unit), toSqft(profile.max, profile.unit)];
}

const sameRange = (a, b) => Number(a?.[0]) === Number(b?.[0]) && Number(a?.[1]) === Number(b?.[1]);

export function isDefaultAreaRange(range, profile) {
  return sameRange(range, defaultAreaRangeSqft(profile));
}

export function displayAreaRange(range, profile) {
  if (isDefaultAreaRange(range, profile)) return [profile.min, profile.max];
  return [fromSqft(range[0], profile.unit), fromSqft(range[1], profile.unit)];
}

export function areaBounds(range, profile) {
  if (!range || isDefaultAreaRange(range, profile)) return [undefined, undefined];
  const [lo, hi] = range;
  const [defLo, defHi] = defaultAreaRangeSqft(profile);
  return [lo === defLo ? undefined : lo, hi === defHi ? undefined : hi];
}

export function parseAreaRange(value, fallback, unit) {
  if (!value) return [...fallback];
  const parts = String(value).split('-');
  if (parts.length !== 2) return [...fallback];
  const lo = Number(parts[0]);
  const hi = Number(parts[1]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) return [...fallback];
  return [toSqft(lo, unit), toSqft(hi, unit)];
}

export function areaRangeToUrl(range, profile) {
  const [lo, hi] = displayAreaRange(range, profile);
  return `${clean(lo)}-${clean(hi)}`;
}

export function formatAreaRange(range, profile) {
  const [lo, hi] = displayAreaRange(range, profile);
  return `${clean(lo)} - ${clean(hi)} ${profile.label}`;
}

export function formatAreaValue(value, unit) {
  return `${clean(value)} ${unitLabel(unit)}`;
}
