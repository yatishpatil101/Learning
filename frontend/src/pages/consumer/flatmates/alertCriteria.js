/* Flatmates alert/saved-search criteria helpers.
   The flatmates analog of listings/alertCriteria.js: turns the live Flatmates
   filter state (+ active tab) into (a) a persistable saved-search/alert record and
   (b) display chips + a short label. Used by the empty-state "Get alerted" card, the
   toolbar "Save search" action, and the dashboard Alerts panel so every surface
   captures and shows the SAME filter set — intent (Move in now / Team up), locality,
   budget, move-in, gender, group size, verified-only and lifestyle habits. */
import { inr } from './helpers.js';
import { TAB_MOVE_IN, TAB_TEAM_UP, normalizeTab } from './model.js';

// Budget slider maxes at 40000 = "Any"; anything below is a real ceiling.
const BUDGET_MAX = 40000;

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
  if (rec.budget != null && rec.budget < BUDGET_MAX) parts.push(`≤ ${inr(rec.budget)}`);
  if (rec.gender) parts.push(GENDER_LBL[rec.gender] || rec.gender);
  if (rec.tab === TAB_TEAM_UP && rec.sharing) parts.push(`${rec.sharing} sharing`);
  if (rec.attachedBath) parts.push('Attached bath');
  if (rec.verifiedOnly) parts.push('Verified');
  return parts.join(' · ');
}

/* Convert live Flatmates filter state (+ active tab) into a plain, persistable
   alert payload. Only records filters the active tab actually honours, mirroring
   the tab-gated FilterBar so a stale value never rides along invisibly. */
export function buildFlatmateAlertRecord(filters, tab) {
  const rec = {
    kind: 'flatmates',
    tab,
    q: filters.q || '',
    locality: filters.locality || '',
    budget: filters.budget < BUDGET_MAX ? filters.budget : undefined,
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
  if (rec.budget != null && rec.budget < BUDGET_MAX) chips.push({ icon: 'wallet', text: `≤ ${inr(rec.budget)}/mo` });

  const move = moveInText(rec);
  if (move) chips.push({ icon: 'calendar', text: move });

  if (rec.gender) chips.push({ icon: 'user', text: GENDER_LBL[rec.gender] || rec.gender });
  if (rec.tab === TAB_TEAM_UP && rec.sharing) chips.push({ icon: 'users-round', text: `${rec.sharing} sharing` });
  if (rec.attachedBath) chips.push({ icon: 'bath', text: 'Attached bath' });
  if (rec.verifiedOnly) chips.push({ icon: 'shield-check', text: 'Verified only' });
  (rec.habits || []).forEach((h) => chips.push({ icon: 'sparkles', text: HABIT_LBL[h] || h }));

  return chips;
}
