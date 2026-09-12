import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { fmtNum } from '../../../lib/format.js';
import { updateManaged, listRentReceipts, recordRentReceipt } from '../../../services/managedService.js';
import { currentDueStatus, recentMonths } from '../../../lib/data/rentReminders.js';
import { generateSingle } from '../../../lib/rentReceipt.js';
import { FIELD_CLS } from './constants.js';

/* How many months the ledger shows. One constant, because the fetch window and the row window must
   agree: ask for fewer receipts than there are rows and a settled month renders as outstanding,
   with a button that mints nothing and a 409 to explain it. */
const LEDGER_MONTHS = 6;

/* Rent reminders & receipts — the retention hook. The owner records rent they collected (any way)
   and gets an instant HRA receipt. No payment rails: nothing here touches the tenant's gateway
   payments, whose paid state is webhook-controlled and is not an owner's to assert.

   Which months are settled is a *server* fact now, read through `managedService`. It used to be a
   localStorage ledger, which meant a receipt vanished with a cleared browser, disagreed between a
   phone and a laptop, and reprinted at whatever rent the record happened to hold today rather than
   the rent that was actually collected. Every figure below therefore comes off the receipt the
   server returned, never off `prop`. */
export default function RentPanel({ prop, onChange }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const rentStr = (n) => t('ownerHub.rentPerMo', { amount: fmtNum(n) });
  const [editing, setEditing] = useState(!prop.rented);
  const [form, setForm] = useState({
    tenantName: prop.tenantName || '',
    monthlyRent: prop.monthlyRent || (prop.deal === 'rent' ? prop.price : '') || '',
    dueDay: prop.dueDay || 5,
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // `null` while the first read is in flight, so the ledger can render its months without claiming
  // any of them is unpaid — a month that is settled must never flash a "Mark received" button the
  // owner might press.
  const [receipts, setReceipts] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busyMonth, setBusyMonth] = useState('');
  // Re-armed in the effect body, not only cleared in cleanup: under StrictMode a mount/cleanup/
  // re-mount would otherwise leave this false forever and silently swallow every state update.
  const alive = useRef(true);
  // The re-entrancy guard proper. `busyMonth` is state, so a second handler firing in the same
  // render generation still reads the old value — the disabled attribute happens to cover that for
  // a discrete click, but the guard should not depend on the caller being a discrete click.
  const busyRef = useRef('');
  // `t` is a new function on every language change, so holding it in `load`'s deps would make a
  // language toggle re-run the effect, blank the ledger back to pending and refetch. It is only
  // there to compose one error string.
  const tRef = useRef(t);
  tRef.current = t;

  const propId = prop.id;
  const tracking = !!prop.rented;

  const load = useCallback(async () => {
    if (!propId || !tracking) return;
    try {
      const rows = await listRentReceipts(propId, LEDGER_MONTHS);
      if (alive.current) {
        setReceipts(rows);
        setFailed(false);
      }
    } catch {
      // A failed read must not turn settled months into unsettled ones. Staying on the pending
      // shape keeps every row read-only, which is the honest state: we do not know. But honest and
      // terminal is not a state a panel may sit in, so `failed` earns a retry the owner can press.
      if (alive.current) {
        setFailed(true);
        toast(tRef.current('ownerHub.rentReceiptsFailed'), 'error');
      }
    }
  }, [propId, tracking, toast]);

  useEffect(() => {
    alive.current = true;
    setReceipts(null);
    setFailed(false);
    load();
    return () => { alive.current = false; };
  }, [load]);

  const byMonth = useMemo(
    () => new Map((receipts || []).map((r) => [r.ym, r])),
    [receipts],
  );

  const saveDetails = async (rented) => {
    // The 1–28 clamp is this panel's rule, not the server's: February is why, and a due day of 31
    // would silently never fall due. It stays here because it is about what the owner can
    // meaningfully pick, and the server accepts what it is told.
    await updateManaged(prop.id, {
      rented,
      tenantName: form.tenantName.trim(),
      monthlyRent: Number(form.monthlyRent) || 0,
      dueDay: Math.min(28, Math.max(1, Number(form.dueDay) || 5)),
    });
    setEditing(false);
    onChange?.();
    toast(rented ? t('ownerHub.trackingOn') : t('ownerHub.markedVacant'), 'success');
  };

  const markPaid = async (ym) => {
    if (busyRef.current || byMonth.has(ym)) return;
    busyRef.current = ym;
    setBusyMonth(ym);
    try {
      const receipt = await recordRentReceipt(prop.id, ym);
      if (alive.current) setReceipts((rows) => [receipt, ...(rows || [])]);
      onChange?.();
      toast(t('ownerHub.rentRecorded'), 'success');
    } catch (e) {
      if (e?.status === 409) {
        // Already recorded — somewhere else, or a double press. Our view is the stale thing, so
        // converge on the server's rather than report a failure the owner cannot act on.
        await load();
        toast(t('ownerHub.rentAlreadyRecorded'), 'info');
      } else if (e?.status === 422) {
        // The server's own words: it knows which of rent, tenant or tracking is missing.
        toast(e.message || t('ownerHub.setRentFirst'), 'error');
      } else {
        toast(t('ownerHub.rentRecordFailed'), 'error');
      }
    } finally {
      busyRef.current = '';
      if (alive.current) setBusyMonth('');
    }
  };

  /* Printed strictly from the receipt, never from `prop`: those are the figures that were true in
     the month it covers. `txnRef` is the server's durable receipt id, so re-downloading the same
     month on another device produces the same reference — the old `'RCPT' + Date.now()` produced a
     new one on every click. */
  const download = (r) => generateSingle({
    tenant: r.tenantName || t('ownerHub.tenant'),
    landlord: r.landlordName || t('ownerHub.landlord'),
    address: r.propertyAddress || '',
    rent: r.amount,
    mode: 'Cash / Bank',
    month: r.ym,
    txnRef: r.id,
    paidOnline: false,
  });

  // ---- Vacant / setup state ----
  if (!prop.rented || editing) {
    return (
      <div className="glass-card rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-1"><Icon name="receipt-indian-rupee" className="w-5 h-5 text-brand-teal-2" /><h2 className="text-lg font-bold text-white">{t('ownerHub.rentTracking')}</h2></div>
        <p className="text-gray-400 text-sm mb-5">{t('ownerHub.rentSetupSub')}</p>
        <div className="space-y-4">
          <label className="block">
            <span className="text-xs text-gray-400 mb-1.5 block">{t('ownerHub.tenantName')}</span>
            <input value={form.tenantName} onChange={set('tenantName')} placeholder={t('ownerHub.tenantPlaceholder')} className={FIELD_CLS} />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs text-gray-400 mb-1.5 block">{t('ownerHub.monthlyRent')}</span>
              <input type="number" inputMode="numeric" value={form.monthlyRent} onChange={set('monthlyRent')} placeholder={t('ownerHub.rentPlaceholder')} className={FIELD_CLS} />
            </label>
            <label className="block">
              <span className="text-xs text-gray-400 mb-1.5 block">{t('ownerHub.dueDay')}</span>
              <input type="number" min="1" max="28" value={form.dueDay} onChange={set('dueDay')} className={FIELD_CLS} />
            </label>
          </div>
          <div className="flex gap-2.5">
            <button onClick={() => saveDetails(true)} className="btn-teal flex-1 py-2.5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2"><Icon name="bell" className="w-4 h-4" /> {t('ownerHub.startTracking')}</button>
            {prop.rented && <button onClick={() => setEditing(false)} className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-300 text-sm hover:bg-white/5">{t('ownerHub.cancel')}</button>}
          </div>
          {!prop.rented && <button onClick={() => saveDetails(false)} className="w-full text-center text-gray-500 text-xs hover:text-gray-300">{t('ownerHub.itsVacant')}</button>}
        </div>
      </div>
    );
  }

  // ---- Active tracking state ----
  // `pending` is the first read still in flight (or failed). Everything below stays laid out and
  // read-only in that state rather than defaulting to "unpaid", so a settled month never offers a
  // button that would only earn a 409.
  const pending = receipts === null;
  const s = currentDueStatus(prop, i18n.language);
  const thisMonth = byMonth.get(s.ym) || null;
  const paid = !!thisMonth;
  const months = recentMonths(LEDGER_MONTHS, i18n.language);
  return (
    <div className="glass-card rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2"><Icon name="receipt-indian-rupee" className="w-5 h-5 text-brand-teal-2" /><h2 className="text-lg font-bold text-white">{t('ownerHub.rentTracking')}</h2></div>
        <button onClick={() => setEditing(true)} className="text-gray-400 text-xs hover:text-white flex items-center gap-1"><Icon name="pencil" className="w-3.5 h-3.5" /> {t('ownerHub.edit')}</button>
      </div>

      <div className={'rounded-xl p-4 border mb-4 ' + (paid ? 'bg-emerald-500/10 border-emerald-500/25' : pending ? 'bg-white/[0.03] border-white/10' : s.overdue ? 'bg-rose-500/10 border-rose-500/25' : 'bg-amber-500/10 border-amber-500/25')}>
        <p className="text-xs text-gray-300">{s.label} · {prop.tenantName || t('ownerHub.tenant')}</p>
        <p className="text-2xl font-extrabold text-white leading-tight mt-0.5">{rentStr(thisMonth ? thisMonth.amount : prop.monthlyRent)}</p>
        <p className={'text-xs font-medium mt-1 flex items-center gap-1 ' + (paid ? 'text-emerald-300' : pending ? 'text-gray-400' : s.overdue ? 'text-rose-300' : 'text-amber-300')}>
          <Icon name={paid ? 'check-circle' : s.overdue && !pending ? 'alert-circle' : 'clock'} className="w-3.5 h-3.5" />
          {/* `overdue` asserts that nothing was paid, so it waits for the read; `dueBy` states when
              the month falls due, which is true either way and needs no such guard. */}
          {paid ? t('ownerHub.receivedThisMonth') : s.overdue && !pending ? t('ownerHub.overdueOn', { day: s.dueDay }) : t('ownerHub.dueBy', { day: s.dueDay })}
        </p>
        {!paid && (
          <button onClick={() => markPaid(s.ym)} disabled={pending || !!busyMonth} aria-busy={busyMonth === s.ym} className="btn-teal w-full mt-3 py-2.5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"><Icon name="check" className="w-4 h-4" /> {t('ownerHub.markReceived')}</button>
        )}
      </div>

      <p className="text-xs text-gray-400 mb-2">{t('ownerHub.recentMonths')}</p>
      {failed && (
        <button onClick={load} className="mb-2 text-xs text-brand-teal-3 hover:underline flex items-center gap-1"><Icon name="refresh-cw" className="w-3.5 h-3.5" /> {t('ownerHub.retryReceipts')}</button>
      )}
      <ul className="space-y-1.5">
        {months.map((m) => {
          const r = byMonth.get(m.ym);
          return (
            <li key={m.ym} className="flex items-center justify-between text-sm py-1.5 px-2 rounded-lg hover:bg-white/[0.03]">
              <span className="text-gray-300">{m.label}</span>
              {r ? (
                <span className="flex items-center gap-3">
                  <span className="text-emerald-300 text-xs flex items-center gap-1"><Icon name="check-circle" className="w-3.5 h-3.5" /> {rentStr(r.amount)}</span>
                  {/* Six rows of "Mark received" and "Receipt" are six identical accessible names
                      unless the month comes with them, and picking the wrong one here mints a
                      receipt for a month nobody paid. */}
                  <button onClick={() => download(r)} aria-label={t('ownerHub.receiptFor', { month: m.label })} className="text-brand-teal-3 text-xs hover:underline flex items-center gap-1"><Icon name="download" className="w-3.5 h-3.5" /> {t('ownerHub.receipt')}</button>
                </span>
              ) : (
                <button onClick={() => markPaid(m.ym)} disabled={pending || !!busyMonth} aria-busy={busyMonth === m.ym} aria-label={t('ownerHub.markReceivedFor', { month: m.label })} className="text-gray-400 text-xs hover:text-white border border-white/10 rounded-lg px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-400">{t('ownerHub.markReceived')}</button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
