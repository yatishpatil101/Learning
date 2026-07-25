import NativeSelect from '../../components/ui/NativeSelect.jsx';
import { useMemo, useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAppFlags } from '../../context/AppFlagsContext.jsx';
import PayRentComingSoon from './PayRentComingSoon.jsx';
import {
  getTenancies, getPayoutAccount, savePayoutAccount, getRentLedger, myMobile,
  getRentPayments, addRentPayment, calcRentFee, digits,
} from '../../lib/store.js';
import { pay as payRentEngine, thisMonth } from '../../lib/rentPay.js';
import { generateSingle } from '../../lib/rentReceipt.js';

const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const numv = (s) => parseInt(String(s || '').replace(/[^\d]/g, ''), 10) || 0;

export default function PayRent() {
  const { t: tr } = useTranslation();
  const { toast } = useToast();
  const { flagEnabled } = useAppFlags();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState('pay');
  const [account, setAccount] = useState(() => getPayoutAccount());
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payForm, setPayForm] = useState({ name: '', vpa: '', acct: '', ifsc: '', pan: '' });
  const [tenancies] = useState(() => getTenancies());
  const [tIdx, setTIdx] = useState(0);
  const [amt, setAmt] = useState(() => String((getTenancies()[0]?.rent) || ''));
  const [month, setMonth] = useState(() => thisMonth());
  const [pan, setPan] = useState('');
  const [method, setMethod] = useState('UPI');
  const [autopay, setAutopay] = useState(false);
  const [df, setDf] = useState({ amt: '100000', tenure: '6' });
  const [history, setHistory] = useState(() => getRentPayments());

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
  const brk = useMemo(() => calcRentFee(numv(amt)), [amt]);
  const emi = useMemo(() => {
    const a = numv(df.amt), n = parseInt(df.tenure, 10);
    const e = Math.round((a + a * 0.015 * n) / n);
    return { emi: e, total: e * n, n };
  }, [df]);

  const ledgerReceived = useMemo(() => {
    if (!account) return 0;
    return getRentLedger(myMobile()).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  }, [account]);

  const maskAcct = (a) => (a ? a.vpa || (a.accountNumber ? '••••' + a.accountNumber.slice(-4) + (a.ifsc ? ' · ' + a.ifsc : '') : '') : '');

  const linkPayout = () => {
    if (!payForm.name.trim()) { toast(tr('misc.prErrHolderName'), 'error'); return; }
    if (!payForm.vpa && !(payForm.acct && payForm.ifsc)) { toast(tr('misc.prErrVpaOrBank'), 'error'); return; }
    savePayoutAccount({ name: payForm.name, vpa: payForm.vpa, accountNumber: payForm.acct, ifsc: payForm.ifsc, pan: payForm.pan });
    setAccount(getPayoutAccount());
    toast(tr('misc.prAccountVerified'));
  };
  const unlinkPayout = () => {
    savePayoutAccount({ vpa: '', accountNumber: '', ifsc: '', name: '', pan: '', verified: false });
    setAccount(getPayoutAccount());
  };

  const onPayRent = () => {
    if (!tenancy) { toast(tr('misc.prErrNoRental'), 'error'); return; }
    const amount = numv(amt);
    if (!amount) { toast(tr('misc.prErrEnterAmount'), 'error'); return; }
    const ownerMobile = digits(tenancy.ownerMobile || '');
    if (!ownerMobile) { toast(tr('misc.prErrOwnerNotLinked'), 'error'); return; }
    const res = payRentEngine({
      landlord: tenancy.ownerName || 'Landlord', ownerMobile,
      address: tenancy.address || tenancy.title || '', propId: tenancy.propId || '',
      month, amount, method, pan: pan.toUpperCase(), autopay: autopay || /autopay/i.test(method),
    });
    if (!res || !res.ok) { toast(tr('misc.prErrPaymentFailed'), 'error'); return; }
    setHistory(getRentPayments());
    setAccount(getPayoutAccount());
    toast(tr('misc.prPaidToast', { amount: inr(amount), owner: tenancy.ownerName || tr('misc.prOwnerFallback') }) + ' ' + (res.receipt ? tr('misc.prHraDownloaded') : tr('misc.prReceiptSaved')));
    setTab('history');
  };

  const financeDeposit = () => {
    addRentPayment({ type: 'deposit-finance', to: 'Security deposit', amount: numv(df.amt), tenure: parseInt(df.tenure, 10), status: 'approved' });
    setHistory(getRentPayments());
    toast(tr('misc.prDepositApproved'));
    setTab('history');
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

  if (!flagEnabled('onlineRentPayment')) return <PayRentComingSoon />;

  return (
    <main className="pt-8 sm:pt-10 pb-20 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <h1 className="text-2xl sm:text-3xl font-extrabold mb-1">{tr('misc.prTitle')}</h1>
      <p className="text-gray-400 text-sm mb-6">{tr('misc.prSubtitle')}</p>

      {/* Owner payout */}
      <section className="glass rounded-2xl p-5 mb-6">
        {account && (account.vpa || account.accountNumber) ? (
          <>
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div><h3 className="font-bold flex items-center gap-2"><Icon name="landmark" className="w-4 h-4 text-teal-400" /> {tr('misc.prYourPayoutAccount')}</h3>
                <p className="text-sm text-gray-400 mt-1"><span className="inline-flex items-center gap-1 text-emerald-300"><Icon name="badge-check" className="w-3.5 h-3.5" /> {tr('misc.prVerified')}</span> · {tr('misc.prRentSettlesTo')} <b className="text-gray-200">{maskAcct(account)}</b></p></div>
              <div className="text-right"><p className="text-2xl font-extrabold text-emerald-300">{inr(ledgerReceived)}</p><p className="text-[11px] text-gray-500">{tr('misc.prReceivedVia')}</p></div>
            </div>
            <div className="mt-3">
              {getRentLedger(myMobile()).slice(0, 4).map((e) => (
                <div key={e.id} className="flex items-center justify-between text-sm py-1.5 border-t border-white/5"><span className="text-gray-300">{(e.from || 'Tenant') + ' · ' + (e.month || '')}</span><span className="text-emerald-300 font-semibold">{inr(e.amount)}</span></div>
              ))}
              {!getRentLedger(myMobile()).length && <p className="text-gray-500 text-xs pt-2">{tr('misc.prNoRentYet')}</p>}
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

      <div className="flex gap-2 mb-6">{tabBtn('pay', tr('misc.prTabPay'))}{tabBtn('deposit', tr('misc.prTabDeposit'))}{tabBtn('history', tr('misc.prTabHistory'))}</div>

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

      {/* Deposit financing */}
      {tab === 'deposit' && (
        <section className="grid md:grid-cols-2 gap-6">
          <div className="glass rounded-2xl p-6 space-y-4">
            <h2 className="font-bold flex items-center gap-2"><Icon name="hand-coins" className="w-5 h-5 text-teal-400" /> {tr('misc.prSplitDeposit')}</h2>
            <p className="text-gray-400 text-sm">{tr('misc.prSplitBody')}</p>
            <div><label className="text-xs text-gray-400">{tr('misc.prSecurityDeposit')}</label><input value={df.amt} onChange={(e) => setDf({ ...df, amt: e.target.value })} className="fld mt-1" inputMode="numeric" /></div>
            <div><label className="text-xs text-gray-400">{tr('misc.prTenure')}</label>
              <NativeSelect value={df.tenure} onChange={(e) => setDf({ ...df, tenure: e.target.value })} className="fld w-full mt-1"><option value="3">{tr('misc.prMonths3')}</option><option value="6">{tr('misc.prMonths6')}</option><option value="12">{tr('misc.prMonths12')}</option></NativeSelect></div>
            <div className="rounded-xl border border-teal-500/25 p-4" style={{ background: 'rgba(20,184,166,.07)' }}>
              <div className="flex items-center justify-between"><span className="text-gray-300 text-sm">{tr('misc.prYourEmi')}</span><span className="text-2xl font-extrabold text-teal-300">₹{emi.emi.toLocaleString('en-IN')}/mo</span></div>
              <p className="text-gray-500 text-[11px] mt-1">{tr('misc.prTotalPayable', { total: emi.total.toLocaleString('en-IN'), n: emi.n })}</p>
            </div>
            <button onClick={financeDeposit} className="btn-teal w-full py-3 rounded-xl font-semibold inline-flex items-center justify-center gap-2"><Icon name="badge-indian-rupee" className="w-4 h-4" /> {tr('misc.prFinanceDeposit')}</button>
          </div>
          <div className="glass rounded-2xl p-6">
            <h3 className="font-bold mb-3">{tr('misc.prHowItWorks')}</h3>
            <ol className="space-y-3 text-sm text-gray-300 list-decimal list-inside">
              <li>{tr('misc.prHow1')}</li>
              <li>{tr('misc.prHow2')}</li>
              <li>{tr('misc.prHow3')}</li>
            </ol>
            <p className="text-gray-500 text-xs mt-4">{tr('misc.prHowNote')}</p>
          </div>
        </section>
      )}

      {/* History */}
      {tab === 'history' && (
        <section>
          <div className="space-y-3">
            {history.length ? history.map((p) => {
              const isFin = p.type === 'deposit-finance';
              const settled = !isFin ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 ml-2">{tr('misc.prOwnerCredited')}</span> : '';
              return (
                <div key={p.id} className="glass rounded-xl p-4"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center"><Icon name={isFin ? 'hand-coins' : 'wallet'} className="w-5 h-5 text-teal-400" /></div><div><p className="font-semibold text-sm">{p.to}{settled}</p><p className="text-gray-500 text-xs">{isFin ? tr('misc.prDepFinanceHist', { n: p.tenure }) : (p.method || tr('misc.prPaymentFallback')) + (p.month ? ' · ' + p.month : '')} · {new Date(p.at).toLocaleDateString()}</p>{!isFin && <button onClick={() => downloadReceipt(p)} className="mt-2 text-[12px] text-teal-300 hover:text-teal-200 inline-flex items-center gap-1"><Icon name="download" className="w-3.5 h-3.5" /> {tr('misc.prHraReceipt')}</button>}</div></div><span className="font-bold text-emerald-300">{inr(p.amount || 0)}</span></div></div>
              );
            }) : <p className="text-gray-500 text-sm text-center py-10">{tr('misc.prNoPayments')}</p>}
          </div>
        </section>
      )}
    </main>
  );
}
