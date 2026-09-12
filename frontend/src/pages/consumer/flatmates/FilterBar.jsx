import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import NativeSelect from '../../../components/ui/NativeSelect.jsx';
import Select from '../../../components/ui/Select.jsx';
import LocalitySelect from '../../../components/ui/LocalitySelect.jsx';
import DateField from '../../../components/ui/DateField.jsx';
import DualRange from '../../../components/ui/DualRange.jsx';
import { FilterGroup } from '../../../components/ui/FilterGroup.jsx';
import NearPlaceField from './NearPlaceField.jsx';
import { LOCALITIES } from './constants.js';
import { inr, BUDGET_MIN, BUDGET_MAX, budgetIsAny } from './helpers.js';
import { TAB_MOVE_IN, TAB_TEAM_UP } from './model.js';

// A move-in filter value is either the sentinel 'now' (immediate), '' (any) or an
// ISO date string from the picker — only the last contains a '-'.
const isDateVal = (v) => typeof v === 'string' && v.includes('-');
// Local-time today as ISO, so the picker cannot offer a past move-in date.
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// One labelled cell. `className` lets a cell claim explicit grid placement (Near-a-place owns the
// tall right column).
function Field({ label, children, className = '' }) {
  return (
    <div className={'min-w-0 ' + className}>
      <label className="block text-xs font-medium text-gray-400 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

/* Mobile gets the collapsible `FilterGroup`, desktop plain cells. Module scope: defined inside
   `FilterControls` this would be a new component type every render, remounting mid-keystroke. */
function Section({ sheet, icon, label, summary, className, children }) {
  if (!sheet) return <Field label={label} className={className}>{children}</Field>;
  return <FilterGroup icon={icon} title={label} summary={summary}>{children}</FilterGroup>;
}

// Only the filters that affect the active tab are rendered: a control that silently does nothing
// erodes trust. Layout (grid vs sheet) is owned by the parent.
function FilterControls({ filters, setF, seg, budgetLbl, genderLabel, tab, variant = 'grid' }) {
  const { t } = useTranslation();
  const sheet = variant === 'sheet';
  // LocalitySelect layers live Google suggestions on top, so the user is not limited to this
  // static Pune shortlist.
  const LOCALITY_OPTIONS = [{ value: '', label: t('flatmates.anyLocality') }, ...LOCALITIES.map((l) => ({ value: l, label: l }))];
  // Move-in applies to both feeds (a room has a date, so does a seeker), while flat size is a
  // "people" question and an attached bathroom is a "place" one.
  const showMoveIn = true;
  const showSharing = tab === TAB_TEAM_UP;
  const showBath = tab === TAB_MOVE_IN;
  /* Every read-out is '' at the default, which is the contract `FilterGroup` reads: it prints
     "Any" itself. A formatted default here would light every section up on arrival. */
  const genderOptions = [['', t('flatmates.gEveryone')], ['female', t('flatmates.gWomen')], ['male', t('flatmates.gMen')]];
  const summaries = {
    budget: budgetIsAny(filters.budget) ? '' : budgetLbl,
    locality: filters.locality,
    // `nearMode` is '' until the user picks one and NearPlaceField reads that as 'km',
    // so test for 'min' — testing for 'km' would label an untouched radius in minutes.
    near: filters.near ? `${filters.nearLabel || t('flatmates.fNearPlace')} · ${filters.nearRadius} ${filters.nearMode === 'min' ? t('flatmates.unitMin') : t('flatmates.unitKm')}` : '',
    moveIn: filters.moveIn === 'now' ? t('flatmates.immediate') : isDateVal(filters.moveIn) ? filters.moveIn : '',
    /* Empty at the default, NOT the label of the default button: "Everyone" is right on a pill you
       choose from, but as a read-out it claims a filter is set and lights the narrowing tint. */
    gender: filters.gender ? (genderOptions.find(([g]) => g === filters.gender) || [])[1] || '' : '',
    sharing: filters.sharing ? t('flatmates.nSharing', { n: filters.sharing }) : '',
    habits: filters.habits.join(', '),
    trust: filters.verifiedOnly ? t('flatmates.verifiedOnly') : '',
    bath: filters.attachedBath ? t('flatmates.attachedOnly') : '',
  };
  return (
    <>
      {/* Commits on RELEASE, not per step, so a drag is one re-filter. BUDGET_MAX is the top of
          the scale and means "no ceiling" — see helpers.js. */}
      <Section sheet={sheet} icon="indian-rupee" label={t('flatmates.fBudget')} summary={summaries.budget}>
        <div className="w-full lg:w-3/4">
          <DualRange
            min={BUDGET_MIN}
            max={BUDGET_MAX}
            step={1000}
            value={filters.budget}
            onChange={(v) => setF({ budget: v })}
            label={t('flatmates.fBudget')}
            format={(v) => inr(v) + (v >= BUDGET_MAX ? '+' : '')}
          />
        </div>
      </Section>
      <Section sheet={sheet} icon="map-pin" label={t('flatmates.fLocality')} summary={summaries.locality}>
        <div className="w-full lg:w-3/4"><LocalitySelect value={filters.locality} onChange={(v) => setF({ locality: v })} options={LOCALITY_OPTIONS} placeholder={t('flatmates.anyLocality')} ariaLabel={t('flatmates.fLocality')} className="w-full" /></div>
      </Section>
      <Section sheet={sheet} icon="map-pinned" label={t('flatmates.fNearPlace')} summary={summaries.near} className="lg:col-start-3 lg:row-start-1 lg:row-span-3">
        <div className="w-full lg:w-3/4"><NearPlaceField filters={filters} setF={setF} /></div>
      </Section>
      {showMoveIn && (
        <Section sheet={sheet} icon="calendar-check" label={t('flatmates.fMoveIn')} summary={summaries.moveIn}>
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
              className="field rounded-full px-4 h-11 sm:h-10 text-sm flex-1 min-w-0"
              ariaLabel={t('flatmates.ariaMoveInDate')}
              placeholder={t('flatmates.byDate')}
            />
          </div>
        </Section>
      )}
      <Section sheet={sheet} icon="users-round" label={genderLabel} summary={summaries.gender}>
        {/* `aria-pressed` so the selected option is announced, not just tinted: the `seg()` class
            is the only other signal, and a screen reader cannot see it. */}
        <div className="flex gap-2">
          {genderOptions.map(([g, label]) => <button key={label} onClick={() => setF({ gender: g })} aria-pressed={filters.gender === g} className={seg(filters.gender === g)}>{label}</button>)}
        </div>
      </Section>
      {showSharing && (
        <Section sheet={sheet} icon="users" label={t('flatmates.fSharing')} summary={summaries.sharing}>
          <div className="w-full lg:w-3/4"><NativeSelect value={filters.sharing} onChange={(e) => setF({ sharing: e.target.value })} className="field w-full rounded-full px-4 py-2 text-sm"><option value="">{t('flatmates.anySize')}</option>{[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{t('flatmates.nSharing', { n })}</option>)}</NativeSelect></div>
        </Section>
      )}
      <Section sheet={sheet} icon="sparkles" label={t('flatmates.fLifestyle')} summary={summaries.habits}>
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
      </Section>
      <Section sheet={sheet} icon="shield-check" label={t('flatmates.fTrust')} summary={summaries.trust}>
        <button onClick={() => setF({ verifiedOnly: !filters.verifiedOnly })} aria-pressed={filters.verifiedOnly} className={seg(filters.verifiedOnly) + ' inline-flex items-center gap-1.5'}><Icon name="shield-check" className="w-3.5 h-3.5" /> {t('flatmates.verifiedOnly')}</button>
      </Section>
      {showBath && (
        <Section sheet={sheet} icon="bath" label={t('flatmates.fWashroom')} summary={summaries.bath}>
          <button onClick={() => setF({ attachedBath: !filters.attachedBath })} aria-pressed={filters.attachedBath} className={seg(filters.attachedBath) + ' inline-flex items-center gap-1.5'}><Icon name="bath" className="w-3.5 h-3.5" /> {t('flatmates.attachedOnly')}</button>
        </Section>
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
    /* `budget` is a [min, max] tuple, so it needs the bounds test: the `Array.isArray` rule below
       is right for `habits` but permanently true of a range, and the badge would never read 0. */
    if (k === 'budget') return !budgetIsAny(filters.budget);
    const def = emptyFilters[k];
    return Array.isArray(def) ? filters[k].length > 0 : filters[k] !== def;
  }).length;
  const fieldProps = { filters, setF, seg, budgetLbl, genderLabel, tab };
  /* Collapsed so inventory clears the fold, but opened when a filter is already set — hiding the
     cause of a narrowed list is worse than the scroll. docs/flows/consumer/flatmates.md § Discovery. */
  const [showFilters, setShowFilters] = useState(() => activeCount > 0);
  return (
    <>
      <div className="glass rounded-2xl p-3.5 sm:p-5 mb-4 sm:mb-5 reveal">
        {/* Category tabs sit flush on top of the search card so tabs + search +
            actions read as one control deck (no floating strip above). */}
        {tabs && <div className="mb-2.5 pb-2.5 sm:mb-3 sm:pb-3 border-b border-white/10">{tabs}</div>}
        {/* Search + view toggle + (desktop) sort/reset in one control bar, so inventory sits
            higher than it would below a tall filter block. */}
        <div className="flex flex-col gap-2.5 lg:gap-3 lg:flex-row lg:flex-wrap lg:items-center">
          <div className="flex items-center gap-2 lg:flex-1 lg:min-w-[180px] lg:max-w-[600px]">
            <div className="relative flex-1 min-w-0">
              <Icon name="sparkles" className="w-4 h-4 text-teal-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input value={filters.q} onChange={(e) => setF({ q: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') smartSearchFlat(); }} type="text" enterKeyHint="search" className="sf-search-field field w-full rounded-full pl-9 pr-12 lg:pr-4 h-11 lg:h-10 text-sm" placeholder={t('flatmates.searchPlaceholder')} />
              {/* Size comes from INSET, never a height: on a 44px bar that is a 36px circle and it
                  stays circular by construction. `tap-extend` gives it the 44px touch target. */}
              <button type="button" onClick={smartSearchFlat} aria-label={t('flatmates.smartSearch')} className="sf-search-go tap-extend lg:hidden absolute top-1 bottom-1 right-1 w-9 rounded-full btn-primary flex items-center justify-center"><Icon name="search" className="w-4 h-4" /></button>
            </div>
            <div className="hidden lg:flex shrink-0">
              <button type="button" onClick={smartSearchFlat} className="btn-teal gap-2 whitespace-nowrap"><Icon name="search" className="w-4 h-4" /> {t('flatmates.smartSearch')}</button>
            </div>
          </div>
          <div className="flex items-center gap-2 lg:contents">
            {/* Mobile's Filters trigger is not here — it is the floating capsule below,
                same as the listings page. */}
            <div className="sf-seg ml-auto">
              <button type="button" onClick={() => setViewMode('list')} className={'sf-seg__btn' + (viewMode === 'list' ? ' is-active' : '')} aria-pressed={viewMode === 'list'}><Icon name="list" className="w-4 h-4" /> {t('flatmates.viewList')}</button>
              <button type="button" onClick={() => setViewMode('map')} className={'sf-seg__btn' + (viewMode === 'map' ? ' is-active' : '')} aria-pressed={viewMode === 'map'}><Icon name="map" className="w-4 h-4" /> {t('flatmates.viewMap')}</button>
            </div>
            <div className="hidden lg:flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                aria-expanded={showFilters}
                aria-controls="sf-desktop-filters"
                className={'inline-flex items-center gap-1.5 px-3 h-10 rounded-xl border text-sm font-semibold t-all shrink-0 ' + (showFilters ? 'border-teal-400/60 bg-teal-500/25 text-teal-100' : 'border-teal-400/40 bg-teal-500/15 text-teal-100 hover:bg-teal-500/25')}
              >
                <Icon name="sliders-horizontal" className="w-4 h-4" /> {t('flatmates.filters')}
                {activeCount > 0 && <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-teal-400 text-gray-900 text-[10px] font-bold leading-none">{activeCount}</span>}
              </button>
              <span className="text-xs font-medium text-gray-400 whitespace-nowrap">{t('flatmates.sortBy')}</span>
              <Select value={sortMode} onChange={onSort} options={SORT_OPTIONS} className="w-44" ariaLabel={t('flatmates.ariaSortPosts')} />
              <button onClick={onReset} className="btn-ghost text-sm font-medium text-gray-300 px-4 h-10 rounded-full inline-flex items-center gap-1.5"><Icon name="rotate-ccw" className="w-3.5 h-3.5" /> {t('flatmates.reset')}</button>
            </div>
          </div>
        </div>

        {/* Filters — aligned 3-column grid (desktop only), collapsed by default so
            inventory clears the fold. See the note on `showFilters` above. */}
        <div id="sf-desktop-filters" className={(showFilters ? 'hidden lg:grid' : 'hidden') + ' grid-cols-3 gap-x-5 gap-y-5 mt-4'}>
          <FilterControls {...fieldProps} />
        </div>
      </div>

      {/* The thumb arc gets the same `.filter-fab` capsule the listings board uses — placement
          rules in docs/flows/consumer/flatmates.md. `aria-expanded`: the drawer leaves it focusable. */}
      <button
        type="button"
        onClick={() => setDrawer(true)}
        aria-label={activeCount > 0 ? t('flatmates.ariaFiltersActive', { count: activeCount }) : t('flatmates.ariaOpenFilters')}
        aria-haspopup="dialog"
        aria-expanded={drawer}
        className={'filter-fab lg:hidden fixed z-[60] inline-flex items-center gap-2 h-11 pl-3.5 rounded-full text-[13px] font-semibold tracking-tight text-white' + (activeCount > 0 ? ' is-active pr-2.5' : ' pr-4')}
      >
        <Icon name="sliders-horizontal" className="w-[18px] h-[18px] text-teal-300" />
        {t('flatmates.filters')}
        {activeCount > 0 ? (
          <span className="filter-fab__count inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold leading-none">{activeCount}</span>
        ) : null}
      </button>

      {/* Mobile filter drawer */}
      <div className={'filter-overlay lg:hidden ' + (drawer ? 'open' : '')} onClick={() => setDrawer(false)} />
      <div className={'filter-panel lg:hidden p-6 ' + (drawer ? 'open' : '')} role="dialog" aria-label={t('flatmates.filters')} aria-modal="true">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-white">{t('flatmates.filters')}{activeCount > 0 && <span className="ml-2 text-sm font-medium text-teal-300">· {t('flatmates.nActive', { count: activeCount })}</span>}</h3>
          <button onClick={() => setDrawer(false)} className="w-11 h-11 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center hover:bg-white/10 t-all" aria-label={t('flatmates.ariaCloseFilters')}>
            <Icon name="x" className="w-5 h-5 text-gray-400" />
          </button>
        </div>
        {/* Same section chrome, spacing and slider as the /listings filter sheet — see
            `Section` above and `.sf-filter-sheet` in styles/routes/filters.css. */}
        <div className="sf-filter-sheet">
          <FilterControls {...fieldProps} variant="sheet" />
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
