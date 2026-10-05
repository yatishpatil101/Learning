import { useTranslation } from 'react-i18next';
import NativeSelect from '../../../../components/ui/NativeSelect.jsx';
import DateField from '../../../../components/ui/DateField.jsx';
import Icon from '../../../../components/Icon.jsx';
import FieldError from '../../../../components/ui/FieldError.jsx';
import { BANKS, CASH_LIMIT, DEPOSIT_PAY_FIELDS, MAX_DEPOSIT_PAYMENTS } from './constants.js';
import { todayIst } from './validation.js';
import { digits, fmt, num } from './helpers.js';

const FIELD = 'field w-full px-4 py-3 rounded-xl text-white text-sm';
const WIDE = new Set(['ref', 'bank']);

export default function DepositPayments({ terms, setT, errors = {}, clearErr }) {
  const { t } = useTranslation();
  const rows = Array.isArray(terms.depositPayments) ? terms.depositPayments : [];
  const deposit = num(terms.deposit);
  if (!deposit && !rows.length) return null;
  const paid = rows.reduce((sum, r) => sum + num(r.amount), 0);
  const today = todayIst();
  const save = (next) => { setT('depositPayments', next); clearErr('depositPayments'); };
  const setRow = (i, k, v) => { save(rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r))); clearErr(`dp${i}${k}`); };
  const setMode = (i, mode) => save(rows.map((r, idx) => (idx === i ? { mode, ...Object.fromEntries(DEPOSIT_PAY_FIELDS[mode].map((f) => [f, r[f] || ''])) } : r)));
  const add = () => save([...rows, { mode: 'upi', ref: '', date: '', amount: deposit > paid ? String(deposit - paid) : '' }]);
  const label = (mode, f) => t(`services.ra.terms.depositPay.${f}`, { context: mode });

  const field = (i, r, f) => {
    const key = `dp${i}${f}`;
    const cls = FIELD + (errors[key] ? ' err' : '');
    const control = f === 'date'
      ? <DateField value={r.date} max={today} onChange={(v) => setRow(i, 'date', v)} className={cls} ariaLabel={`${label(r.mode, 'date')} ${i + 1}`} />
      : f === 'amount'
        ? <input inputMode="numeric" value={r.amount || ''} onChange={(e) => setRow(i, 'amount', digits(e.target.value))} className={cls} />
        : f === 'ref'
          ? <input value={r.ref || ''} autoCapitalize="characters" onChange={(e) => setRow(i, 'ref', e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 30))} className={cls} />
          : <input value={r[f] || ''} maxLength={80} list={f === 'bank' ? 'ra-banks' : undefined} onChange={(e) => setRow(i, f, e.target.value)} className={cls} />;
    return (
      <div key={f} className={WIDE.has(f) ? 'col-span-2 sm:col-span-1' : ''}>
        <label className={'lbl' + (f === 'branch' ? '' : ' req')}>{label(r.mode, f)}</label>
        {control}
        <FieldError show={!!errors[key]}>{t(`services.ra.terms.depositPay.err.${errors[key]}`)}</FieldError>
      </div>
    );
  };

  return (
    <section className="mb-5" data-testid="ra-deposit-payments" aria-labelledby="ra-deposit-pay-title">
      <p id="ra-deposit-pay-title" className="lbl req">{t('services.ra.terms.depositPay.title')}</p>
      <p role="status" className={'text-xs mb-3 ' + (paid === deposit ? 'text-emerald-400' : 'text-amber-400')}>{t('services.ra.terms.depositPay.total', { paid: fmt(paid), deposit: fmt(deposit) })}</p>
      <datalist id="ra-banks">{BANKS.map((b) => <option key={b} value={b} />)}</datalist>
      <div className="space-y-3 mb-3">
        {rows.map((r, i) => (
          <div key={i} className="rounded-xl border border-white/10 p-3 sm:p-4" data-testid={`ra-deposit-payment-${i}`}>
            <div className="flex items-end gap-2 mb-3">
              <div className="flex-1">
                <label className="lbl req">{t('services.ra.terms.depositPay.mode')}</label>
                <NativeSelect value={r.mode} title={t('services.ra.terms.depositPay.mode')} onChange={(e) => setMode(i, e.target.value)} className={FIELD}>
                  {Object.keys(DEPOSIT_PAY_FIELDS).map((m) => <option key={m} value={m}>{t(`services.ra.terms.depositPay.modeOpt.${m}`)}</option>)}
                </NativeSelect>
              </div>
              <button type="button" onClick={() => save(rows.filter((_, idx) => idx !== i))} className="p-3 rounded-xl text-gray-400 hover:text-red-400" title={t('services.ra.terms.depositPay.remove')} aria-label={t('services.ra.terms.depositPay.remove')}><Icon name="x" className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">{(DEPOSIT_PAY_FIELDS[r.mode] || []).map((f) => field(i, r, f))}</div>
            {r.mode === 'cash' && num(r.amount) >= CASH_LIMIT && <p role="status" className="text-amber-400 text-xs mt-2 leading-relaxed">{t('services.ra.terms.cashLimit')}</p>}
          </div>
        ))}
      </div>
      {rows.length < MAX_DEPOSIT_PAYMENTS && (
        <button type="button" onClick={add} className="btn-outline px-4 py-2.5 rounded-xl text-teal-400 text-sm font-semibold flex items-center gap-2"><Icon name="plus-circle" className="w-4 h-4" /> {t('services.ra.terms.depositPay.add')}</button>
      )}
      <FieldError show={!!errors.depositPayments}>{t(`services.ra.terms.depositPay.err.${errors.depositPayments}`, { paid: fmt(paid), deposit: fmt(deposit) })}</FieldError>
    </section>
  );
}
