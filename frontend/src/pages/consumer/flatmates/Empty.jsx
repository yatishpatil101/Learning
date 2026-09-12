import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { inr } from './helpers.js';

// An empty result set is an invitation to act, not a dead end. `primary` is the
// one thing we want the user to do here (post, list, create); when filters are
// narrowing things down we also offer a one-tap way back to everything. `chips`
// spell out WHY it's empty (the active filters), and `hint` surfaces the cheapest
// post just beyond the current budget so the user can widen it in one tap.
function Empty({ icon, title, text, primary, filtersActive, onClearFilters, chips = [], query, hint, onRaiseBudget, rescue }) {
  const { t } = useTranslation();
  return (
    <div className="text-center py-10">
      <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-white/5 flex items-center justify-center"><Icon name={icon} className="w-7 h-7 text-gray-500" /></div>
      <p className="text-white font-semibold">{title}</p>
      <p className="text-gray-500 text-sm mt-1 max-w-sm mx-auto">{text}</p>
      {(query || chips.length > 0) && (
        <div className="mt-3 flex items-center justify-center gap-1.5 flex-wrap max-w-md mx-auto">
          {query && <span className="inline-flex items-center gap-1 rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-[11px] text-gray-300"><Icon name="search" className="w-3 h-3" /> “{query}”</span>}
          {chips.map((c, i) => <span key={i} className="inline-flex items-center gap-1 rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-[11px] text-gray-300"><Icon name={c.icon} className="w-3 h-3" /> {c.text}</span>)}
        </div>
      )}
      {/* Cross-tab rescue outranks the budget hint: the other tab already holds
          stock for the SAME filters, so switching costs the user no compromise,
          while raising a budget does. */}
      {rescue && rescue.count > 0 && (
        <div className="mt-4 max-w-sm mx-auto rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <p className="text-gray-300 text-xs">{rescue.text}</p>
          <button onClick={rescue.onClick} className="mt-2 btn-ghost h-9 inline-flex items-center gap-1.5 px-3.5 rounded-full text-gray-100 text-xs font-semibold"><Icon name="arrow-right-left" className="w-3.5 h-3.5" /> {rescue.label}</button>
        </div>
      )}
      {hint && (
        <div className="mt-4 max-w-sm mx-auto rounded-xl border border-teal-500/25 bg-teal-500/5 px-4 py-3">
          <p className="text-teal-200 text-xs">{t('flatmates.hintPre')} <span className="font-semibold text-white">{inr(hint.price)}{t('flatmates.perMonth')}</span> {t('flatmates.hintSuf')}</p>
          <button onClick={onRaiseBudget} aria-label={t('flatmates.ariaRaiseBudget', { budget: inr(hint.budget), price: inr(hint.price) })} className="mt-2 btn-teal h-9 inline-flex items-center gap-1.5 px-3.5 rounded-full text-white text-xs font-semibold"><Icon name="sliders-horizontal" className="w-3.5 h-3.5" /> {t('flatmates.raiseBudgetTo', { budget: inr(hint.budget) })}</button>
        </div>
      )}
      {(primary || filtersActive) && (
        <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
          {primary && (primary.href
            ? <Link to={primary.href} className="btn-teal h-10 inline-flex items-center gap-2 px-4 rounded-full text-white text-sm font-semibold"><Icon name={primary.icon} className="w-4 h-4" /> {primary.label}</Link>
            : <button onClick={primary.onClick} className="btn-teal h-10 inline-flex items-center gap-2 px-4 rounded-full text-white text-sm font-semibold"><Icon name={primary.icon} className="w-4 h-4" /> {primary.label}</button>)}
          {filtersActive && <button onClick={onClearFilters} className="btn-ghost h-10 inline-flex items-center gap-2 px-4 rounded-full text-gray-200 text-sm font-medium"><Icon name="x" className="w-4 h-4" /> {t('flatmates.clearFilters')}</button>}
        </div>
      )}
    </div>
  );
}

export default Empty;
