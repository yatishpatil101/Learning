import NativeSelect from '../../components/ui/NativeSelect.jsx';
import { useCallback, useMemo, useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAppFlags } from '../../context/AppFlagsContext.jsx';
import PayRentComingSoon from './PayRentComingSoon.jsx';
import { digits } from '../../lib/contact.js';
import { usePricing } from '../../context/PricingContext.jsx';
import {
  myTenancies, getPayoutAccount, savePayoutAccount, rentLedger,
  myRentPayments, payRent as payRentApi,
} from '../../services/rentService.js';
import { quoteRentFee } from '../../services/providers/http/rentMapper.js';
import { thisMonth } from '../../lib/rentPay.js';
import { generateSingle } from '../../lib/rentReceipt.js';

const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const numv = (s) => parseInt(String(s || '').replace(/[^\d]/g, ''), 10) || 0;

/**
 * Pay Rent — the tenant's payment screen and the owner's payout settings, on one page.
 *
 * ## Everything here became async, and one thing became honest
 *
 * The reads were synchronous localStorage lookups keyed by mobile, so any visitor could read any
 * owner's ledger by naming them. They are caller-scoped endpoints now, loaded once into state.
 *
 * More importantly: **paying no longer means paid.** `POST /me/rent-payments` opens a gateway order
 * and returns the row `due`; the webhook settles it. The old flow wrote `status: 'paid'` locally and
 * told the tenant their rent was in. This one says what actually happened.
 */
export default function PayRent() {
  const { t: tr } = useTranslation();
  const { toast } = useToast();
  const { flagEnabled } = useAppFlags();
  // The convenience-fee and GST rates behind the breakdown below. These are the two numbers a
  // tenant is quoted before they commit, and until `GET /pricing` existed the browser had no way
  // to read the ones the platform actually charges — it showed whatever the bundle shipped with.
  const { prices } = usePricing();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState('pay');
  const [account, setAccount] = useState(null);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payForm, setPayForm] = useState({ name: '', vpa: '', acct: '', ifsc: '', pan: '' });
  const [tenancies, setTenancies] = useState([]);
  const [tIdx, setTIdx] = useState(0);
  const [amt, setAmt] = useState('');
  const [month, setMonth] = useState(() => thisMonth());
  const [pan, setPan] = useState('');
  const [method, setMethod] = useState('UPI');
  const [autopay, setAutopay] = useState(false);
  const [paying, setPaying] = useState(false);
  const [history, setHistory] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [ledgerReceived, setLedgerReceived] = useState(0);

  const reload = useCallback(async () => {
    // Four caller-scoped reads, issued together — none depends on another's result and the page
    // blocks on all of them.
    const [tens, acct, hist, ledgerRes] = await Promise.all([
      myTenancies().catch(() => []),
      getPayoutAccount().catch(() => null),
      myRentPayments().catch(() => ({ items: [] })),
      rentLedger().catch(() => ({ items: [] })),
    ]);
    setTenancies(tens || []);
    setAccount(acct);
    setHistory(hist?.items || []);
    setLedger(ledgerRes?.items || []);
    setLedgerReceived((ledgerRes?.items || []).reduce((s, e) => s + (Number(e.amount) || 0), 0));
    return tens || [];
  }, []);

  useEffect(() => {
    let alive = true;
    reload().then((tens) => {
      if (alive && tens?.[0]?.rent) setAmt(String(tens[0].rent));
    }).catch(() => {});
    return () => { alive = false; };
  }, [reload]);

  useEffect(() => {
    const propId = searchParams.get('prop');
    if (propId && tenancies.length > 0) {
      const idx = tenancies.findIndex((t) => t.propId === propId);
      if (idx >= 0) {
        setTIdx(idx);
        setAmt(String(tenancies[idx]?.rent || ''));
      }
    }
  }, [searchParams, tenancies]);

  const tenancy = tenancies[tIdx] || null;
  /* The displayed breakdown, computed locally because the tenant needs a total *before* they commit
     and there is no quote endpoint. The **charged** breakdown is whatever comes back on the payment
     — the two use identical arithmetic (half-up, whole rupees, fee rounded before GST), which is
     what makes showing this one safe. */
  const brk = useMemo(
    () => quoteRentFee(numv(amt), { rentPayPercent: prices.rentPayPercent, gstPercent: prices.gstPercent }),
    [amt, prices.rentPayPercent, prices.gstPercent],
  );

  const maskAcct = (a) => (a ? a.upiId || (a.maskedAccount ? a.maskedAccount + (a.ifsc ? ' · ' + a.ifsc : '') : '') : '');

  const linkPayout = async () => {
    if (!payForm.name.trim()) { toast(tr('misc.prErrHolderName'), 'error'); return; }
    if (!payForm.vpa && !(payForm.acct && payForm.ifsc)) { toast(tr('misc.prErrVpaOrBank'), 'error'); return; }
    try {
      // Reads back a **mask**, not the number — the server will not re-serve a bank account number
      // to anyone, including its owner.
      const saved = await savePayoutAccount({
        accountHolder: payForm.name, upiId: payForm.vpa, accountNumber: payForm.acct, ifsc: payForm.ifsc,
      });
      setAccount(saved);
      toast(tr('misc.prAccountVerified'));
    } catch (err) {
      toast(err?.body?.error || err?.message || tr('misc.prErrPaymentFailed'), 'error');
    }
  };
  const unlinkPayout = async () => {
    try {
      setAccount(await savePayoutAccount({ accountHolder: '', upiId: '', accountNumber: '', ifsc: '' }));
    } catch (err) {
      toast(err?.body?.error || err?.message || tr('misc.prErrPaymentFailed'), 'error');
    }
  };

  const onPayRent = async () => {
    if (!tenancy) { toast(tr('misc.prErrNoRental'), 'error'); return; }
    const amount = numv(amt);
    if (!amount) { toast(tr('misc.prErrEnterAmount'), 'error'); return; }
    const ownerMobile = digits(tenancy.ownerMobile || '');
    if (!ownerMobile) { toast(tr('misc.prErrOwnerNotLinked'), 'error'); return; }
    setPaying(true);
    try {
      /* `expectedAmount` is the figure the tenant was *shown*. If the rent has moved since the page
         loaded the server answers 409 rather than quietly charging the old number — optimistic
         concurrency, and the entire reason the field exists. */
      const payment = await payRentApi({ tenancyId: tenancy.id, expectedAmount: amount, method: String(method).toLowerCase() });
      await reload();
      // `due` is the expected outcome, not a failure. Saying "paid" here would be the one lie this
      // screen must not tell.
      toast(
        payment?.settled
          ? tr('misc.prPaidToast', { amount: inr(amount), owner: tenancy.ownerName || tr('misc.prOwnerFallback') })
          : tr('misc.prPaymentPending', { amount: inr(payment?.total || amount) }),
        payment?.settled ? 'success' : 'info',
      );
      setTab('history');
    } catch (err) {
      toast(err?.body?.error || err?.message || tr('misc.prErrPaymentFailed'), 'error');
    } finally {
      setPaying(false);
    }
  };

  const downloadReceipt = (p) => {
    try {
      generateSingle({ tenant: p.tenant || 'Tenant', landlord: p.to || 'Landlord', address: p.address || '—', rent: p.amount, pan: p.pan || '', mode: p.method || 'UPI', month: p.month || thisMonth(), txnRef: p.id, paidOnline: true });
      toast(tr('misc.prReceiptDownloaded'));
    } catch {
      toast(tr('misc.prErrReceiptGen'), 'error');
    }
  };

  const tabBtn = (id, label) => <button onClick={() => setTab(id)} className={'tabbtn' + (tab === id ? ' active' : '')}>{label}</button>;

  /* The History tab shows real rent payments from the API. The wire's payment shape differs from
     what this list was written against — `dueDate` rather than `at`, and `settled` rather than an
     assumed success — so it is adapted here rather than bending the mapper to a display concern. A
     payment that has not cleared is not labelled as credited to the owner, because it has not been. */
  const historyRows = useMemo(() => ([
    ...history.map((p) => ({
      id: p.id,
      type: 'rent',
      to: tenancies.find((t) => t.id === p.tenancyId)?.ownerName || tr('misc.prOwnerFallback'),
      amount: p.total || p.amount,
      method: p.method,
      month: (p.dueDate || '').slice(0, 7),
      at: p.paidDate || p.dueDate || null,
      settled: p.settled,
    })),
  ]), [history, tenancies, tr]);

  if (!flagEnabled('onlineRentPayment')) return <PayRentComingSoon />;

  return (
    <div className="pt-8 sm:pt-10 pb-20 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <h1 className="text-2xl sm:text-3xl font-extrabold mb-1">{tr('misc.prTitle')}</h1>
      <p className="text-gray-400 text-sm mb-6">{tr('misc.prSubtitle')}</p>

      {/* Owner payout */}
      <section className="glass rounded-2xl p-5 mb-6">
        {account && account.configured ? (
          <>
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div><h3 className="font-bold flex items-center gap-2"><Icon name="landmark" className="w-4 h-4 text-teal-400" /> {tr('misc.prYourPayoutAccount')}</h3>
                <p className="text-sm text-gray-400 mt-1"><span className="inline-flex items-center gap-1 text-emerald-300"><Icon name="badge-check" className="w-3.5 h-3.5" /> {tr('misc.prVerified')}</span> · {tr('misc.prRentSettlesTo')} <b className="text-gray-200">{maskAcct(account)}</b></p></div>
              <div className="text-right"><p className="text-2xl font-extrabold text-emerald-300">{inr(ledgerReceived)}</p><p className="text-[11px] text-gray-500">{tr('misc.prReceivedVia')}</p></div>
            </div>
            <div className="mt-3">
              {ledger.slice(0, 4).map((e) => (
                <div key={e.id} className="flex items-center justify-between text-sm py-1.5 border-t border-white/5"><span className="text-gray-300">{(e.tenantName || 'Tenant') + ' · ' + (e.dueDate || '')}</span><span className="text-emerald-300 font-semibold">{inr(e.amount)}</span></div>
              ))}
              {!ledger.length && <p className="text-gray-500 text-xs pt-2">{tr('misc.prNoRentYet')}</p>}
            </div>
            <button onClick={unlinkPayout} className="mt-3 text-[12px] text-gray-400 hover:text-rose-300">{tr('misc.prChangeAccount')}</button>
          </>
        ) : (
          <>
            {/* Payout setup is a landlord task; on /pay-rent the tenant's job is to pay. Collapse
                this 5-field form on mobile so the tabs + Pay action surface first. Desktop keeps
                it open (lg:block) and hides the toggle chevron (lg:hidden). */}
            <button type="button" onClick={() => setPayoutOpen((o) => !o)} aria-expanded={payoutOpen} aria-controls="pr-payout-panel" className="w-full flex items-center justify-between gap-2 text-left lg:cursor-default">
              <span className="font-bold flex items-center gap-2"><Icon name="landmark" className="w-4 h-4 text-teal-400" /> {tr('misc.prLandlordTitle')}</span>
              <Icon name="chevron-down" className={'w-4 h-4 text-gray-400 flex-shrink-0 transition-transform lg:hidden ' + (payoutOpen ? 'rotate-180' : '')} />
            </button>
            <div id="pr-payout-panel" className={(payoutOpen ? 'block' : 'hidden') + ' lg:block'}>
              <p className="text-sm text-gray-400 mt-1 mb-3">{tr('misc.prLandlordBody')}</p>
              <div className="grid sm:grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-400">{tr('misc.prHolderName')}</label><input value={payForm.name} onChange={(e) => setPayForm({ ...payForm, name: e.target.value })} className="fld mt-1" placeholder={tr('misc.prHolderPlaceholder')} /></div>
              <div><label className="text-xs text-gray-400">{tr('misc.prUpiVpa')} <span className="text-gray-600">{tr('misc.prOrUseBank')}</span></label><input value={payForm.vpa} onChange={(e) => setPayForm({ ...payForm, vpa: e.target.value })} className="fld mt-1" placeholder="name@okhdfcbank" /></div>
              <div><label className="text-xs text-gray-400">{tr('misc.prBankAcct')}</label><input value={payForm.acct} onChange={(e) => setPayForm({ ...payForm, acct: e.target.value.replace(/\D/g, '') })} className="fld mt-1" inputMode="numeric" placeholder="00123456789" /></div>
              <div><label className="text-xs text-gray-400">IFSC</label><input value={payForm.ifsc} onChange={(e) => setPayForm({ ...payForm, ifsc: e.target.value.toUpperCase() })} className="fld mt-1 uppercase" placeholder="HDFC0000123" /></div>
              <div><label className="text-xs text-gray-400">PAN</label><input value={payForm.pan} onChange={(e) => setPayForm({ ...payForm, pan: e.target.value.toUpperCase() })} className="fld mt-1 uppercase tracking-wider" maxLength={10} placeholder="ABCDE1234F" /></div>
            </div>
            <button onClick={linkPayout} className="btn-teal mt-3 px-5 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-2"><Icon name="shield-check" className="w-4 h-4" /> {tr('misc.prVerifyLink')}</button>
            </div>
          </>
        )}
      </section>

      <div className="flex gap-2 mb-6">{tabBtn('pay', tr('misc.prTabPay'))}{tabBtn('history', tr('misc.prTabHistory'))}</div>

      {/* Pay rent */}
      {tab === 'pay' && (
        <section className="grid md:grid-cols-2 gap-6">
          <div className="glass rounded-2xl p-6 space-y-4">
            <h2 className="font-bold flex items-center gap-2"><Icon name="wallet" className="w-5 h-5 text-teal-400" /> {tr('misc.prPayYourRent')}</h2>
            {!tenancy ? (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
                <p className="font-semibold text-white mb-1">{tr('misc.prNoRentalTitle')}</p>
                <p className="text-gray-400 text-[13px]">{tr('misc.prNoRentalBody')}</p>
                <Link to="/listings" className="inline-flex items-center gap-1.5 mt-3 text-teal-300 hover:text-teal-200 text-[13px] font-medium"><Icon name="search" className="w-4 h-4" /> {tr('misc.prBrowseRentals')}</Link>
              </div>
            ) : (
              <>
                {tenancies.length > 1 && (
                  <div><label className="text-xs text-gray-400">{tr('misc.prRental')}</label>
                    <NativeSelect value={String(tIdx)} onChange={(e) => { const i = parseInt(e.target.value, 10) || 0; setTIdx(i); setAmt(String(tenancies[i]?.rent || '')); }} className="fld w-full mt-1">
                      {tenancies.map((t, i) => <option key={i} value={i}>{(t.title || 'Rented property') + (t.ownerName ? ' — ' + t.ownerName : '')}</option>)}
                    </NativeSelect></div>
                )}
                <p className="text-[12px] text-gray-500">{tr('misc.prRentingFinalised')}{tenancy.ownerName ? ' ' + tr('misc.prWith') + ' ' + tenancy.ownerName : ''} · {tenancy.address || tenancy.title || ''} · {tr('misc.prAgreedRent')} ₹{Number(tenancy.rent || 0).toLocaleString('en-IN')}/mo.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs text-gray-400">{tr('misc.prRentMonth')}</label><input value={month} onChange={(e) => setMonth(e.target.value)} type="month" className="fld mt-1" style={{ colorScheme: 'dark' }} /></div>
                  <div><label className="text-xs text-gray-400">{tr('misc.prAmount')}</label><input value={amt} onChange={(e) => setAmt(e.target.value)} className="fld mt-1" inputMode="numeric" placeholder="25000" /></div>
                </div>
                <div><label className="text-xs text-gray-400">{tr('misc.prLandlordPan')} <span className="text-gray-600">{tr('misc.prRentOver1L')}</span></label><input value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} className="fld mt-1 uppercase tracking-wider" maxLength={10} placeholder="ABCDE1234F" /></div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs text-gray-400 whitespace-nowrap" htmlFor="prMethod">{tr('misc.prPayWith')}</label>
                  <div className="w-1/2"><NativeSelect id="prMethod" value={method} onChange={(e) => setMethod(e.target.value)} className="fld w-full"><option>UPI</option><option>UPI Autopay (recurring)</option><option>Credit Card</option><option>Debit Card</option><option>Netbanking</option></NativeSelect></div>
                </div>

                <div className="rounded-xl bg-white/5 border border-white/10 p-3.5 text-sm space-y-1.5">
                  <div className="flex items-center justify-between"><span className="text-gray-400">{tr('misc.prRentToOwner')}</span><span className="font-semibold text-emerald-300">{inr(brk.amount)}</span></div>
                  <div className="flex items-center justify-between"><span className="text-gray-400">{tr('misc.prConvenienceFee', { pct: brk.pct })}</span><span className="text-gray-200">{inr(brk.fee)}</span></div>
                  <div className="flex items-center justify-between"><span className="text-gray-400">{tr('misc.prGstOnFee', { pct: brk.gstPct })}</span><span className="text-gray-200">{inr(brk.gst)}</span></div>
                  <div className="flex items-center justify-between pt-1.5 border-t border-white/10"><span className="text-white font-semibold">{tr('misc.prYouPay')}</span><span className="text-white font-bold">{inr(brk.total)}</span></div>
                </div>

                <label className="flex items-center gap-2 text-xs text-gray-400"><input type="checkbox" checked={autopay} onChange={(e) => setAutopay(e.target.checked)} className="accent-teal-500" /> {tr('misc.prAutopayLabel')}</label>

                <button onClick={onPayRent} className="btn-teal w-full py-3 rounded-xl font-semibold inline-flex items-center justify-center gap-2"><Icon name="indian-rupee" className="w-4 h-4" /> {numv(amt) ? tr('misc.prPayAmount', { amount: inr(brk.total) }) : tr('misc.prPayRentBtn')}</button>
                <p className="text-gray-500 text-[11px] text-center">{tr('misc.prProtoNote1')}</p>
              </>
            )}
          </div>
          <div className="glass rounded-2xl p-6">
            <h3 className="font-bold mb-3 flex items-center gap-2"><Icon name="sparkles" className="w-4 h-4 text-amber-400" /> {tr('misc.prWhyPay')}</h3>
            <ul className="space-y-3 text-sm text-gray-300">
              <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5" /> {tr('misc.prWhy1')}</li>
              <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5" /> {tr('misc.prWhy2a')} <b>{tr('misc.prWhy2b')}</b> {tr('misc.prWhy2c')}</li>
              <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5" /> {tr('misc.prWhy3')}</li>
              <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5" /> {tr('misc.prWhy4')}</li>
            </ul>
            <div className="mt-4 rounded-xl border border-teal-500/20 p-3 text-[12px] text-gray-400" style={{ background: 'rgba(20,184,166,.06)' }}>
              <Icon name="shield-check" className="w-4 h-4 text-teal-400 inline-block mb-1" /> {tr('misc.prSettleNote1')} <b>{tr('misc.prFullRent')}</b>{tr('misc.prSettleNote2')}
            </div>
          </div>
        </section>
      )}

      {/* History */}
      {tab === 'history' && (
        <section>
          <div className="space-y-3">
            {historyRows.length ? historyRows.map((p) => {
              // Only a settled payment is described as credited to the owner. A `due` one has been
              // charged but not cleared, and saying otherwise is the lie this slice exists to stop.
              const settled = p.settled ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 ml-2">{tr('misc.prOwnerCredited')}</span> : '';
              return (
                <div key={p.id} className="glass rounded-xl p-4"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center"><Icon name="wallet" className="w-5 h-5 text-teal-400" /></div><div><p className="font-semibold text-sm">{p.to}{settled}</p><p className="text-gray-500 text-xs">{(p.method || tr('misc.prPaymentFallback')) + (p.month ? ' · ' + p.month : '')}{p.at ? ' · ' + new Date(p.at).toLocaleDateString() : ''}</p><button onClick={() => downloadReceipt(p)} className="mt-2 text-[12px] text-teal-300 hover:text-teal-200 inline-flex items-center gap-1"><Icon name="download" className="w-3.5 h-3.5" /> {tr('misc.prHraReceipt')}</button></div></div><span className="font-bold text-emerald-300">{inr(p.amount || 0)}</span></div></div>
              );
            }) : <p className="text-gray-500 text-sm text-center py-10">{tr('misc.prNoPayments')}</p>}
          </div>
        </section>
      )}
    </div>
  );
}
