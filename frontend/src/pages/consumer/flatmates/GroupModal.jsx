import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import NativeSelect from '../../../components/ui/NativeSelect.jsx';
import LocalitySelect from '../../../components/ui/LocalitySelect.jsx';
import AutosaveBanner from '../../../components/AutosaveBanner.jsx';
import FieldError from '../../../components/ui/FieldError.jsx';
import AgreementUpload from './AgreementUpload.jsx';
import FlatmateTerms from './FlatmateTerms.jsx';
import GroupPreferencesFields from './GroupPreferencesFields.jsx';
import AmountInput from './AmountInput.jsx';
import { LOCALITIES } from './constants.js';
import { inr, MAX_GROUP_SEATS } from './helpers.js';
import isTopDialog from '../../../lib/isTopDialog.js';
import useScrollLock from '../../../hooks/useScrollLock.js';

export default function GroupModal({ setGroupOpen, submitGroup, grpFormRef, grpDraft, grp, setGrp, grpErr, myListings, myListingsStatus, retryMyListings, myTenancies, myTenanciesStatus, retryMyTenancies, onAttachProperty, onAttachTenancy, onRequestConsent, editing = false }) {
  const { t: tr } = useTranslation();
  const title = tr(editing ? 'flatmates.groupEditTitle' : 'flatmates.groupModalTitle');
  const panelRef = useRef(null);
  useScrollLock();
  useEffect(() => {
    const onKey = (e) => {
      if (!isTopDialog(panelRef.current)) return;
      if (e.key === 'Escape') setGroupOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setGroupOpen]);
  const policyField = <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.openTo')}</label><NativeSelect value={grp.policy} onChange={(e) => setGrp({ ...grp, policy: e.target.value })} className="field w-full rounded-full px-4 py-2 text-sm"><option value="women">{tr('flatmates.optWomenOnly')}</option><option value="men">{tr('flatmates.optMenOnly')}</option><option value="any">{tr('flatmates.optAnyone')}</option></NativeSelect></div>;
  const seatsField = <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.peopleSharing')} <span className="text-rose-400">*</span></label><input type="number" min="1" max={MAX_GROUP_SEATS} value={grp.seats} onChange={(e) => setGrp({ ...grp, seats: e.target.value })} className="field w-full rounded-xl px-3.5 py-2.5 text-sm" /></div>;
  const mode = (hunting, icon, label) => (
    <button type="button" onClick={() => setGrp((g) => ({ ...g, hunting }))} aria-pressed={grp.hunting === hunting} className={'seg text-xs font-semibold px-3 py-2.5 rounded-xl text-gray-300 flex items-center justify-center gap-1.5' + (grp.hunting === hunting ? ' active' : '')}><Icon name={icon} className="w-3.5 h-3.5" /> {label}</button>
  );
  return (
    <div className="sf-modal" onClick={() => setGroupOpen(false)}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} className="dz-modal-panel border border-white/10 rounded-3xl w-full max-w-xl p-6 sm:p-7" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-5">
          <div><h2 className="text-xl font-bold text-white">{title}</h2>{!editing && <p className="text-gray-400 text-xs mt-1">{tr('flatmates.groupModalSubtitle')}</p>}</div>
          <button onClick={() => setGroupOpen(false)} className="p-2 rounded-xl hover:bg-white/5 text-gray-400 hover:text-white"><Icon name="x" className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submitGroup} className="space-y-4" ref={grpFormRef}>
          <AutosaveBanner restored={grpDraft.restored} onStartFresh={grpDraft.startFresh} />
          <div data-err="title"><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.groupTitleLabel')} <span className="text-rose-400">*</span></label><input value={grp.title} onChange={(e) => { setGrp({ ...grp, title: e.target.value, consentVerified: false }); grpErr.clear('title'); }} className={'field w-full rounded-xl px-3.5 py-2.5 text-sm' + grpErr.cx('title')} placeholder={tr('flatmates.groupTitlePlaceholder')} /><FieldError show={grpErr.has('title')}>{grpErr.msg('title')}</FieldError></div>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label={tr('flatmates.groupStage')}>
            {mode(true, 'search', tr('flatmates.stillLooking'))}
            {mode(false, 'home', tr('flatmates.haveFlat'))}
          </div>
          {grp.hunting ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{policyField}{seatsField}</div>
              <GroupPreferencesFields grp={grp} setGrp={setGrp} grpErr={grpErr} />
            </>
          ) : (<>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.fLocality')} <span className="text-rose-400">*</span></label><LocalitySelect value={grp.locality} onChange={(v) => setGrp({ ...grp, locality: v, consentVerified: false })} options={LOCALITIES} placeholder={tr('flatmates.selectLocality')} ariaLabel={tr('flatmates.fLocality')} className="w-full" /></div>
            {policyField}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div data-err="rent"><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.totalMonthlyRent')} <span className="text-rose-400">*</span></label><AmountInput value={grp.rent} onChange={(v) => { setGrp({ ...grp, rent: v }); grpErr.clear('rent'); }} className={grpErr.cx('rent')} placeholder={tr('flatmates.rentPlaceholder')} /><FieldError show={grpErr.has('rent')}>{grpErr.msg('rent')}</FieldError></div>
            {seatsField}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.groupDeposit')} <span className="text-gray-600">{tr('flatmates.optional')}</span></label><AmountInput value={grp.deposit} onChange={(v) => setGrp({ ...grp, deposit: v })} placeholder={tr('flatmates.depositPlaceholder')} /></div>
          </div>

          {/* Rendered as caption text (not an input tile) so it can't be mistaken for a field the host must fill. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 -mt-1">
            <Icon name="calculator" className="w-3.5 h-3.5 text-teal-400" />
            <span className="text-xs text-gray-400">{tr('flatmates.eachFlatmatePays')}</span>
            <span className="text-sm font-bold gradient-text">{grp.rent && grp.seats ? inr(Math.round(+grp.rent / +grp.seats)) + tr('flatmates.perMonth') : '—'}</span>
          </div>
          <FlatmateTerms value={grp} onChange={(patch) => setGrp((g) => ({ ...g, ...patch }))} />
          </>)}
          <div data-err="name"><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.nameLabel')} <span className="text-rose-400">*</span></label><input value={grp.name} onChange={(e) => { setGrp({ ...grp, name: e.target.value }); grpErr.clear('name'); }} className={'field w-full rounded-xl px-3.5 py-2.5 text-sm' + grpErr.cx('name')} placeholder={tr('flatmates.yourNamePlaceholder')} /><FieldError show={grpErr.has('name')}>{grpErr.msg('name')}</FieldError></div>
          <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.shortNote')} <span className="text-gray-600">{tr('flatmates.optional')}</span></label><textarea value={grp.note} onChange={(e) => setGrp({ ...grp, note: e.target.value })} rows={2} className="field w-full rounded-xl px-3.5 py-2.5 text-sm resize-none" placeholder={tr('flatmates.groupNotePlaceholder')} /></div>

          {!grp.hunting && <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-2 inline-flex items-center gap-1.5"><Icon name="shield-check" className="w-3.5 h-3.5 text-teal-400" /> {tr('flatmates.yourRole')}</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setGrp({ ...grp, role: 'tenant' })} className={'seg text-xs font-semibold px-3 py-2.5 rounded-xl text-gray-300 flex items-center justify-center gap-1.5' + (grp.role === 'tenant' ? ' active' : '')}><Icon name="key-round" className="w-3.5 h-3.5" /> {tr('flatmates.currentTenant')}</button>
                <button type="button" onClick={() => setGrp({ ...grp, role: 'owner' })} className={'seg text-xs font-semibold px-3 py-2.5 rounded-xl text-gray-300 flex items-center justify-center gap-1.5' + (grp.role === 'owner' ? ' active' : '')}><Icon name="badge-check" className="w-3.5 h-3.5" /> {tr('flatmates.flatOwner')}</button>
              </div>
            </div>
            {grp.role === 'owner' ? (
              /* "You have not listed a property" is a claim about this owner's account, and it
               * may only be made once the read has actually come back empty. */
              myListingsStatus === 'loading' ? (
                <p className="text-[11px] text-gray-500 leading-relaxed" aria-busy="true">{tr('common.loading')}</p>
              ) : myListingsStatus === 'error' ? (
                <p className="text-[11px] text-gray-400 leading-relaxed" data-testid="group-listings-unavailable">
                  {tr('common.somethingWentWrong')}{' '}
                  <button type="button" onClick={retryMyListings} className="text-teal-300 font-semibold underline">{tr('common.retry')}</button>
                </p>
              ) : (myListings && myListings.length) ? (
                <div>
                  <label className="block text-[11px] font-medium text-gray-400 mb-1.5">{tr('flatmates.attachVerifiedProperty')}</label>
                  <NativeSelect title={tr('flatmates.attachVerifiedProperty')} value={grp.propertyId} onChange={(e) => { const l = myListings.find((x) => x.id === e.target.value); if (l) onAttachProperty(l); else setGrp((g) => ({ ...g, propertyId: '' })); }} className="field w-full rounded-full px-4 py-2 text-sm">
                    <option value="">{tr('flatmates.selectVerifiedListing')}</option>
                    {myListings.map((l) => <option key={l.id} value={l.id}>{l.title || l.society || l.locality || tr('flatmates.listingFallback', { id: l.id })}</option>)}
                  </NativeSelect>
                  <p className="text-[11px] text-gray-500 mt-1.5">{tr('flatmates.ownerAttachHelpPre')} <span className="text-emerald-300 font-semibold">{tr('flatmates.ownerVerifiedBadge')}</span> {tr('flatmates.ownerAttachHelpSuf')}</p>
                </div>
              ) : (
                <p className="text-[11px] text-gray-400 leading-relaxed">{tr('flatmates.noPropertyPre')} <a href="/list-property?flatmate=1" className="text-teal-300 font-semibold underline">{tr('flatmates.listYourProperty')}</a></p>
              )
            ) : (
              <>

                {myTenanciesStatus === 'error' ? (
                  <p className="text-[11px] text-gray-400" data-testid="group-tenancies-unavailable">
                    {tr('common.somethingWentWrong')}{' '}
                    <button type="button" onClick={retryMyTenancies} className="text-teal-300 font-semibold underline">{tr('common.retry')}</button>
                  </p>
                ) : null}
                {myTenanciesStatus === 'ready' && myTenancies && myTenancies.length > 0 && (
                  <div className="rounded-lg border border-teal-500/20 bg-teal-500/5 p-3">
                    <label className="block text-[11px] font-medium text-teal-200 mb-1.5 inline-flex items-center gap-1.5"><Icon name="key-round" className="w-3.5 h-3.5 text-teal-300" /> {tr('flatmates.rentingThroughDraazy')}</label>

                    <NativeSelect title={tr('flatmates.prefillFromTenancy')} value="" onChange={(e) => { const t = myTenancies.find((x) => (x.id || x.propId) === e.target.value); if (t) onAttachTenancy(t); }} className="field w-full rounded-full px-4 py-2 text-sm">
                      <option value="">{tr('flatmates.prefillFromTenancy')}</option>
                      {myTenancies.map((t) => <option key={t.id || t.propId} value={t.id || t.propId}>{t.title || t.address || tr('flatmates.myTenancyFallback')}</option>)}
                    </NativeSelect>
                  </div>
                )}
                <label className="flex items-start gap-2.5 text-xs text-gray-300 cursor-pointer select-none">
                  <input type="checkbox" checked={grp.agreement} onChange={(e) => setGrp((g) => ({ ...g, agreement: e.target.checked, agreementDoc: e.target.checked ? g.agreementDoc : null }))} className="w-4 h-4 accent-teal-500 mt-0.5" />
                  <span>{tr('flatmates.agreementPre')} <span className="text-teal-300 font-semibold">{tr('flatmates.registeredRentAgreement')}</span> {tr('flatmates.agreementSuf')}</span>
                </label>
                {grp.agreement && (
                  <AgreementUpload
                    doc={grp.agreementDoc}
                    onChange={(doc) => setGrp((g) => ({ ...g, agreementDoc: doc }))}
                    ariaLabel={tr('flatmates.agreementUploadAria')}
                  />
                )}
                {editing && grp.agreement && !grp.agreementDoc && <p className="text-[11px] text-amber-300">{tr('flatmates.reattachAgreement')}</p>}
                <div>
                  <label className="block text-[11px] font-medium text-gray-400 mb-1.5">{tr('flatmates.ownerMobileConsent')} <span className="text-gray-600">{tr('flatmates.optional')}</span></label>
                  <input value={grp.consentMobile} onChange={(e) => setGrp({ ...grp, consentMobile: e.target.value.replace(/[^\d]/g, '').slice(0, 10), consentVerified: false })} inputMode="numeric" className="field w-full rounded-xl px-3.5 py-2.5 text-sm" placeholder={tr('flatmates.consentPlaceholder')} />
                  {grp.consentVerified ? (
                    <p className="text-[11px] text-emerald-300 mt-1.5 inline-flex items-center gap-1.5"><Icon name="badge-check" className="w-3.5 h-3.5" /> {tr('flatmates.ownerConsentConfirmed')}</p>
                  ) : (
                    <button type="button" onClick={() => onRequestConsent && onRequestConsent()} disabled={grp.consentMobile.length !== 10} className="mt-2 seg text-[11px] font-semibold px-3 py-2 rounded-xl text-gray-200 inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"><Icon name="shield-check" className="w-3.5 h-3.5 text-teal-300" /> {tr('flatmates.verifyOwnerConsent')}</button>
                  )}
                </div>
              </>
            )}
          </div>}
          <div className="flex items-center justify-end gap-3 pt-1">
            <button type="button" onClick={() => setGroupOpen(false)} className="btn-ghost text-sm font-medium text-gray-300 px-5 py-2.5 rounded-xl">{tr('flatmates.cancel')}</button>
            <button type="submit" className="btn-teal text-sm font-semibold text-white px-6 py-2.5 rounded-xl inline-flex items-center gap-2"><Icon name={editing ? 'check' : 'users-round'} className="w-4 h-4" /> {tr(editing ? 'flatmates.saveChanges' : 'flatmates.createGroupSubmit')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
