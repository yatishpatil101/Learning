import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import DateField from '../../../components/ui/DateField.jsx';
import FieldError from '../../../components/ui/FieldError.jsx';
import { digits } from '../../../lib/contact.js';
import {
  myMobile,
  isDealClosed, isDealReserved, closeDeal, reopenDeal, markUnderOffer, getUnderOfferParties,
  requestFinalize, myFinalizeStatus, cancelFinalize, pendingFinalizeFor, acceptFinalize, declineFinalize,
  addOffer, myOffer, offersFor, respondOffer, isTenantVerifiedFor,
} from '../../../lib/store.js';

const fmtOffer = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN');

export function DealPanel({ p, isIn, toast, contactApproved = false }) {
  const { t } = useTranslation();
  const owner = String(p.ownerMobile || '');
  const propId = String(p.id || '');
  const isRent = p.deal === 'rent';
  const dealKind = isRent ? 'rent' : 'sell';
  const [, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerAmt, setOfferAmt] = useState('');
  const [offerErr, setOfferErr] = useState(false);
  const [offerMoveIn, setOfferMoveIn] = useState('');

  const isOwner = isIn && digits(myMobile()) === digits(owner);
  const closed = isDealClosed(owner, propId);
  const reserved = isDealReserved(owner, propId);
  const statusTag = isRent ? 'Rented Out' : 'Sold';
  const dealWord = isRent ? t('property.rentedOutWord') : t('property.soldWord');

  const doFinalize = () => {
    if (!isIn) { toast(t('property.signInFinalize'), 'info'); return; }
    if (isOwner) {
      if (!closed) closeDeal(owner, propId, dealKind);
      refresh();
      toast(t('property.dealFinalizedClosed'), 'success');
    } else {
      requestFinalize(owner, propId, dealKind);
      refresh();
      toast(t('property.finalizeRequestSent'), 'success');
    }
  };
  const cancelReq = () => { cancelFinalize(owner, propId); refresh(); toast(t('property.finalizeWithdrawn'), 'info'); };
  const accept = (id) => {
    acceptFinalize(owner, id, { deal: dealKind, title: p.title || '', address: p.locality || '', rent: isRent ? p.price : 0 });
    refresh();
    toast(t('property.dealFinalizedClosed'), 'success');
  };
  const decline = (id) => { declineFinalize(owner, id); refresh(); toast(t('property.requestDeclinedActive'), 'info'); };
  const reopen = () => { reopenDeal(owner, propId); refresh(); toast(t('property.listingReopened'), 'success'); };
  const markUO = () => {
    if (!isIn) { toast(t('property.signInUpdateDeal'), 'info'); return; }
    markUnderOffer(owner, propId, dealKind);
    refresh();
    toast(t('property.markedUnderOffer'), 'success');
  };

  const submitOffer = () => {
    const amt = parseInt(String(offerAmt).replace(/[^\d]/g, ''), 10) || 0;
    if (!amt) { setOfferErr(true); toast(t('property.enterAmount'), 'info'); return; }
    setOfferErr(false);
    const existing = myOffer(owner, propId);
    if (existing) respondOffer(owner, existing.id, 'buyer_counter', amt);
    else addOffer(owner, { propId, amount: amt, moveIn: offerMoveIn, deal: isRent ? 'rent' : 'buy' });
    setOfferOpen(false); setOfferAmt(''); setOfferMoveIn('');
    refresh();
    toast(t('property.offerSent'), 'success');
  };
  const ownerOfferAct = (id, action) => {
    if (action === 'counter') {
      const v = window.prompt(t('property.counterPrompt'));
      const a = parseInt(String(v || '').replace(/[^\d]/g, ''), 10);
      if (!a) return;
      respondOffer(owner, id, 'counter', a);
    } else respondOffer(owner, id, action);
    refresh();
    toast(action === 'accept' ? t('property.offerAccepted') : action === 'decline' ? t('property.offerDeclined') : t('property.counterSent'), 'success');
  };
  const buyerAcceptCounter = (id) => { respondOffer(owner, id, 'accept'); refresh(); toast(t('property.dealAgreed'), 'success'); };
  const openOffer = () => {
    if (!isIn) { toast(t('property.signInOffer'), 'info'); return; }
    const my = myOffer(owner, propId);
    setOfferAmt(my ? String(my.amount || '') : '');
    setOfferOpen(true);
  };

  const cardCls = 'glass-strong rounded-2xl p-5';

  const renderFinalize = () => {
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
        const parties = getUnderOfferParties(owner, propId);
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
      const stR = isIn ? myFinalizeStatus(owner, propId) : 'none';
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
      const pend = pendingFinalizeFor(owner, propId);
      if (pend.length) {
        return (
          <div className={cardCls + ' border border-emerald-500/20'} style={{ background: 'rgba(16,185,129,.06)' }}>
            <div className="flex items-center gap-2 mb-1.5"><Icon name="user-check" className="w-5 h-5 text-amber-400" /><h3 className="text-white font-bold text-sm">{t('property.finalizeRequests', { count: pend.length })}</h3></div>
            <p className="text-slate-400 text-xs mb-3">{isRent ? t('property.finalizeAskedTenant', { count: pend.length }) : t('property.finalizeAskedBuyer', { count: pend.length })}</p>
            {pend.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 mb-2 rounded-lg bg-white/5 px-3 py-2">
                <span className="text-slate-200 text-xs flex items-center gap-1.5 min-w-0 truncate"><Icon name="user" className="w-3.5 h-3.5 text-brand-teal-3 flex-shrink-0" /> {r.buyerName}{isTenantVerifiedFor(r.buyerMobile) ? <span className="text-emerald-300" style={{ fontWeight: 600 }}> · ✓ {t('property.verifiedTenant')}</span> : null}</span>
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
    const st = isIn ? myFinalizeStatus(owner, propId) : 'none';
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
    // Finalising is an end-of-deal step. Don't lead a cold buyer with it — only surface
    // once they've engaged (contact approved) or already tried (a declined request).
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
    if (isOwner) {
      const offers = offersFor(owner, propId).filter((o) => o.status !== 'declined');
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
                  <p className="text-slate-500 text-[11px] mt-0.5">{o.buyerName || t('property.buyerFallback')}{isTenantVerifiedFor(o.buyerMobile) ? <span style={{ color: '#6ee7b7', fontWeight: 600 }}> · ✓ {t('property.verifiedTenant')}</span> : null}{o.moveIn ? t('property.moveInPrefix', { date: o.moveIn }) : ''}</p>
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
    const my = myOffer(owner, propId);
    if (my) {
      return (
        <div className={cardCls}>
          <div className="flex items-center gap-2 mb-1"><Icon name="gavel" className="w-5 h-5 text-amber-400" /><h3 className="text-white font-bold text-sm">{t('property.yourOffer')}</h3></div>
          <p className="text-slate-400 text-xs mb-3">
            {my.status === 'accepted' ? <span className="text-emerald-300 font-semibold">{t('property.acceptedByOwner')}</span>
              : my.status === 'countered' ? <>{t('property.ownerCounteredAt')}<b className="text-amber-300">{fmtOffer(my.amount)}</b></>
              : my.status === 'declined' ? <span className="text-rose-300">{t('property.declinedTryNew')}</span>
              : <>{t('property.yourOfferPendingPre')}<b className="text-white">{fmtOffer(my.amount)}</b>{t('property.yourOfferPendingPost')}</>}
          </p>
          {my.status === 'countered' ? (
            <div className="flex gap-2">
              <button onClick={() => buyerAcceptCounter(my.id)} className="btn-teal flex-1 py-2 rounded-lg text-xs font-semibold">{t('property.accept')} {fmtOffer(my.amount)}</button>
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
            <h3 className="text-lg font-bold text-white mb-1">{myOffer(owner, propId) ? t('property.updateYourOffer') : t('property.makeOffer')}</h3>
            <p className="text-slate-400 text-xs mb-3">{t('property.offerModalSub')}</p>
            <input value={offerAmt} onChange={(e) => { setOfferAmt(e.target.value); if (offerErr) setOfferErr(false); }} inputMode="numeric" data-err="offerAmt" className={'w-full rounded-lg bg-white/5 border px-3 py-2.5 text-sm text-white outline-none focus:border-teal-400/50 ' + (offerErr ? 'pn-invalid mb-1' : 'border-white/10 mb-3')} placeholder={t('property.offerPlaceholder')} />
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
