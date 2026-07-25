import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import NativeSelect from '../../../components/ui/NativeSelect.jsx';
import LocalitySelect from '../../../components/ui/LocalitySelect.jsx';
import AutosaveBanner from '../../../components/AutosaveBanner.jsx';
import FieldError from '../../../components/ui/FieldError.jsx';
import AgreementUpload from './AgreementUpload.jsx';
import { LOCALITIES } from './constants.js';
import { inr } from './helpers.js';

export default function GroupModal({ setGroupOpen, submitGroup, grpFormRef, grpDraft, grp, setGrp, grpErr, myListings, myTenancies, onAttachProperty, onAttachTenancy, onRequestConsent }) {
  const { t: tr } = useTranslation();
  return (
    <div className="sf-modal" onClick={() => setGroupOpen(false)}>
      <div className="glass rounded-3xl w-full max-w-xl p-6 sm:p-7" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-5">
          <div><h2 className="text-xl font-bold text-white">{tr('shareFlat.groupModalTitle')}</h2><p className="text-gray-400 text-xs mt-1">{tr('shareFlat.groupModalSubtitle')}</p></div>
          <button onClick={() => setGroupOpen(false)} className="p-2 rounded-xl hover:bg-white/5 text-gray-400 hover:text-white"><Icon name="x" className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submitGroup} className="space-y-4" ref={grpFormRef}>
          <AutosaveBanner restored={grpDraft.restored} onStartFresh={grpDraft.startFresh} />
          <div data-err="title"><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('shareFlat.groupTitleLabel')} <span className="text-rose-400">*</span></label><input value={grp.title} onChange={(e) => { setGrp({ ...grp, title: e.target.value }); grpErr.clear('title'); }} className={'field w-full rounded-xl px-3.5 py-2.5 text-sm' + grpErr.cx('title')} placeholder={tr('shareFlat.groupTitlePlaceholder')} /><FieldError show={grpErr.has('title')}>{grpErr.msg('title')}</FieldError></div>
          {/* Where + who this share is open to */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('shareFlat.fLocality')} <span className="text-rose-400">*</span></label><LocalitySelect value={grp.locality} onChange={(v) => setGrp({ ...grp, locality: v })} options={LOCALITIES} placeholder={tr('shareFlat.selectLocality')} ariaLabel={tr('shareFlat.fLocality')} className="w-full" /></div>
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('shareFlat.openTo')}</label><NativeSelect value={grp.policy} onChange={(e) => setGrp({ ...grp, policy: e.target.value })} className="field w-full rounded-full px-4 py-2 text-sm"><option value="women">{tr('shareFlat.optWomenOnly')}</option><option value="men">{tr('shareFlat.optMenOnly')}</option><option value="any">{tr('shareFlat.optAnyone')}</option></NativeSelect></div>
          </div>
          {/* The money split: rent + people directly drive the per-person share shown below */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div data-err="rent"><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('shareFlat.totalMonthlyRent')} <span className="text-rose-400">*</span></label><input type="number" min="1" value={grp.rent} onChange={(e) => { setGrp({ ...grp, rent: e.target.value }); grpErr.clear('rent'); }} className={'field w-full rounded-xl px-3.5 py-2.5 text-sm' + grpErr.cx('rent')} placeholder={tr('shareFlat.rentPlaceholder')} /><FieldError show={grpErr.has('rent')}>{grpErr.msg('rent')}</FieldError></div>
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('shareFlat.peopleSharing')} <span className="text-rose-400">*</span></label><input type="number" min="2" max="6" value={grp.seats} onChange={(e) => setGrp((g) => { const s = parseInt(e.target.value, 10); if (!s) return { ...g, seats: e.target.value }; const maxOpen = Math.max(1, s - 1); return { ...g, seats: e.target.value, seatsOpen: String(Math.min(parseInt(g.seatsOpen, 10) || 1, maxOpen)) }; })} className="field w-full rounded-xl px-3.5 py-2.5 text-sm" /></div>
          </div>
          {/* Per-person share — a derived, read-only summary. Rendered as caption text
              (not an input tile) so it can't be mistaken for a field the host must fill. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 -mt-1">
            <Icon name="calculator" className="w-3.5 h-3.5 text-teal-400" />
            <span className="text-xs text-gray-400">{tr('shareFlat.eachFlatmatePays')}</span>
            <span className="text-sm font-bold gradient-text">{grp.rent && grp.seats ? inr(Math.round(+grp.rent / +grp.seats)) + tr('shareFlat.perMonth') : '—'}</span>
            <span className="text-[11px] text-gray-600">{tr('shareFlat.autoSplit')}</span>
          </div>
          {/* Current vacancy — smart-capped to (people − 1) since you already hold one seat */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('shareFlat.seatsOpenNow')} <span className="text-rose-400">*</span></label><input type="number" min="1" max={Math.max(1, (parseInt(grp.seats, 10) || 2) - 1)} value={grp.seatsOpen} onChange={(e) => setGrp((g) => { const raw = e.target.value; if (raw === '') return { ...g, seatsOpen: '' }; const maxOpen = Math.max(1, (parseInt(g.seats, 10) || 2) - 1); return { ...g, seatsOpen: String(Math.max(1, Math.min(maxOpen, parseInt(raw, 10) || 1))) }; })} className="field w-full rounded-xl px-3.5 py-2.5 text-sm" /><p className="text-[11px] text-gray-500 mt-1">{tr('shareFlat.seatsOpenHelp')}</p></div>
          </div>
          <div data-err="name"><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('shareFlat.nameLabel')} <span className="text-rose-400">*</span></label><input value={grp.name} onChange={(e) => { setGrp({ ...grp, name: e.target.value }); grpErr.clear('name'); }} className={'field w-full rounded-xl px-3.5 py-2.5 text-sm' + grpErr.cx('name')} placeholder={tr('shareFlat.yourNamePlaceholder')} /><FieldError show={grpErr.has('name')}>{grpErr.msg('name')}</FieldError></div>
          <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('shareFlat.shortNote')} <span className="text-gray-600">{tr('shareFlat.optional')}</span></label><textarea value={grp.note} onChange={(e) => setGrp({ ...grp, note: e.target.value })} rows={2} className="field w-full rounded-xl px-3.5 py-2.5 text-sm resize-none" placeholder={tr('shareFlat.groupNotePlaceholder')} /></div>

          {/* Host eligibility — who the poster is to this flat drives the trust badge
              seekers see. A sitting tenant seeking a replacement can't produce
              ownership docs, so they attest a registered rent agreement instead;
              an owner attaches a property Ops already verified. */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-2 inline-flex items-center gap-1.5"><Icon name="shield-check" className="w-3.5 h-3.5 text-teal-400" /> {tr('shareFlat.yourRole')}</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setGrp({ ...grp, role: 'tenant' })} className={'seg text-xs font-semibold px-3 py-2.5 rounded-xl text-gray-300 flex items-center justify-center gap-1.5' + (grp.role === 'tenant' ? ' active' : '')}><Icon name="key-round" className="w-3.5 h-3.5" /> {tr('shareFlat.currentTenant')}</button>
                <button type="button" onClick={() => setGrp({ ...grp, role: 'owner' })} className={'seg text-xs font-semibold px-3 py-2.5 rounded-xl text-gray-300 flex items-center justify-center gap-1.5' + (grp.role === 'owner' ? ' active' : '')}><Icon name="badge-check" className="w-3.5 h-3.5" /> {tr('shareFlat.flatOwner')}</button>
              </div>
            </div>
            {grp.role === 'owner' ? (
              (myListings && myListings.length) ? (
                <div>
                  <label className="block text-[11px] font-medium text-gray-400 mb-1.5">{tr('shareFlat.attachVerifiedProperty')}</label>
                  <NativeSelect title={tr('shareFlat.attachVerifiedProperty')} value={grp.propertyId} onChange={(e) => { const l = myListings.find((x) => x.id === e.target.value); if (l) onAttachProperty(l); else setGrp((g) => ({ ...g, propertyId: '' })); }} className="field w-full rounded-full px-4 py-2 text-sm">
                    <option value="">{tr('shareFlat.selectVerifiedListing')}</option>
                    {myListings.map((l) => <option key={l.id} value={l.id}>{l.title || l.society || l.locality || tr('shareFlat.listingFallback', { id: l.id })}</option>)}
                  </NativeSelect>
                  <p className="text-[11px] text-gray-500 mt-1.5">{tr('shareFlat.ownerAttachHelpPre')} <span className="text-emerald-300 font-semibold">{tr('shareFlat.ownerVerifiedBadge')}</span> {tr('shareFlat.ownerAttachHelpSuf')}</p>
                </div>
              ) : (
                <p className="text-[11px] text-gray-400 leading-relaxed">{tr('shareFlat.noPropertyPre')} <a href="/list-property?share=1" className="text-teal-300 font-semibold underline">{tr('shareFlat.listYourProperty')}</a> {tr('shareFlat.noPropertyMid')} <span className="text-emerald-300 font-semibold">{tr('shareFlat.ownerVerifiedBadge')}</span> {tr('shareFlat.noPropertySuf')}</p>
              )
            ) : (
              <>
                {myTenancies && myTenancies.length > 0 && (
                  <div className="rounded-lg border border-teal-500/20 bg-teal-500/5 p-3">
                    <label className="block text-[11px] font-medium text-teal-200 mb-1.5 inline-flex items-center gap-1.5"><Icon name="key-round" className="w-3.5 h-3.5 text-teal-300" /> {tr('shareFlat.rentingThroughPuneNest')}</label>
                    {/* Action-trigger select: value="" keeps it on the prompt so it
                        prefills the form on each pick rather than holding a selection. */}
                    <NativeSelect title={tr('shareFlat.prefillFromTenancy')} value="" onChange={(e) => { const t = myTenancies.find((x) => (x.id || x.propId) === e.target.value); if (t) onAttachTenancy(t); }} className="field w-full rounded-full px-4 py-2 text-sm">
                      <option value="">{tr('shareFlat.prefillFromTenancy')}</option>
                      {myTenancies.map((t) => <option key={t.id || t.propId} value={t.id || t.propId}>{t.title || t.address || tr('shareFlat.myTenancyFallback')}</option>)}
                    </NativeSelect>
                    <p className="text-[11px] text-gray-400 mt-1.5">{tr('shareFlat.tenancyPrefillHelp')}</p>
                  </div>
                )}
                <label className="flex items-start gap-2.5 text-xs text-gray-300 cursor-pointer select-none">
                  <input type="checkbox" checked={grp.agreement} onChange={(e) => setGrp((g) => ({ ...g, agreement: e.target.checked, agreementDoc: e.target.checked ? g.agreementDoc : null }))} className="w-4 h-4 accent-teal-500 mt-0.5" />
                  <span>{tr('shareFlat.agreementPre')} <span className="text-teal-300 font-semibold">{tr('shareFlat.registeredRentAgreement')}</span> {tr('shareFlat.agreementMid')} <span className="text-teal-300 font-semibold">{tr('shareFlat.tenantVerifiedBadge')}</span> {tr('shareFlat.agreementSuf')}</span>
                </label>
                {grp.agreement && (
                  <AgreementUpload
                    doc={grp.agreementDoc}
                    onChange={(doc) => setGrp((g) => ({ ...g, agreementDoc: doc }))}
                    ariaLabel={tr('shareFlat.agreementUploadAria')}
                    hint={tr('shareFlat.agreementUploadHint')}
                  />
                )}
                <div>
                  <label className="block text-[11px] font-medium text-gray-400 mb-1.5">{tr('shareFlat.ownerMobileConsent')} <span className="text-gray-600">{tr('shareFlat.optional')}</span></label>
                  <input value={grp.consentMobile} onChange={(e) => setGrp({ ...grp, consentMobile: e.target.value.replace(/[^\d]/g, '').slice(0, 10), consentVerified: false })} inputMode="numeric" className="field w-full rounded-xl px-3.5 py-2.5 text-sm" placeholder={tr('shareFlat.consentPlaceholder')} />
                  {grp.consentVerified ? (
                    <p className="text-[11px] text-emerald-300 mt-1.5 inline-flex items-center gap-1.5"><Icon name="badge-check" className="w-3.5 h-3.5" /> {tr('shareFlat.ownerConsentConfirmed')}</p>
                  ) : (
                    <button type="button" onClick={() => onRequestConsent && onRequestConsent()} disabled={grp.consentMobile.length !== 10} className="mt-2 seg text-[11px] font-semibold px-3 py-2 rounded-xl text-gray-200 inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"><Icon name="shield-check" className="w-3.5 h-3.5 text-teal-300" /> {tr('shareFlat.verifyOwnerConsent')}</button>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="flex items-center justify-end gap-3 pt-1">
            <button type="button" onClick={() => setGroupOpen(false)} className="btn-ghost text-sm font-medium text-gray-300 px-5 py-2.5 rounded-xl">{tr('shareFlat.cancel')}</button>
            <button type="submit" className="btn-teal text-sm font-semibold text-white px-6 py-2.5 rounded-xl inline-flex items-center gap-2"><Icon name="users-round" className="w-4 h-4" /> {tr('shareFlat.createGroupSubmit')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
