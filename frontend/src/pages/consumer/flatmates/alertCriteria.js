/* One place turns filter state (+ active tab) into a persistable record and its display chips, so
   the empty-state card, the toolbar "Save search" and the dashboard Alerts panel cannot diverge. */
import { inr, BUDGET_MIN, BUDGET_MAX } from './helpers.js';
import { TAB_MOVE_IN, TAB_TEAM_UP, normalizeTab } from './model.js';

/* Budget persists as two scalars, both `undefined` when untouched: a stored 40000 would be
   indistinguishable from a real ₹40,000 ceiling. */
const budgetFields = (budget) => ({
  budget: budget[1] < BUDGET_MAX ? budget[1] : undefined,
  budgetMin: budget[0] > BUDGET_MIN ? budget[0] : undefined,
});

/* Human text for a record's budget, or null when it narrows nothing. Reads off the two persisted
   scalars, so a ceiling-only alert works unchanged. */
function budgetText(rec) {
  const lo = rec.budgetMin != null && rec.budgetMin > BUDGET_MIN ? rec.budgetMin : null;
  const hi = rec.budget != null && rec.budget < BUDGET_MAX ? rec.budget : null;
  if (lo && hi) return `${inr(lo)} – ${inr(hi)}`;
  if (hi) return `≤ ${inr(hi)}`;
  if (lo) return `≥ ${inr(lo)}`;
  return null;
}

const TAB_META = {
  [TAB_MOVE_IN]: { icon: 'door-open', word: 'Move in now' },
  [TAB_TEAM_UP]: { icon: 'users-round', word: 'Team up' },
};

const GENDER_LBL = { female: 'Women', male: 'Men' };
const HABIT_LBL = { Vegetarian: 'Veg', 'Pet-friendly': 'Pet OK' };

const isDateVal = (v) => typeof v === 'string' && v.includes('-');
const fmtDate = (iso) => {
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
  catch { return iso; }
};

export function tabMeta(tab) {
  // Alerts persist their tab, so resolve legacy values rather than mislabelling.
  return TAB_META[normalizeTab(tab)] || TAB_META[TAB_MOVE_IN];
}

/* Human move-in chip text, or null when the move-in filter is off. */
function moveInText(rec) {
  if (rec.moveIn === 'now') return 'Move-in: Immediate';
  if (isDateVal(rec.moveIn)) return `Move-in by ${fmtDate(rec.moveIn)}`;
  return null;
}

/* Short human summary of the whole search (used as the alert label). */
export function flatmateAlertLabel(rec) {
  const parts = [tabMeta(rec.tab).word];
  if (rec.locality) parts.push(rec.locality);
  const budget = budgetText(rec);
  if (budget) parts.push(budget);
  if (rec.gender) parts.push(GENDER_LBL[rec.gender] || rec.gender);
  if (rec.tab === TAB_TEAM_UP && rec.sharing) parts.push(`${rec.sharing} sharing`);
  if (rec.attachedBath) parts.push('Attached bath');
  if (rec.verifiedOnly) parts.push('Verified');
  return parts.join(' · ');
}

/* Records only filters the active tab honours, mirroring the tab-gated FilterBar so a stale value
   never rides along invisibly. */
export function buildFlatmateAlertRecord(filters, tab) {
  const rec = {
    kind: 'flatmates',
    tab,
    q: filters.q || '',
    locality: filters.locality || '',
    ...budgetFields(filters.budget),
    moveIn: filters.moveIn || '',
    gender: filters.gender || '',
    sharing: tab === TAB_TEAM_UP ? (filters.sharing || '') : '',
    attachedBath: tab === TAB_MOVE_IN ? !!filters.attachedBath : false,
    verifiedOnly: !!filters.verifiedOnly,
    habits: [...(filters.habits || [])],
  };
  rec.label = flatmateAlertLabel(rec);
  return rec;
}

/* Normalised list of display chips for a flatmates alert record. */
export function flatmateCriteriaChips(rec) {
  const meta = tabMeta(rec.tab);
  const chips = [{ icon: meta.icon, text: meta.word }];

  if (rec.locality) chips.push({ icon: 'map-pin', text: rec.locality });
  const budget = budgetText(rec);
  if (budget) chips.push({ icon: 'wallet', text: `${budget}/mo` });

  const move = moveInText(rec);
  if (move) chips.push({ icon: 'calendar', text: move });

  if (rec.gender) chips.push({ icon: 'user', text: GENDER_LBL[rec.gender] || rec.gender });
  if (rec.tab === TAB_TEAM_UP && rec.sharing) chips.push({ icon: 'users-round', text: `${rec.sharing} sharing` });
  if (rec.attachedBath) chips.push({ icon: 'bath', text: 'Attached bath' });
  if (rec.verifiedOnly) chips.push({ icon: 'shield-check', text: 'Verified only' });
  (rec.habits || []).forEach((h) => chips.push({ icon: 'sparkles', text: HABIT_LBL[h] || h }));

  return chips;
}
