import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import NativeSelect from '../../../components/ui/NativeSelect.jsx';
import LocalitySelect from '../../../components/ui/LocalitySelect.jsx';
import AutosaveBanner from '../../../components/AutosaveBanner.jsx';
import FieldError from '../../../components/ui/FieldError.jsx';
import AgreementUpload from './AgreementUpload.jsx';
import { LOCALITIES } from './constants.js';
import { inr } from './helpers.js';

export default function GroupModal({ setGroupOpen, submitGroup, grpFormRef, grpDraft, grp, setGrp, grpErr, myListings, myListingsStatus, retryMyListings, myTenancies, myTenanciesStatus, retryMyTenancies, onAttachProperty, onAttachTenancy, onRequestConsent }) {
  const { t: tr } = useTranslation();
  return (
    <div className="sf-modal" onClick={() => setGroupOpen(false)}>
      <div className="glass rounded-3xl w-full max-w-xl p-6 sm:p-7" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-5">
          <div><h2 className="text-xl font-bold text-white">{tr('flatmates.groupModalTitle')}</h2><p className="text-gray-400 text-xs mt-1">{tr('flatmates.groupModalSubtitle')}</p></div>
          <button onClick={() => setGroupOpen(false)} className="p-2 rounded-xl hover:bg-white/5 text-gray-400 hover:text-white"><Icon name="x" className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submitGroup} className="space-y-4" ref={grpFormRef}>
          <AutosaveBanner restored={grpDraft.restored} onStartFresh={grpDraft.startFresh} />
          <div data-err="title"><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.groupTitleLabel')} <span className="text-rose-400">*</span></label><input value={grp.title} onChange={(e) => { setGrp({ ...grp, title: e.target.value }); grpErr.clear('title'); }} className={'field w-full rounded-xl px-3.5 py-2.5 text-sm' + grpErr.cx('title')} placeholder={tr('flatmates.groupTitlePlaceholder')} /><FieldError show={grpErr.has('title')}>{grpErr.msg('title')}</FieldError></div>
          {/* Where + who this share is open to */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.fLocality')} <span className="text-rose-400">*</span></label><LocalitySelect value={grp.locality} onChange={(v) => setGrp({ ...grp, locality: v })} options={LOCALITIES} placeholder={tr('flatmates.selectLocality')} ariaLabel={tr('flatmates.fLocality')} className="w-full" /></div>
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.openTo')}</label><NativeSelect value={grp.policy} onChange={(e) => setGrp({ ...grp, policy: e.target.value })} className="field w-full rounded-full px-4 py-2 text-sm"><option value="women">{tr('flatmates.optWomenOnly')}</option><option value="men">{tr('flatmates.optMenOnly')}</option><option value="any">{tr('flatmates.optAnyone')}</option></NativeSelect></div>
          </div>
          {/* The money split: rent + people directly drive the per-person share shown below */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div data-err="rent"><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.totalMonthlyRent')} <span className="text-rose-400">*</span></label><input type="number" min="1" value={grp.rent} onChange={(e) => { setGrp({ ...grp, rent: e.target.value }); grpErr.clear('rent'); }} className={'field w-full rounded-xl px-3.5 py-2.5 text-sm' + grpErr.cx('rent')} placeholder={tr('flatmates.rentPlaceholder')} /><FieldError show={grpErr.has('rent')}>{grpErr.msg('rent')}</FieldError></div>
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.peopleSharing')} <span className="text-rose-400">*</span></label><input type="number" min="2" max="6" value={grp.seats} onChange={(e) => setGrp((g) => { const s = parseInt(e.target.value, 10); if (!s) return { ...g, seats: e.target.value }; const maxOpen = Math.max(1, s - 1); return { ...g, seats: e.target.value, seatsOpen: String(Math.min(parseInt(g.seatsOpen, 10) || 1, maxOpen)) }; })} className="field w-full rounded-xl px-3.5 py-2.5 text-sm" /></div>
          </div>
          {/* Per-person share — a derived, read-only summary. Rendered as caption text
              (not an input tile) so it can't be mistaken for a field the host must fill. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 -mt-1">
            <Icon name="calculator" className="w-3.5 h-3.5 text-teal-400" />
            <span className="text-xs text-gray-400">{tr('flatmates.eachFlatmatePays')}</span>
            <span className="text-sm font-bold gradient-text">{grp.rent && grp.seats ? inr(Math.round(+grp.rent / +grp.seats)) + tr('flatmates.perMonth') : '—'}</span>
            <span className="text-[11px] text-gray-600">{tr('flatmates.autoSplit')}</span>
          </div>
          {/* Current vacancy — smart-capped to (people − 1) since you already hold one seat */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.seatsOpenNow')} <span className="text-rose-400">*</span></label><input type="number" min="1" max={Math.max(1, (parseInt(grp.seats, 10) || 2) - 1)} value={grp.seatsOpen} onChange={(e) => setGrp((g) => { const raw = e.target.value; if (raw === '') return { ...g, seatsOpen: '' }; const maxOpen = Math.max(1, (parseInt(g.seats, 10) || 2) - 1); return { ...g, seatsOpen: String(Math.max(1, Math.min(maxOpen, parseInt(raw, 10) || 1))) }; })} className="field w-full rounded-xl px-3.5 py-2.5 text-sm" /><p className="text-[11px] text-gray-500 mt-1">{tr('flatmates.seatsOpenHelp')}</p></div>
          </div>
          <div data-err="name"><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.nameLabel')} <span className="text-rose-400">*</span></label><input value={grp.name} onChange={(e) => { setGrp({ ...grp, name: e.target.value }); grpErr.clear('name'); }} className={'field w-full rounded-xl px-3.5 py-2.5 text-sm' + grpErr.cx('name')} placeholder={tr('flatmates.yourNamePlaceholder')} /><FieldError show={grpErr.has('name')}>{grpErr.msg('name')}</FieldError></div>
          <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.shortNote')} <span className="text-gray-600">{tr('flatmates.optional')}</span></label><textarea value={grp.note} onChange={(e) => setGrp({ ...grp, note: e.target.value })} rows={2} className="field w-full rounded-xl px-3.5 py-2.5 text-sm resize-none" placeholder={tr('flatmates.groupNotePlaceholder')} /></div>

          {/* Host eligibility — who the poster is to this flat drives the trust badge
              seekers see. A sitting tenant seeking a replacement can't produce
              ownership docs, so they attest a registered rent agreement instead;
              an owner attaches a property Ops already verified. */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-2 inline-flex items-center gap-1.5"><Icon name="shield-check" className="w-3.5 h-3.5 text-teal-400" /> {tr('flatmates.yourRole')}</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setGrp({ ...grp, role: 'tenant' })} className={'seg text-xs font-semibold px-3 py-2.5 rounded-xl text-gray-300 flex items-center justify-center gap-1.5' + (grp.role === 'tenant' ? ' active' : '')}><Icon name="key-round" className="w-3.5 h-3.5" /> {tr('flatmates.currentTenant')}</button>
                <button type="button" onClick={() => setGrp({ ...grp, role: 'owner' })} className={'seg text-xs font-semibold px-3 py-2.5 rounded-xl text-gray-300 flex items-center justify-center gap-1.5' + (grp.role === 'owner' ? ' active' : '')}><Icon name="badge-check" className="w-3.5 h-3.5" /> {tr('flatmates.flatOwner')}</button>
              </div>
            </div>
            {grp.role === 'owner' ? (
              /* Three outcomes, not two. "You have not listed a property" is a claim about this
                 owner's account, and it may only be made once the read has actually come back
                 empty. While it is in flight, or when it failed, the honest answer is that we do
                 not know yet — an owner who does hold an approved listing must not be told they
                 hold none and sent to the listing wizard to create a duplicate. */
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
                <p className="text-[11px] text-gray-400 leading-relaxed">{tr('flatmates.noPropertyPre')} <a href="/list-property?flatmate=1" className="text-teal-300 font-semibold underline">{tr('flatmates.listYourProperty')}</a> {tr('flatmates.noPropertyMid')} <span className="text-emerald-300 font-semibold">{tr('flatmates.ownerVerifiedBadge')}</span> {tr('flatmates.noPropertySuf')}</p>
              )
            ) : (
              <>
                {/* A failed tenancy read silently removes the one-tap prefill, which looks
                    identical to "you have no tenancy with us". Say so instead, and offer the
                    retry — the tenant can still fill the form by hand either way, so this is a
                    missing convenience rather than a blocked path, and it is worth exactly one
                    line rather than an alarm. */}
                {myTenanciesStatus === 'error' ? (
                  <p className="text-[11px] text-gray-400" data-testid="group-tenancies-unavailable">
                    {tr('common.somethingWentWrong')}{' '}
                    <button type="button" onClick={retryMyTenancies} className="text-teal-300 font-semibold underline">{tr('common.retry')}</button>
                  </p>
                ) : null}
                {myTenanciesStatus === 'ready' && myTenancies && myTenancies.length > 0 && (
                  <div className="rounded-lg border border-teal-500/20 bg-teal-500/5 p-3">
                    <label className="block text-[11px] font-medium text-teal-200 mb-1.5 inline-flex items-center gap-1.5"><Icon name="key-round" className="w-3.5 h-3.5 text-teal-300" /> {tr('flatmates.rentingThroughDraazy')}</label>
                    {/* Action-trigger select: value="" keeps it on the prompt so it
                        prefills the form on each pick rather than holding a selection. */}
                    <NativeSelect title={tr('flatmates.prefillFromTenancy')} value="" onChange={(e) => { const t = myTenancies.find((x) => (x.id || x.propId) === e.target.value); if (t) onAttachTenancy(t); }} className="field w-full rounded-full px-4 py-2 text-sm">
                      <option value="">{tr('flatmates.prefillFromTenancy')}</option>
                      {myTenancies.map((t) => <option key={t.id || t.propId} value={t.id || t.propId}>{t.title || t.address || tr('flatmates.myTenancyFallback')}</option>)}
                    </NativeSelect>
                    <p className="text-[11px] text-gray-400 mt-1.5">{tr('flatmates.tenancyPrefillHelp')}</p>
                  </div>
                )}
                <label className="flex items-start gap-2.5 text-xs text-gray-300 cursor-pointer select-none">
                  <input type="checkbox" checked={grp.agreement} onChange={(e) => setGrp((g) => ({ ...g, agreement: e.target.checked, agreementDoc: e.target.checked ? g.agreementDoc : null }))} className="w-4 h-4 accent-teal-500 mt-0.5" />
                  <span>{tr('flatmates.agreementPre')} <span className="text-teal-300 font-semibold">{tr('flatmates.registeredRentAgreement')}</span> {tr('flatmates.agreementMid')} <span className="text-teal-300 font-semibold">{tr('flatmates.tenantVerifiedBadge')}</span> {tr('flatmates.agreementSuf')}</span>
                </label>
                {grp.agreement && (
                  <AgreementUpload
                    doc={grp.agreementDoc}
                    onChange={(doc) => setGrp((g) => ({ ...g, agreementDoc: doc }))}
                    ariaLabel={tr('flatmates.agreementUploadAria')}
                    hint={tr('flatmates.agreementUploadHint')}
                  />
                )}
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
          </div>
          <div className="flex items-center justify-end gap-3 pt-1">
            <button type="button" onClick={() => setGroupOpen(false)} className="btn-ghost text-sm font-medium text-gray-300 px-5 py-2.5 rounded-xl">{tr('flatmates.cancel')}</button>
            <button type="submit" className="btn-teal text-sm font-semibold text-white px-6 py-2.5 rounded-xl inline-flex items-center gap-2"><Icon name="users-round" className="w-4 h-4" /> {tr('flatmates.createGroupSubmit')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
