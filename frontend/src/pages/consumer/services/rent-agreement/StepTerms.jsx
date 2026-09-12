import { useTranslation } from 'react-i18next';
import NativeSelect from '../../../../components/ui/NativeSelect.jsx';
import DateField from '../../../../components/ui/DateField.jsx';
import Icon from '../../../../components/Icon.jsx';
import FieldError from '../../../../components/ui/FieldError.jsx';
import { FURN_PRESETS } from './constants.js';

/*
   Point at which the clauses box starts explaining itself (D157).

   Every other free-text field on this wizard has a length its own control enforces; this textarea
   has none, so it is the only one a customer can single-handedly push the whole submission past the
   server's `details` ceiling with. A measured full form (four tenants, 300-character addresses, the
   whole furniture list) serialises to roughly 5,900 characters before this box contributes anything,
   which leaves about 2,000 for clauses inside the 8,000 cap — so the warning starts a little before
   that, while shortening is still a small edit rather than a rewrite.

   Deliberately not a `maxLength`: silently refusing keystrokes mid-sentence reads as a broken text
   box, and the real limit is on the whole form, not on this field. The wizard's own guard (which
   measures the actual payload) is what refuses the submit; this is the early word beside the
   control responsible.
*/
const CLAUSES_SOFT_LIMIT = 1500;

export default function StepTerms({ step, terms, setT, errors = {}, fc, clearErr, maint, setMaint, regArea, setRegArea, furnItems, toggleFurn, isChecked, bumpQty, removeFurn, custom, setCustom, addCustom, clauses, setClauses }) {
  const { t } = useTranslation();
  const maintLabel = { Tenant: t('services.ra.terms.maintOpt.Tenant'), Owner: t('services.ra.terms.maintOpt.Owner') };
  return (
    <div className={'step-panel' + (step === 3 ? ' active' : '')}>
      <h2 className="text-xl font-bold text-white mb-1">{t('services.ra.terms.title')}</h2>
      <p className="text-gray-500 text-sm mb-6">{t('services.ra.terms.subtitle')}</p>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-5">
        <div className="col-span-2 sm:col-span-1"><label className="lbl req">{t('services.ra.terms.startDate')}</label><DateField value={terms.startDate} onChange={(v) => { setT('startDate', v); clearErr('startDate'); }} className={fc('startDate')} ariaLabel={t('services.ra.terms.startDateAria')} /><FieldError show={!!errors.startDate}>{t('services.ra.terms.startDateErr')}</FieldError></div>
        <div>
          <label className="lbl req">{t('services.ra.terms.period')}</label>
          <NativeSelect value={terms.months} onChange={(e) => setT('months', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm">
            {[11, 12, 22, 24, 36, 60].map((m) => <option key={m} value={m}>{t('services.ra.terms.periodMonths', { count: m })}</option>)}
          </NativeSelect>
        </div>
        <div><label className="lbl req">{t('services.ra.terms.rent')}</label><input inputMode="numeric" value={terms.rent} onChange={(e) => { setT('rent', e.target.value); clearErr('rent'); }} className={fc('rent')} placeholder={t('services.ra.terms.rentPlaceholder')} /><FieldError show={!!errors.rent}>{t('services.ra.terms.rentErr')}</FieldError></div>
        <div><label className="lbl req">{t('services.ra.terms.deposit')}</label><input inputMode="numeric" value={terms.deposit} onChange={(e) => { setT('deposit', e.target.value); clearErr('deposit'); }} className={fc('deposit')} placeholder={t('services.ra.terms.depositPlaceholder')} /><FieldError show={!!errors.deposit}>{t('services.ra.terms.depositErr')}</FieldError></div>
        <div><label className="lbl">{t('services.ra.terms.nrDeposit')}</label><input inputMode="numeric" value={terms.nrDeposit} onChange={(e) => setT('nrDeposit', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm" placeholder="0" /></div>
        <div><label className="lbl">{t('services.ra.terms.increment')}</label><input inputMode="numeric" value={terms.increment} onChange={(e) => setT('increment', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm" /></div>
        <div><label className="lbl">{t('services.ra.terms.lockin')}</label><input inputMode="numeric" value={terms.lockin} onChange={(e) => setT('lockin', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm" /></div>
        <div><label className="lbl">{t('services.ra.terms.notice')}</label><input inputMode="numeric" value={terms.notice} onChange={(e) => setT('notice', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm" /></div>
        <div><label className="lbl">{t('services.ra.terms.dueDay')}</label><input inputMode="numeric" value={terms.dueDay} onChange={(e) => setT('dueDay', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm" /></div>
        <div className="col-span-2 sm:col-span-1"><label className="lbl">{t('services.ra.terms.payMode')}</label><NativeSelect value={terms.payMode} onChange={(e) => setT('payMode', e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm">{['Bank Transfer / NEFT', 'UPI', 'Cheque', 'Cash'].map((o) => <option key={o}>{o}</option>)}</NativeSelect></div>
      </div>

      <label className="lbl">{t('services.ra.terms.maintBy')}</label>
      <div className="grid grid-cols-2 gap-3 mb-5">
        {['Tenant', 'Owner'].map((v) => <div key={v} onClick={() => setMaint(v)} className={'opt-pill rounded-xl px-4 py-3 text-sm font-medium text-center ' + (maint === v ? 'sel' : 'text-gray-400')}>{maintLabel[v]}</div>)}
      </div>

      <label className="lbl">{t('services.ra.terms.regArea')}</label>
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div onClick={() => setRegArea('urban')} className={'opt-pill rounded-xl px-4 py-3 text-sm font-medium text-center ' + (regArea === 'urban' ? 'sel' : 'text-gray-400')}>{t('services.ra.terms.regUrban')}</div>
        <div onClick={() => setRegArea('rural')} className={'opt-pill rounded-xl px-4 py-3 text-sm font-medium text-center ' + (regArea === 'rural' ? 'sel' : 'text-gray-400')}>{t('services.ra.terms.regRural')}</div>
      </div>

      <label className="lbl">{t('services.ra.terms.furniture')}</label>
      <p className="text-gray-500 text-xs mb-3" style={{ marginTop: '-2px' }}>{t('services.ra.terms.furnitureHint')}</p>
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 mb-4">
        {FURN_PRESETS.map(([name, icon]) => (
          <div key={name} onClick={() => toggleFurn(name)} className={'furn-tile' + (isChecked(name) ? ' checked' : '')}>
            <span className="furn-check"><Icon name="check" className="w-3 h-3" /></span>
            <span className="furn-icon"><Icon name={icon} className="w-5 h-5" /></span>
            <span className="furn-label">{name}</span>
          </div>
        ))}
      </div>

      {furnItems.length > 0 && (
        <div className="mb-3">
          <p className="lbl" style={{ marginBottom: '6px' }}>{t('services.ra.terms.itemsIncluded')} <span className="text-gray-500 font-normal">({furnItems.length})</span></p>
          <div className="space-y-2 max-w-[640px]">
            {furnItems.map((f, i) => (
              <div key={i} className="furn-row">
                <span className="fr-name"><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>{f.custom && <span className="fr-tag">{t('services.ra.terms.customTag')}</span>}</span>
                <span className="qty-step">
                  <span className="qty-btn" onClick={() => bumpQty(i, -1)}><Icon name="minus" className="w-3.5 h-3.5" /></span>
                  <span className="qty-val">{f.qty}</span>
                  <span className="qty-btn" onClick={() => bumpQty(i, 1)}><Icon name="plus" className="w-3.5 h-3.5" /></span>
                </span>
                <span className="fr-remove" title={t('services.ra.tenant.remove')} onClick={() => removeFurn(i)}><Icon name="x" className="w-4 h-4" /></span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 mb-5 max-w-[640px]">
        <div className="relative flex-1">
          <Icon name="plus-circle" className="w-4 h-4 text-teal-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input value={custom.name} onChange={(e) => setCustom((p) => ({ ...p, name: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} type="text" placeholder={t('services.ra.terms.customPlaceholder')} className="field w-full pl-9 pr-3 py-2.5 rounded-xl text-sm" />
        </div>
        <input type="number" min="1" value={custom.qty} onChange={(e) => setCustom((p) => ({ ...p, qty: e.target.value }))} aria-label={t('services.ra.terms.customQtyAria')} className="field w-16 px-2 py-2.5 rounded-xl text-sm text-center" />
        <button type="button" onClick={addCustom} className="btn-outline px-4 py-2.5 rounded-xl text-teal-400 text-sm font-semibold whitespace-nowrap">{t('services.ra.terms.add')}</button>
      </div>

      <label className="lbl">{t('services.ra.terms.specialClauses')}</label>
      <textarea rows={3} value={clauses} onChange={(e) => setClauses(e.target.value)} className="field w-full px-4 py-3 rounded-xl text-white text-sm resize-none" placeholder={t('services.ra.terms.clausesPlaceholder')} aria-describedby={clauses.length > CLAUSES_SOFT_LIMIT ? 'ra-clauses-len' : undefined} />
      {clauses.length > CLAUSES_SOFT_LIMIT && (
        <p id="ra-clauses-len" role="status" aria-live="polite" className="text-amber-400 text-xs mt-2 leading-relaxed">
          {t('services.ra.terms.clausesLong', { chars: clauses.length })}
        </p>
      )}
    </div>
  );
}
