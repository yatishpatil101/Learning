import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import DateField from '../../../components/ui/DateField.jsx';
import FieldError from '../../../components/ui/FieldError.jsx';
import { digits } from '../../../lib/contact.js';
import { useSignInGate } from '../../../lib/useSignInGate.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import {
  getDeal, dealStatusForBuyer, reserveDeal, reopenDeal, listParties,
  submitOffer as submitOfferApi, respondOffer, myOffers, offersOnMine,
  requestFinalization, finalizationStatus, cancelFinalization,
  myFinalizationRequests, acceptFinalization, declineFinalization,
} from '../../../services/dealService.js';
import { tenantsVerified } from '../../../services/rentService.js';

const fmtOffer = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN');

/* The transaction panel on a property page: deal state, offer negotiation and maker/checker
   finalization. Every read is caller-scoped and `reload()` re-reads after each mutation rather than
   patching optimistically, because a panel showing an accepted offer the server rejected is worse
   than one that takes a moment to catch up. Owner and buyer read different endpoints. */
export function DealPanel({ p, isIn, toast, contactApproved = false }) {
  const { t } = useTranslation();
  const sendToSignIn = useSignInGate();
  const { user } = useAuth();
  const owner = String(p.ownerMobile || '');
  /* The deal routes parse their path parameter with `Ids.parseUuid` and 404 on anything else, so
     they need the **UUID** — not the seam's `p.id`, which is the listing's slug (`p5015`) because
     the property routes accept slug-or-id and a slug makes a prettier URL. `p.uuid` is the same
     row's real key; the fallback covers mock listings, which have no separate uuid. */
  const propId = String(p.uuid || p.id || '');
  const isRent = p.deal === 'rent';
  const dealKind = isRent ? 'rent' : 'sell';
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerAmt, setOfferAmt] = useState('');
  const [offerErr, setOfferErr] = useState(false);
  const [offerMoveIn, setOfferMoveIn] = useState('');

  /* Read from the session, because the answer picks between two sets of endpoints and must match
     what the API is working from. `!!mine` stops an absent mobile claiming ownership — `digits()`
     of nothing is the empty string. During `loading` the wrong panel costs one round trip; what it
     may not do is decide a navigation, which is why those go through `useSignInGate`. */
  const mine = digits(user?.mobile);
  const isOwner = isIn && !!mine && mine === digits(owner);

  /* Starts in the open state so a slow load shows the live controls rather than a "sold" banner it
     has no evidence for. `verified` starts EMPTY instead, unlike `status`: a badge is a trust
     claim, so the safe default is not to make it. */
  const [state, setState] = useState({
    status: 'active', parties: [], offers: [], myOffer: null, myFinalize: null, pending: [],
    verified: new Set(),
  });

  /* Prefers the row's own `buyerVerified`, the only source that can answer live: a buyer's mobile
     leaves the server irreversibly masked, so it can never equal the number the badge is stored
     against. `state.verified` is the mock-seam fallback, a set of unmasked mobiles. */
  const isVerifiedTenant = (row) => {
    if (row?.buyerVerified === true) return true;
    const d = digits(row?.buyerMobile || '').slice(-10);
    return d.length === 10 && state.verified.has(d);
  };

  const reload = useCallback(async () => {
    if (!propId) return;
    if (isOwner) {
      // Four owner-scoped reads. Issued together because none depends on another's result and the
      // panel blocks on all of them.
      const [deal, parties, offers, requests] = await Promise.all([
        getDeal(propId).catch(() => null),
        listParties(propId).catch(() => []),
        offersOnMine().catch(() => []),
        myFinalizationRequests().catch(() => []),
      ]);
      const ownOffers = (offers || []).filter((o) => String(o.propId) === propId);
      const pending = (requests || []).filter((r) => String(r.propId) === propId);

      /* Fallback badge lookup for seams whose rows do not carry `buyerVerified`; one request for
         the whole panel. Returns nothing against the live API by design — every mobile here is
         masked. An empty set on failure is intended: a missing tick is recoverable, a trust signal
         nobody earned on the screen where an owner picks a tenant is not. */
      const verified = await tenantsVerified([
        ...ownOffers.map((o) => o.buyerMobile),
        ...pending.map((r) => r.buyerMobile),
      ]).catch(() => new Set());

      setState({
        status: deal?.status || 'active',
        parties: parties || [],
        offers: ownOffers,
        myOffer: null,
        myFinalize: null,
        pending,
        verified,
      });
      return;
    }
    const [status, mine, fin] = await Promise.all([
      dealStatusForBuyer(p).catch(() => 'active'),
      isIn ? myOffers().catch(() => []) : Promise.resolve([]),
      // Asked only once the buyer has engaged: the endpoint 404s when nothing is pending, which is
      // the ordinary state of every listing, and the finalize card is gated on `contactApproved`.
      isIn && contactApproved ? finalizationStatus(propId).catch(() => null) : Promise.resolve(null),
    ]);
    setState({
      status: status || 'active',
      parties: [],
      offers: [],
      myOffer: (mine || []).find((o) => String(o.propId) === propId) || null,
      myFinalize: fin,
      pending: [],
      // The badge only ever renders beside a buyer in the owner's lists; a buyer needs none.
      verified: new Set(),
    });
  }, [propId, isOwner, isIn, contactApproved]);

  useEffect(() => { let alive = true; reload().catch(() => { if (alive) { /* keep the open state */ } }); return () => { alive = false; }; }, [reload]);

  const closed = state.status === 'closed';
  const reserved = state.status === 'reserved';
  const dealWord = isRent ? t('property.rentedOutWord') : t('property.soldWord');

  /** Every mutation funnels through here: surface the server's refusal, never a false success. */
  const run = async (fn, okMsg, tone = 'success') => {
    try {
      await fn();
      await reload();
      if (okMsg) toast(okMsg, tone);
    } catch (err) {
      toast(err?.body?.error || err?.message || t('property.actionFailed'), 'error');
    }
  };

  const doFinalize = () => {
    if (!isIn) { sendToSignIn('offer'); return; }
    if (isOwner) {
      // Closing needs an agreed price and the counterparty's real mobile, neither of which this
      // panel collects; the dashboard's finalize modal does.
      toast(t('property.finalizeInDashboard'), 'info');
      return;
    }
    // The buyer proposes at the listed price against the listing's owner. Both are required by
    // `FinalizationCreateRequest`; neither was sent before.
    run(
      () => requestFinalization(propId, { counterpartyMobile: owner, agreedPrice: Number(p.price) || 0 }),
      t('property.finalizeRequestSent'),
    );
  };
  const cancelReq = () => run(() => cancelFinalization(propId), t('property.finalizeWithdrawn'), 'info');
  const accept = (id) => run(() => acceptFinalization(id), t('property.dealFinalizedClosed'));
  const decline = (id) => run(() => declineFinalization(id), t('property.requestDeclinedActive'), 'info');
  const reopen = () => run(() => reopenDeal(propId), t('property.listingReopened'));
  const markUO = () => {
    if (!isIn) { sendToSignIn('offer'); return; }
    run(() => reserveDeal(propId), t('property.markedUnderOffer'));
  };

  const submitOffer = () => {
    const amt = parseInt(String(offerAmt).replace(/[^\d]/g, ''), 10) || 0;
    if (!amt) { setOfferErr(true); toast(t('property.enterAmount'), 'info'); return; }
    setOfferErr(false);
    const existing = state.myOffer;
    // A second live offer on one listing is a 409, so revising means countering the existing one.
    // A buyer countering is the one response the server allows them.
    const call = existing
      ? () => respondOffer(existing.id, 'counter', amt, { isOwner: false, propId })
      : () => submitOfferApi({ propId, amount: amt, moveIn: offerMoveIn, deal: isRent ? 'rent' : 'buy' });
    setOfferOpen(false); setOfferAmt(''); setOfferMoveIn('');
    run(call, t('property.offerSent'));
  };
  const ownerOfferAct = (id, action) => {
    if (action === 'counter') {
      const v = window.prompt(t('property.counterPrompt'));
      const a = parseInt(String(v || '').replace(/[^\d]/g, ''), 10);
      if (!a) return;
      run(() => respondOffer(id, 'counter', a, { isOwner: true, propId }),
        t('property.counterSent'));
      return;
    }
    run(() => respondOffer(id, action, null, { isOwner: true, propId }),
      action === 'accept' ? t('property.offerAccepted') : t('property.offerDeclined'));
  };
  /* The buyer agreeing to the owner's counter. Accept and decline are the owner's decision alone
     (the server refuses a buyer's accept with 403), so countering at the owner's own number is the
     one response a buyer is allowed that says "yes, that price". */
  const agreeToCounter = (offer) => run(
    () => respondOffer(offer.id, 'counter', offer.amount, { isOwner: false, propId }),
    t('property.agreedAwaitingOwner'),
  );
  const openOffer = () => {
    if (!isIn) { sendToSignIn('offer'); return; }
    setOfferAmt(state.myOffer ? String(state.myOffer.amount || '') : '');
    setOfferOpen(true);
  };

  const cardCls = 'glass-strong rounded-2xl p-5';

  const renderFinalize = () => {
    // A closed sale is terminal for a buyer: the top banner already says sold/rented, and the card
    // offers closing services and a reopen only the owner can use.
    if (closed && !isOwner) return null;
    if (closed) {
      return (
        <div className={cardCls + ' border border-emerald-500/20'} style={{ background: 'rgba(16,185,129,.06)' }}>
          <div className="flex items-center gap-2 mb-1.5"><Icon name="badge-check" className="w-5 h-5 text-emerald-400" /><h3 className="text-white font-bold text-sm">{t('property.dealFinalizedTitle')}</h3></div>
          <p className="text-slate-400 text-xs mb-3">{t('property.markedWord', { word: dealWord })}{isOwner ? '' : t('property.closedForEnquiries')}</p>
          <div className="flex gap-2">
            <Link to={`/services?finalize=${dealKind}`} className="btn-teal flex-1 flex items-center justify-center gap-1.5 py-2 px-3 text-xs"><Icon name="layout-grid" className="w-3.5 h-3.5" /> {t('property.closingServices')}</Link>
            {isOwner ? <button type="button" onClick={reopen} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-white/10 text-slate-300 text-xs font-medium hover:bg-white/5"><Icon name="rotate-ccw" className="w-3.5 h-3.5" /> {t('property.reopen')}</button> : null}
          </div>
        </div>
      );
    }
    if (reserved) {
      if (isOwner) {
        const parties = state.parties;
        return (
          <div className={cardCls + ' border border-amber-500/20'} style={{ background: 'rgba(245,158,11,.06)' }}>
            <div className="flex items-center gap-2 mb-1.5"><Icon name="handshake" className="w-5 h-5 text-amber-400" /><h3 className="text-white font-bold text-sm">{t('property.underOffer')}</h3></div>
            <p className="text-slate-400 text-xs mb-3">{parties.length ? t('property.finalizingParties', { count: parties.length }) : ''}{t('property.underOfferTokenNote')}</p>
            <div className="flex gap-2">
              <button type="button" onClick={doFinalize} className="btn-teal flex-1 flex items-center justify-center gap-1.5 py-2 px-3 text-xs"><Icon name="badge-check" className="w-3.5 h-3.5" /> {t('property.finalize')}</button>
              <button type="button" onClick={reopen} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-white/10 text-slate-300 text-xs font-medium hover:bg-white/5"><Icon name="rotate-ccw" className="w-3.5 h-3.5" /> {t('property.release')}</button>
            </div>
          </div>
        );
      }
      const stR = isIn ? (state.myFinalize ? state.myFinalize.status : 'none') : 'none';
      return (
        <div className={cardCls + ' border border-amber-500/20'} style={{ background: 'rgba(245,158,11,.06)' }}>
          <div className="flex items-center gap-2 mb-1.5"><Icon name="handshake" className="w-5 h-5 text-amber-400" /><h3 className="text-white font-bold text-sm">{t('property.underOfferRegisterTitle')}</h3></div>
          <p className="text-slate-400 text-xs mb-3">{stR === 'pending' ? t('property.interestRegistered') : t('property.someoneFinalizing')}</p>
          {stR === 'pending'
            ? <button type="button" onClick={cancelReq} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/10 text-slate-300 text-xs font-medium hover:bg-white/5"><Icon name="x" className="w-3.5 h-3.5" /> {t('property.withdrawInterest')}</button>
            : <button type="button" onClick={doFinalize} className="btn-teal w-full flex items-center justify-center gap-2 py-2.5 px-4 text-sm"><Icon name="bell-plus" className="w-4 h-4" /> {t('property.registerBackupInterest')}</button>}
        </div>
      );
    }
    if (isOwner) {
      const pend = state.pending;
      if (pend.length) {
        return (
          <div className={cardCls + ' border border-emerald-500/20'} style={{ background: 'rgba(16,185,129,.06)' }}>
            <div className="flex items-center gap-2 mb-1.5"><Icon name="user-check" className="w-5 h-5 text-amber-400" /><h3 className="text-white font-bold text-sm">{t('property.finalizeRequests', { count: pend.length })}</h3></div>
            <p className="text-slate-400 text-xs mb-3">{isRent ? t('property.finalizeAskedTenant', { count: pend.length }) : t('property.finalizeAskedBuyer', { count: pend.length })}</p>
            {pend.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 mb-2 rounded-lg bg-white/5 px-3 py-2">
                <span className="text-slate-200 text-xs flex items-center gap-1.5 min-w-0 truncate"><Icon name="user" className="w-3.5 h-3.5 text-brand-teal-3 flex-shrink-0" /> {r.buyerName}{isVerifiedTenant(r) ? <span className="text-emerald-300" style={{ fontWeight: 600 }}> · ✓ {t('property.verifiedTenant')}</span> : null}</span>
                <span className="flex gap-1.5 flex-shrink-0">
                  <button type="button" onClick={() => accept(r.id)} className="btn-teal py-1 px-3 text-[.72rem] rounded-lg shadow-none">{t('property.accept')}</button>
                  <button type="button" onClick={() => decline(r.id)} className="text-slate-400 hover:text-red-400 text-xs px-1.5">{t('property.decline')}</button>
                </span>
              </div>
            ))}
            <button type="button" onClick={doFinalize} className="w-full mt-1.5 text-[11px] text-slate-500 hover:text-slate-300">{t('property.finalizeDirectly')}</button>
          </div>
        );
      }
      return (
        <div className={cardCls + ' border border-emerald-500/20'} style={{ background: 'rgba(16,185,129,.06)' }}>
          <div className="flex items-center gap-2 mb-1.5"><Icon name="handshake" className="w-5 h-5 text-emerald-400" /><h3 className="text-white font-bold text-sm">{t('property.closedDealQ')}</h3></div>
          <p className="text-slate-400 text-xs mb-3">{t('property.closedDealBodyPre')}<b className="text-amber-300">{t('property.underOffer')}</b>{t('property.closedDealBodyPost')}</p>
          <button type="button" onClick={doFinalize} className="btn-teal w-full flex items-center justify-center gap-2 py-2.5 px-4 text-sm"><Icon name="badge-check" className="w-4 h-4" /> {t('property.finalizeDeal')}</button>
          <button type="button" onClick={markUO} className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-amber-400/30 text-amber-200 text-xs font-semibold hover:bg-amber-400/10"><Icon name="handshake" className="w-3.5 h-3.5" /> {t('property.markAsUnderOffer')}</button>
        </div>
      );
    }
    const st = isIn ? (state.myFinalize ? state.myFinalize.status : 'none') : 'none';
    if (st === 'pending') {
      return (
        <div className={cardCls + ' border border-emerald-500/20'} style={{ background: 'rgba(16,185,129,.06)' }}>
          <div className="flex items-center gap-2 mb-1.5"><Icon name="hourglass" className="w-5 h-5 text-amber-400" /><h3 className="text-white font-bold text-sm">{t('property.finalizeRequested')}</h3></div>
          <p className="text-slate-400 text-xs mb-3">{t('property.waitingOwnerConfirm')}</p>
          <button type="button" onClick={cancelReq} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/10 text-slate-300 text-xs font-medium hover:bg-white/5"><Icon name="x" className="w-3.5 h-3.5" /> {t('property.withdrawRequest')}</button>
        </div>
      );
    }
    const declined = st === 'declined';
    // Finalising is an end-of-deal step, so don't lead a cold buyer with it: surface only once they
    // have engaged (contact approved) or already tried and were turned down.
    if (!declined && !contactApproved) return null;
    return (
      <div className={cardCls + ' border border-emerald-500/20'} style={{ background: 'rgba(16,185,129,.06)' }}>
        <div className="flex items-center gap-2 mb-1.5"><Icon name="handshake" className="w-5 h-5 text-emerald-400" /><h3 className="text-white font-bold text-sm">{t('property.closingDealQ')}</h3></div>
        <p className="text-slate-400 text-xs mb-3">{declined ? t('property.ownerNotConfirmed') : t('property.agreedSendRequest')}</p>
        <button type="button" onClick={doFinalize} className="btn-teal w-full flex items-center justify-center gap-2 py-2.5 px-4 text-sm"><Icon name="badge-check" className="w-4 h-4" /> {t('property.requestToFinalize')}</button>
      </div>
    );
  };

  const renderOffers = () => {
    // A closed listing takes no more offers from anyone; the buyer's negotiate card is hidden (Q2).
    // A reserved listing still takes offers (Q3), so it falls through to the normal render.
    if (closed && !isOwner) return null;
    if (isOwner) {
      const offers = state.offers.filter((o) => o.status !== 'declined');
      return (
        <div className={cardCls}>
          {!offers.length ? (
            <>
              <div className="flex items-center gap-2 mb-1"><Icon name="gavel" className="w-5 h-5 text-amber-400" /><h3 className="text-white font-bold text-sm">{t('property.offers')}</h3></div>
              <p className="text-slate-400 text-xs">{t('property.noOffersYet')}</p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2"><Icon name="gavel" className="w-5 h-5 text-amber-400" /><h3 className="text-white font-bold text-sm">{t('property.offersCount', { count: offers.length })}</h3></div>
              {offers.map((o) => (
                <div key={o.id} className="rounded-lg bg-white/5 px-3 py-2.5 mb-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-200 text-sm font-semibold">{fmtOffer(o.amount)}</span>
                    <span className="text-[11px]">
                      {o.status === 'accepted' ? <span className="text-emerald-300">{t('property.statusAccepted')}</span>
                        : (o.status === 'countered' && o.from === 'owner') ? <span className="text-amber-300">{t('property.statusYouCountered')}</span>
                        : (o.status === 'countered' && o.from === 'buyer') ? <span className="text-indigo-300">{t('property.statusBuyerCountered')}</span>
                        : <span className="text-slate-300">{t('property.statusPending')}</span>}
                    </span>
                  </div>
                  <p className="text-slate-500 text-[11px] mt-0.5">{o.buyerName || t('property.buyerFallback')}{isVerifiedTenant(o) ? <span style={{ color: '#6ee7b7', fontWeight: 600 }}> · ✓ {t('property.verifiedTenant')}</span> : null}{o.moveIn ? t('property.moveInPrefix', { date: o.moveIn }) : ''}</p>
                  {o.status !== 'accepted' ? (
                    <div className="flex gap-1.5 mt-2">
                      <button onClick={() => ownerOfferAct(o.id, 'accept')} className="btn-teal text-[11px] px-2.5 py-1 rounded-lg shadow-none">{t('property.accept')}</button>
                      <button onClick={() => ownerOfferAct(o.id, 'counter')} className="text-[11px] px-2.5 py-1 rounded-lg border border-white/15 text-slate-200">{t('property.counter')}</button>
                      <button onClick={() => ownerOfferAct(o.id, 'decline')} className="text-[11px] px-2 py-1 text-slate-400 hover:text-red-400">{t('property.decline')}</button>
                    </div>
                  ) : null}
                </div>
              ))}
            </>
          )}
        </div>
      );
    }
    const my = state.myOffer;
    if (my) {
      return (
        <div className={cardCls}>
          <div className="flex items-center gap-2 mb-1"><Icon name="gavel" className="w-5 h-5 text-amber-400" /><h3 className="text-white font-bold text-sm">{t('property.yourOffer')}</h3></div>
          <p className="text-slate-400 text-xs mb-3">
            {my.status === 'accepted' ? <span className="text-emerald-300 font-semibold">{t('property.acceptedByOwner')}</span>
              : (my.status === 'countered' && my.from === 'owner') ? <>{t('property.ownerCounteredAt')}<b className="text-amber-300">{fmtOffer(my.amount)}</b></>
              : my.status === 'countered' ? <>{t('property.yourCounterPending')}<b className="text-white">{fmtOffer(my.amount)}</b></>
              : my.status === 'declined' ? <span className="text-rose-300">{t('property.declinedTryNew')}</span>
              : <>{t('property.yourOfferPendingPre')}<b className="text-white">{fmtOffer(my.amount)}</b>{t('property.yourOfferPendingPost')}</>}
          </p>
          {my.status === 'countered' && my.from === 'owner' ? (
            <div className="flex gap-2">
              <button onClick={() => agreeToCounter(my)} className="btn-teal flex-1 py-2 rounded-lg text-xs font-semibold">{t('property.agreeAt', { amount: fmtOffer(my.amount) })}</button>
              <button onClick={openOffer} className="flex-1 py-2 rounded-lg text-xs border border-white/15 text-slate-200">{t('property.counter')}</button>
            </div>
          ) : (
            <button onClick={openOffer} className="btn-teal w-full py-2.5 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-1.5"><Icon name="repeat" className="w-4 h-4" /> {t('property.reviseOffer')}</button>
          )}
        </div>
      );
    }
    return (
      <div className={cardCls}>
        <div className="flex items-center gap-2 mb-1"><Icon name="gavel" className="w-5 h-5 text-amber-400" /><h3 className="text-white font-bold text-sm">{t('property.negotiatePrice')}</h3></div>
        <p className="text-slate-400 text-xs mb-3">{t('property.negotiateBody')}</p>
        <button onClick={openOffer} className="btn-teal w-full py-2.5 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-1.5"><Icon name="gavel" className="w-4 h-4" /> {t('property.makeOffer')}</button>
      </div>
    );
  };

  return (
    <>
      {closed ? (
        <div className="rounded-2xl px-5 py-4 flex items-center gap-3 border border-rose-500/25" style={{ background: 'rgba(244,63,94,.08)' }}>
          <div className="w-10 h-10 rounded-xl bg-rose-500/15 flex items-center justify-center flex-shrink-0"><Icon name="lock" className="w-5 h-5 text-rose-300" /></div>
          <div>
            <p className="text-white font-semibold text-sm">{isOwner ? t('property.youFinalizedDeal') : t('property.noLongerAvailable')}</p>
            <p className="text-slate-400 text-xs mt-0.5">{isOwner ? t('property.yourListingMarkedSub', { word: dealWord }) : t('property.propertyBeenSub', { word: dealWord })}</p>
          </div>
        </div>
      ) : reserved ? (
        <div className="rounded-2xl px-5 py-4 flex items-center gap-3 border border-amber-500/30" style={{ background: 'rgba(245,158,11,.08)' }}>
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center flex-shrink-0"><Icon name="handshake" className="w-5 h-5 text-amber-300" /></div>
          <div>
            <p className="text-white font-semibold text-sm">{isOwner ? t('property.yourPropertyUnderOffer') : t('property.thisPropertyUnderOffer')}</p>
            <p className="text-slate-400 text-xs mt-0.5">{isOwner ? t('property.ownerReservedSub') : t('property.buyerReservedSub')}</p>
          </div>
        </div>
      ) : null}
      {renderFinalize()}
      {renderOffers()}

      {offerOpen ? createPortal(
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={() => setOfferOpen(false)}>
          <div className="glass-strong rounded-2xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-1">{state.myOffer ? t('property.updateYourOffer') : t('property.makeOffer')}</h3>
            <p className="text-slate-400 text-xs mb-3">{t('property.offerModalSub')}</p>
            <input value={offerAmt} onChange={(e) => { setOfferAmt(e.target.value); if (offerErr) setOfferErr(false); }} inputMode="numeric" data-err="offerAmt" className={'w-full rounded-lg bg-white/5 border px-3 py-2.5 text-sm text-white outline-none focus:border-teal-400/50 ' + (offerErr ? 'dz-invalid mb-1' : 'border-white/10 mb-3')} placeholder={t('property.offerPlaceholder')} />
            <FieldError show={offerErr} className="mb-3">{t('property.enterOfferAmount')}</FieldError>
            <p className="text-[11px] text-slate-400 mb-1.5">{isRent ? t('property.preferredMoveInDate') : t('property.targetPossessionDate')}</p>
            <DateField value={offerMoveIn} onChange={(v) => setOfferMoveIn(v)} className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white mb-4" ariaLabel={isRent ? t('property.preferredMoveInDate') : t('property.targetPossessionDateAria')} />
            <div className="flex gap-2">
              <button onClick={submitOffer} className="btn-teal flex-1 py-2.5 rounded-lg text-sm font-semibold">{t('property.sendOffer')}</button>
              <button onClick={() => setOfferOpen(false)} className="flex-1 py-2.5 rounded-lg text-sm border border-white/15 text-slate-200">{t('property.cancel')}</button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
