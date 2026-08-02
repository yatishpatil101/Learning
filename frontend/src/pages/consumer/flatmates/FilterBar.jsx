import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import NativeSelect from '../../../components/ui/NativeSelect.jsx';
import Select from '../../../components/ui/Select.jsx';
import LocalitySelect from '../../../components/ui/LocalitySelect.jsx';
import DateField from '../../../components/ui/DateField.jsx';
import NearPlaceField from './NearPlaceField.jsx';
import { LOCALITIES } from './constants.js';
import { TAB_MOVE_IN, TAB_TEAM_UP } from './model.js';

// A move-in filter value is either the sentinel 'now' (immediate), '' (any) or an
// ISO date string from the picker — only the last contains a '-'.
const isDateVal = (v) => typeof v === 'string' && v.includes('-');
// Local-time today as ISO, used to stop the picker offering past move-in dates.
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// One labelled cell. On desktop these sit in a 3-column grid so every label and
// control lines up; in the mobile drawer they stack full-width. `className` lets a
// cell claim explicit grid placement (e.g. Near-a-place owns the tall right column).
function Field({ label, children, className = '' }) {
  return (
    <div className={'min-w-0 ' + className}>
      <label className="block text-xs font-medium text-gray-400 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

// The things that narrow the results, grouped together. Layout (grid vs
// stack) is owned by the parent — these cells just fill their column.
// Desktop uses a 3-column grid: "Near a place" claims the whole right column
// (col 3, spanning the rows) so its taller radius panel has room to open
// downward instead of inflating the first row and voiding its neighbours. The
// remaining filters flow through columns 1–2 (Budget, Locality on top; then
// Move-in/Looking-for; then Lifestyle/Trust), which puts Trust directly under
// Looking for. Only the filters that affect the active tab are rendered: Move-in
// applies to flatmates & rooms (posts carry a move-in date), Sharing (group
// size) applies only to groups, and Washroom only to rooms. Showing a control
// that silently does nothing erodes trust, so each tab shows exactly the
// filters it honours.
function FilterControls({ filters, setF, seg, budgetLbl, genderLabel, tab }) {
  const { t } = useTranslation();
  // Locality filter options — an explicit "Any locality" clear entry ahead of the
  // static Pune shortlist. LocalitySelect layers live Google suggestions on top so
  // the user can also filter by any real Pune locality, not just this shortlist.
  const LOCALITY_OPTIONS = [{ value: '', label: t('flatmates.anyLocality') }, ...LOCALITIES.map((l) => ({ value: l, label: l }))];
  // Move-in applies to both feeds now (a room has a date, so does a seeker), while
  // flat size is a "people" question and an attached bathroom is a "place" one.
  const showMoveIn = true;
  const showSharing = tab === TAB_TEAM_UP;
  const showBath = tab === TAB_MOVE_IN;
  const [editBudget, setEditBudget] = useState(false);
  const [draftBudget, setDraftBudget] = useState('');
  const commitBudget = () => {
    const n = Math.min(40000, Math.max(0, Math.round((+draftBudget || 0) / 1000) * 1000));
    setF({ budget: n });
    setEditBudget(false);
  };
  return (
    <>
      <Field label={t('flatmates.fBudget')}>
        <div className="h-10 w-full lg:w-3/4 flex items-center gap-2 px-4 rounded-full bg-white/5 border border-white/10">
          {editBudget ? (
            <input
              type="number" min="0" max="40000" step="1000" autoFocus
              value={draftBudget}
              aria-label={t('flatmates.ariaMaxBudget')}
              onChange={(e) => setDraftBudget(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={commitBudget}
              onKeyDown={(e) => { if (e.key === 'Enter') commitBudget(); else if (e.key === 'Escape') setEditBudget(false); }}
              className="w-20 text-xs bg-white/10 border border-teal-400/50 rounded px-1.5 py-0.5 text-teal-200 font-semibold focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          ) : (
            <button
              type="button"
              onClick={() => { setDraftBudget(filters.budget >= 40000 ? '' : String(filters.budget)); setEditBudget(true); }}
              title={t('flatmates.titleClickValue')}
              className="text-xs text-teal-300 font-semibold whitespace-nowrap underline decoration-dotted decoration-teal-400/40 underline-offset-2 hover:decoration-teal-300 focus:outline-none cursor-text"
            >{budgetLbl}</button>
          )}
          <input type="range" min="0" max="40000" step="1000" value={filters.budget} onChange={(e) => setF({ budget: +e.target.value })} className="flex-1 accent-teal-400 cursor-pointer" />
        </div>
      </Field>
      <Field label={t('flatmates.fLocality')}>
        <div className="w-full lg:w-3/4"><LocalitySelect value={filters.locality} onChange={(v) => setF({ locality: v })} options={LOCALITY_OPTIONS} placeholder={t('flatmates.anyLocality')} ariaLabel={t('flatmates.fLocality')} className="w-full" /></div>
      </Field>
      <Field label={t('flatmates.fNearPlace')} className="lg:col-start-3 lg:row-start-1 lg:row-span-3">
        <div className="w-full lg:w-3/4"><NearPlaceField filters={filters} setF={setF} /></div>
      </Field>
      {showMoveIn && (
        <Field label={t('flatmates.fMoveIn')}>
          <div className="w-full lg:w-3/4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setF({ moveIn: filters.moveIn === 'now' ? '' : 'now' })}
              aria-pressed={filters.moveIn === 'now'}
              className={seg(filters.moveIn === 'now') + ' shrink-0'}
            >{t('flatmates.immediate')}</button>
            <DateField
              value={isDateVal(filters.moveIn) ? filters.moveIn : ''}
              min={todayIso()}
              onChange={(iso) => setF({ moveIn: iso })}
              className="field rounded-full px-4 h-10 text-sm flex-1 min-w-0"
              ariaLabel={t('flatmates.ariaMoveInDate')}
              placeholder={t('flatmates.byDate')}
            />
          </div>
        </Field>
      )}
      <Field label={genderLabel}>
        <div className="flex gap-2">
          {[['', t('flatmates.gEveryone')], ['female', t('flatmates.gWomen')], ['male', t('flatmates.gMen')]].map(([g, label]) => <button key={label} onClick={() => setF({ gender: g })} className={seg(filters.gender === g)}>{label}</button>)}
        </div>
      </Field>
      {showSharing && (
        <Field label={t('flatmates.fSharing')}>
          <div className="w-full lg:w-3/4"><NativeSelect value={filters.sharing} onChange={(e) => setF({ sharing: e.target.value })} className="field w-full rounded-full px-4 py-2 text-sm"><option value="">{t('flatmates.anySize')}</option>{[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{t('flatmates.nSharing', { n })}</option>)}</NativeSelect></div>
        </Field>
      )}
      <Field label={t('flatmates.fLifestyle')}>
        <div className="flex flex-wrap gap-2">
          {[['Non-smoker', t('flatmates.lifeNonSmoker')], ['Vegetarian', t('flatmates.lifeVeg')], ['Pet-friendly', t('flatmates.lifePetOk')]].map(([tag, label]) => (
            <button
              key={tag}
              type="button"
              onClick={() => setF({ habits: filters.habits.includes(tag) ? filters.habits.filter((x) => x !== tag) : [...filters.habits, tag] })}
              aria-pressed={filters.habits.includes(tag)}
              className={seg(filters.habits.includes(tag))}
            >{label}</button>
          ))}
        </div>
      </Field>
      <Field label={t('flatmates.fTrust')}>
        <button onClick={() => setF({ verifiedOnly: !filters.verifiedOnly })} className={seg(filters.verifiedOnly) + ' inline-flex items-center gap-1.5'}><Icon name="shield-check" className="w-3.5 h-3.5" /> {t('flatmates.verifiedOnly')}</button>
      </Field>
      {showBath && (
        <Field label={t('flatmates.fWashroom')}>
          <button onClick={() => setF({ attachedBath: !filters.attachedBath })} aria-pressed={filters.attachedBath} className={seg(filters.attachedBath) + ' inline-flex items-center gap-1.5'}><Icon name="bath" className="w-3.5 h-3.5" /> {t('flatmates.attachedOnly')}</button>
        </Field>
      )}
    </>
  );
}

export default function FilterBar({ filters, setF, viewMode, setViewMode, seg, budgetLbl, smartSearchFlat, setFilters, emptyFilters, tab, sortMode, onSort, onReset, tabs }) {
  const { t } = useTranslation();
  const SORT_OPTIONS = [
    { value: 'match', label: t('flatmates.sortMatch') },
    { value: 'verified', label: t('flatmates.sortVerified') },
    { value: 'newest', label: t('flatmates.sortNewest') },
    { value: 'budget-low', label: t('flatmates.sortBudgetLow') },
    { value: 'budget-high', label: t('flatmates.sortBudgetHigh') },
  ];
  const genderLabel = tab === TAB_MOVE_IN ? t('flatmates.roomFor') : t('flatmates.lookingFor');
  const [drawer, setDrawer] = useState(false);
  const activeCount = Object.keys(emptyFilters).filter((k) => {
    // The near radius/mode/label describe one "Near a place" filter, not distinct
    // ones — only `near` itself counts (matches Flatmates's activeFilterCount).
    if (k === 'q' || k === 'nearLabel' || k === 'nearRadius' || k === 'nearMode') return false;
    const def = emptyFilters[k];
    return Array.isArray(def) ? filters[k].length > 0 : filters[k] !== def;
  }).length;
  const fieldProps = { filters, setF, seg, budgetLbl, genderLabel, tab };
  return (
    <>
      <div className="glass rounded-2xl p-4 sm:p-5 mb-5 reveal">
        {/* Category tabs sit flush on top of the search card so tabs + search +
            actions read as one control deck (no floating strip above). */}
        {tabs && <div className="mb-3 pb-3 border-b border-white/10">{tabs}</div>}
        {/* Search + view toggle + (desktop) sort/reset — one control bar so
            inventory sits higher on the page instead of below a tall filter block.
            Mobile stacks into two rows: search on top, Filters + List/Map below. */}
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
          <div className="flex items-center gap-2 lg:flex-1 lg:min-w-[180px] lg:max-w-[600px]">
            <div className="relative flex-1 min-w-0">
              <Icon name="sparkles" className="w-4 h-4 text-teal-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input value={filters.q} onChange={(e) => setF({ q: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') smartSearchFlat(); }} type="text" enterKeyHint="search" className="field w-full rounded-full pl-9 pr-11 lg:pr-4 py-[9px] text-sm" placeholder={t('flatmates.searchPlaceholder')} />
              {/* Mobile: icon-only submit sits inside the field (matches the listings search) */}
              <button type="button" onClick={smartSearchFlat} aria-label={t('flatmates.smartSearch')} className="lg:hidden absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full btn-primary flex items-center justify-center"><Icon name="search" className="w-4 h-4" /></button>
            </div>
            <div className="hidden lg:flex shrink-0">
              <button type="button" onClick={smartSearchFlat} className="btn-teal gap-2 whitespace-nowrap"><Icon name="search" className="w-4 h-4" /> {t('flatmates.smartSearch')}</button>
            </div>
          </div>
          <div className="flex items-center gap-2 lg:contents">
            <button type="button" onClick={() => setDrawer(true)} className="lg:hidden inline-flex items-center gap-1.5 px-3 h-10 rounded-xl border border-teal-400/40 bg-teal-500/15 text-teal-100 text-sm font-semibold hover:bg-teal-500/25 hover:border-teal-400/60 t-all shrink-0" aria-label={t('flatmates.ariaOpenFilters')}>
              <Icon name="sliders-horizontal" className="w-4 h-4" /> {t('flatmates.filters')}{activeCount > 0 && <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-teal-400 text-gray-900 text-[10px] font-bold leading-none">{activeCount}</span>}
            </button>
            <div className="sf-seg ml-auto">
              <button type="button" onClick={() => setViewMode('list')} className={'sf-seg__btn' + (viewMode === 'list' ? ' is-active' : '')} aria-pressed={viewMode === 'list'}><Icon name="list" className="w-4 h-4" /> {t('flatmates.viewList')}</button>
              <button type="button" onClick={() => setViewMode('map')} className={'sf-seg__btn' + (viewMode === 'map' ? ' is-active' : '')} aria-pressed={viewMode === 'map'}><Icon name="map" className="w-4 h-4" /> {t('flatmates.viewMap')}</button>
            </div>
            <div className="hidden lg:flex items-center gap-2">
              <span className="text-xs font-medium text-gray-400 whitespace-nowrap">{t('flatmates.sortBy')}</span>
              <Select value={sortMode} onChange={onSort} options={SORT_OPTIONS} className="w-44" ariaLabel={t('flatmates.ariaSortPosts')} />
              <button onClick={onReset} className="btn-ghost text-sm font-medium text-gray-300 px-4 h-10 rounded-full inline-flex items-center gap-1.5"><Icon name="rotate-ccw" className="w-3.5 h-3.5" /> {t('flatmates.reset')}</button>
            </div>
          </div>
        </div>

        {/* Filters — aligned 3-column grid (desktop only) */}
        <div className="hidden lg:grid grid-cols-3 gap-x-5 gap-y-5 mt-4">
          <FilterControls {...fieldProps} />
        </div>
      </div>

      {/* Mobile filter drawer */}
      <div className={'filter-overlay lg:hidden ' + (drawer ? 'open' : '')} onClick={() => setDrawer(false)} />
      <div className={'filter-panel lg:hidden p-6 ' + (drawer ? 'open' : '')} role="dialog" aria-label={t('flatmates.filters')} aria-modal="true">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-white">{t('flatmates.filters')}{activeCount > 0 && <span className="ml-2 text-sm font-medium text-teal-300">· {t('flatmates.nActive', { count: activeCount })}</span>}</h3>
          <button onClick={() => setDrawer(false)} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 t-all" aria-label={t('flatmates.ariaCloseFilters')}>
            <Icon name="x" className="w-5 h-5 text-gray-400" />
          </button>
        </div>
        <div className="flex flex-col gap-4">
          <FilterControls {...fieldProps} />
        </div>
        <div className="mt-5 pt-5 border-t border-white/10">
          <Field label={t('flatmates.sortBy')}>
            <Select value={sortMode} onChange={onSort} options={SORT_OPTIONS} className="w-full" ariaLabel={t('flatmates.ariaSortPosts')} />
          </Field>
          <div className="flex items-center gap-2 mt-4">
            <button onClick={onReset} className="btn-ghost flex-1 text-sm font-medium text-gray-300 h-11 rounded-full inline-flex items-center justify-center gap-1.5"><Icon name="rotate-ccw" className="w-3.5 h-3.5" /> {t('flatmates.reset')}</button>
            <button onClick={() => setDrawer(false)} className="btn-teal flex-1 h-11 rounded-full text-sm font-semibold text-white">{t('flatmates.showResults')}</button>
          </div>
        </div>
      </div>
    </>
  );
}
