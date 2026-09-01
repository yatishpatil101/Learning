import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import { getFees } from '../../lib/store.js';
import { openCashfreeCheckout } from '../../lib/cashfree.js';
import { listPlans } from '../../services/planService.js';
import { usePlan } from '../../context/PlanContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

const checkoutPlans = (t, fees) => ({
  'seeker-plus': { name: 'Seeker Plus', nameLabel: t('misc.coSeekerPlusName'), price: fees.seekerPlusTopup, sub: t('misc.coSeekerPlusSub'), kind: 'topup', icon: 'user-plus', tagline: t('misc.coSeekerPlusTagline'), feats: [t('misc.coSeekerPlusFeat1'), t('misc.coSeekerPlusFeat2'), t('misc.coSeekerPlusFeat3'), t('misc.coSeekerPlusFeat4')], done: { title: t('misc.coSeekerPlusDoneTitle'), body: t('misc.coSeekerPlusDoneBody'), cta: t('misc.coSeekerPlusDoneCta'), href: '/listings' } },
  owner2: { name: 'Owner', nameLabel: t('misc.coOwnerName'), price: fees.ownerPlanYearly, sub: t('misc.coOwnerSub'), kind: 'plan', planName: 'Owner (2 properties)', icon: 'building-2', tagline: t('misc.coOwnerTagline'), feats: [t('misc.coOwnerFeat1'), t('misc.coOwnerFeat2'), t('misc.coOwnerFeat3'), t('misc.coOwnerFeat4')], done: { title: t('misc.coOwnerDoneTitle'), body: t('misc.coOwnerDoneBody'), cta: t('misc.coOwnerDoneCta'), href: '/list-property' } },
  owner5: { name: 'Owner Pro', nameLabel: t('misc.coOwnerProName'), price: fees.ownerProYearly, sub: t('misc.coOwnerProSub'), kind: 'plan', planName: 'Owner Pro (5 properties)', icon: 'briefcase', tagline: t('misc.coOwnerProTagline'), feats: [t('misc.coOwnerProFeat1'), t('misc.coOwnerProFeat2'), t('misc.coOwnerProFeat3'), t('misc.coOwnerProFeat4')], done: { title: t('misc.coOwnerProDoneTitle'), body: t('misc.coOwnerProDoneBody'), cta: t('misc.coOwnerProDoneCta'), href: '/list-property' } },
});
const checkoutMethods = (t) => [
  { id: 'UPI', label: t('misc.coMethodUpiLabel'), desc: t('misc.coMethodUpiDesc'), icon: 'smartphone' },
  { id: 'Card', label: t('misc.coMethodCardLabel'), desc: t('misc.coMethodCardDesc'), icon: 'credit-card' },
  { id: 'Netbanking', label: t('misc.coMethodNetbankingLabel'), desc: t('misc.coMethodNetbankingDesc'), icon: 'landmark' },
];
const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');

export default function Checkout() {
  const { t } = useTranslation();
  const { isIn } = useAuth();
  const { planId: currentPlanId, subscribe, refresh } = usePlan();
  const [params] = useSearchParams();
  const planId = params.get('plan');
  const CO = checkoutPlans(t, getFees());
  const METHODS = checkoutMethods(t);
  const base = CO[planId];
  const [method, setMethod] = useState('UPI');
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  /** The subscription the server returned. `null` until Pay completes. */
  const [result, setResult] = useState(null);
  const [orderRef, setOrderRef] = useState('');
  /** Server price for this plan, once the catalogue resolves. See the note in `Plans.jsx`. */
  const [serverPrice, setServerPrice] = useState(null);

  useEffect(() => {
    let alive = true;
    listPlans()
      .then((rows) => {
        const row = rows.find((r) => r.slug === planId);
        if (alive && row) setServerPrice(row.price);
      })
      // Falls back to the configured fee. The charge is the server's either way — this only
      // affects which number is shown while the catalogue is unreachable.
      .catch(() => {});
    return () => { alive = false; };
  }, [planId]);

  // The amount charged is the server's plan row, so that is the one to display. Showing the
  // back-office fee here was how a customer came to click "Pay ₹999" and be billed ₹2,499.
  const P = base && { ...base, price: serverPrice ?? base.price };

  const pay = async () => {
    if (paying || result) return;
    setPaying(true);
    setError('');
    try {
      const sub = await subscribe(planId, method.toLowerCase());
      /* The reference the customer quotes at support. `paymentRef` is the gateway's own order id
         and is what appears on their bank statement, so it is the useful one; the subscription id
         is the fallback for a free plan, which has no gateway order to point at.

         This used to be `addServiceOrder({...}).id` — a localStorage row written next to a comment
         saying it "drives the mock billing history". It did not: `BillingPanel` renders a static
         `BILLING_HISTORY` constant and `getServiceOrders()` had no callers at all. So the browser
         was minting an order number for a record nobody could ever look up, and handing it to the
         customer as the thing to quote. */
      setOrderRef(sub?.paymentRef || sub?.id || '');

      // Option A hosted checkout: a pending subscription carrying a session id means the server
      // opened a real Cashfree order. Hand off to Cashfree's own hosted checkout, then re-read the
      // subscription — the signature-verified webhook, not this browser, is what activates it, so
      // the screen reflects `/me/subscription` rather than treating the modal closing as success.
      if (sub?.status === 'pending' && sub?.paymentSessionId) {
        await openCashfreeCheckout(sub.paymentSessionId);
        setResult(await refresh());
      } else {
        // Mock provider, or a free plan that is active immediately — there is no gateway to visit.
        setResult(sub);
      }
    } catch {
      // A failed subscribe must not render the success screen. The user keeps their money and
      // the Pay button, which is the only recoverable outcome.
      setError(t('misc.coPaymentFailed'));
    } finally {
      setPaying(false);
    }
  };

  if (!base) return <Navigate to="/plans" replace />;
  if (!isIn) return <Navigate to={`/signin?next=${encodeURIComponent('/checkout?plan=' + planId)}`} replace />;

  // `pending` is not `paid`. For a priced plan the server opens a gateway order and waits for the
  // payment webhook; only that webhook activates the subscription. Telling someone the purchase
  // landed before the money has is the one outcome worth designing against here.
  const paid = result?.status === 'active';
  const pending = result?.status === 'pending';

  // Guard against paying twice for a plan you already hold. Subscriptions (owner2/
  // owner5) persist via the plan context; the one-time Seeker Plus top-up has no lasting
  // ownership, so it stays re-purchasable. Shown before payment (not after — the
  // success screen still needs to render for a purchase just made this session).
  const alreadyOnThisPlan = P.kind === 'plan' && !result && currentPlanId === planId;

  return (
    <div className="pt-8 sm:pt-10 pb-20 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <Link to="/plans" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors mb-5"><Icon name="arrow-left" className="w-4 h-4" /> {t('misc.coBackToPricing')}</Link>
      <h1 className="text-2xl sm:text-3xl font-extrabold mb-1">{t('misc.coTitle')}</h1>
      <p className="text-gray-400 text-sm mb-7">{t('misc.coSubtitle')} <span className="text-gray-500">{t('misc.coBrokerage')}</span></p>

      {alreadyOnThisPlan ? (
        <div className="glass rounded-2xl p-8 sm:p-10 max-w-lg mx-auto text-center">
          <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-5" style={{ background: 'rgba(16,185,129,.15)' }}><Icon name="badge-check" className="w-9 h-9 text-emerald-400" /></div>
          <h2 className="text-xl font-extrabold mb-1">{t('misc.coAlreadyActiveTitle')}</h2>
          <p className="text-gray-400 text-sm mb-6">{t('misc.coAlreadyActiveBody', { plan: P.nameLabel })}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/dashboard#billing" className="btn-teal px-5 py-2.5 rounded-xl font-semibold text-sm">{t('misc.coManagePlan')}</Link>
            <Link to="/plans" className="px-5 py-2.5 rounded-xl font-semibold text-sm border border-white/10 text-gray-200 hover:bg-white/5 transition-colors">{t('misc.coViewPlans')}</Link>
          </div>
        </div>
      ) : pending ? (
        <div className="glass rounded-2xl p-8 sm:p-10 max-w-lg mx-auto text-center">
          <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-5" style={{ background: 'rgba(245,158,11,.15)' }}><Icon name="clock" className="w-9 h-9 text-amber-400" /></div>
          <h2 className="text-xl font-extrabold mb-1">{t('misc.coPaymentPending')}</h2>
          <p className="text-gray-400 text-sm mb-1">{P.done.title} · {inr(P.price)} {t('misc.coPaidVia')} {method}</p>
          <p className="text-gray-400 text-sm mb-2">{t('misc.coPaymentPendingBody')}</p>
          {orderRef && <p className="text-gray-500 text-xs mb-6">{t('misc.coOrderReference')} · <span className="text-gray-400 font-mono">{orderRef}</span></p>}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/dashboard#billing" className="btn-teal px-5 py-2.5 rounded-xl font-semibold text-sm">{t('misc.coManagePlan')}</Link>
            <Link to="/plans" className="px-5 py-2.5 rounded-xl font-semibold text-sm border border-white/10 text-gray-200 hover:bg-white/5 transition-colors">{t('misc.coViewPlans')}</Link>
          </div>
        </div>
      ) : paid ? (
        <div className="glass rounded-2xl p-8 sm:p-10 max-w-lg mx-auto text-center">
          <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-5" style={{ background: 'rgba(16,185,129,.15)' }}><Icon name="check-circle-2" className="w-9 h-9 text-emerald-400" /></div>
          <h2 className="text-xl font-extrabold mb-1">{t('misc.coPaymentSuccess')}</h2>
          <p className="text-gray-400 text-sm mb-1">{P.done.title} · {inr(P.price)} {t('misc.coPaidVia')} {method}</p>
          <p className="text-gray-400 text-sm mb-2">{P.done.body}</p>
          {orderRef && <p className="text-gray-500 text-xs mb-6">{t('misc.coOrderReference')} · <span className="text-gray-400 font-mono">{orderRef}</span></p>}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to={P.done.href} className="btn-teal px-5 py-2.5 rounded-xl font-semibold text-sm">{P.done.cta}</Link>
            <Link to="/dashboard" className="px-5 py-2.5 rounded-xl font-semibold text-sm border border-white/10 text-gray-200 hover:bg-white/5 transition-colors">{t('misc.coGoToDashboard')}</Link>
          </div>
          <p className="text-gray-600 text-[11px] mt-5">{t('misc.coPrototypeLocal')}</p>
        </div>
      ) : (
        <>
        <div className="grid md:grid-cols-2 gap-6 items-start">
          {/* Order summary */}
          <div className="glass rounded-2xl p-5 sm:p-6">
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-4">{t('misc.coOrderSummary')}</h2>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(20,184,166,.14)' }}><Icon name={P.icon} className="w-5 h-5 text-teal-400" /></div>
              <div><h3 className="text-lg font-extrabold leading-tight">{P.nameLabel}</h3><p className="text-teal-300 text-sm font-medium">{P.tagline}</p></div>
            </div>
            <ul className="space-y-2.5 mb-5">
              {P.feats.map((f) => <li key={f} className="flex gap-2 text-sm text-gray-300"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" /> {f}</li>)}
            </ul>
            <div className="border-t border-white/8 pt-4 space-y-2 text-sm">
              <div className="flex justify-between text-gray-400"><span>{P.nameLabel} <span className="text-gray-600">({P.sub})</span></span><span className="text-gray-200">{inr(P.price)}</span></div>
              <div className="flex justify-between text-gray-500 text-xs"><span>{t('misc.coTaxes')}</span><span>{t('misc.coIncluded')}</span></div>
              <div className="flex justify-between font-bold text-base pt-2 border-t border-white/8 mt-2"><span>{t('misc.coTotal')}</span><span>{inr(P.price)}</span></div>
            </div>
          </div>

          {/* Payment method */}
          <div className="glass rounded-2xl p-5 sm:p-6">
            <h2 id="co-method-label" className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-4">{t('misc.coPaymentMethod')}</h2>
            <div role="radiogroup" aria-labelledby="co-method-label" className="space-y-2.5 mb-5">
              {METHODS.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={m.id === method} onClick={() => setMethod(m.id)} className={'method w-full flex items-center gap-3 text-left' + (m.id === method ? ' active' : '')}>
                  <Icon name={m.icon} className="w-5 h-5 text-teal-400 flex-shrink-0" />
                  <span className="flex-1"><span className="block text-sm font-semibold">{m.label}</span><span className="block text-xs text-gray-500">{m.desc}</span></span>
                  <Icon name={m.id === method ? 'check-circle-2' : 'circle'} className={'w-4 h-4 ' + (m.id === method ? 'text-teal-400' : 'text-gray-600')} />
                </button>
              ))}
            </div>
            <button onClick={pay} disabled={paying} className="btn-teal w-full py-3 rounded-xl font-semibold hidden md:inline-flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed">{paying ? <><Icon name="loader-2" className="w-4 h-4 animate-spin" /> {t('misc.coProcessing')}</> : <><Icon name="lock" className="w-4 h-4" /> {t('misc.coPay')} {inr(P.price)}</>}</button>
            {error && <p role="alert" className="text-rose-300 text-xs text-center mt-3">{error}</p>}
            <p className="text-gray-500 text-[11px] text-center mt-3 flex items-center justify-center gap-1.5"><Icon name="shield-check" className="w-3.5 h-3.5" /> {t('misc.coPrototypeNoPayment')}</p>
          </div>
        </div>

        {/* Mobile sticky pay bar — keeps the total and pay action reachable without
            scrolling. In-flow (sticky, not fixed) so it releases naturally at the footer. */}
        <div className="md:hidden sticky bottom-0 z-30 -mx-4 sm:-mx-6 mt-6 border-t border-white/10 bg-[#0f0d1a]/95 backdrop-blur-xl px-4 sm:px-6 py-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}>
          <div className="flex items-center gap-4">
            <div className="shrink-0">
              <p className="text-[11px] text-gray-500 leading-none mb-1">{t('misc.coTotal')}</p>
              <p className="text-lg font-extrabold leading-none">{inr(P.price)}</p>
            </div>
            <button onClick={pay} disabled={paying} className="btn-teal flex-1 py-3 rounded-xl font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed">{paying ? <><Icon name="loader-2" className="w-4 h-4 animate-spin" /> {t('misc.coProcessing')}</> : <><Icon name="lock" className="w-4 h-4" /> {t('misc.coPay')}</>}</button>
          </div>
        </div>
        </>
      )}
    </div>
  );
}
