import { Trans, useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import EvidenceUpload from '../../../components/ui/EvidenceUpload.jsx';
import Select from '../../../components/ui/Select.jsx';
import OtpBoxes from '../../../components/auth/OtpBoxes.jsx';
import SocietyLocationModal from '../../../components/society/SocietyLocationModal.jsx';
import { PROOF_TYPES, SOC_AMEN, CONTRIB_META, BOARD_META } from './constants.js';

/**
 * Report target ids → their label key.
 *
 * All six kinds, not three. The map used to name only `review`, `question` and `answer`, and the
 * lookup fell back to `society.targetReview` for anything missing — so reporting a neighbour's
 * recommendation, a reply to one, or a noticeboard post opened a dialog headed "Report this
 * review". The reader was being asked to confirm a complaint about something other than the thing
 * they had clicked.
 */
const REPORT_TARGET_KEYS = {
  review: 'society.targetReview',
  question: 'society.targetQuestion',
  answer: 'society.targetAnswer',
  contribution: 'society.targetContribution',
  reply: 'society.targetReply',
  board: 'society.targetBoard',
};

export default function SocietyModals({ ctx }) {
  const { t } = useTranslation();
  const {
    onFollow, followed, setRateOpen,
    claim, saasOn, closeClaim, cl, setCl, inp, submitClaim, claimBusy,
    resOpen, closeResident, resStep, res, setRes, unitTaken, resToStep2, user, otp, submitResident, setResStep,
    sugOpen, setSugOpen, sug, setSug, toggleSugAmenity, submitSuggest,
    contribOpen, setContribOpen, cKind, setCKind, cForm, setCForm, submitContribution,
    boardOpen, setBoardOpen, bKind, setBKind, bForm, setBForm, submitBoard,
    waOpen, setWaOpen, waUrl, setWaUrl, submitWa,
    reportFor, setReportFor, reportReason, setReportReason, reportDetails, setReportDetails,
    reportBusy, reportReasons, submitReport,
    locOpen, soc, hasCoords, submitLocation, setLocOpen,
  } = ctx;
  return (
    <>
      {/* Sticky mobile action bar — the two primary society actions (Follow / Review)
          otherwise live only in the hero and scroll away on this long page. Mirrors the
          Property page pattern; desktop keeps the hero + sidebar actions. */}
      <div className="dz-sticky-cta lg:hidden">
        <button onClick={onFollow} className={(followed ? 'btn-outline' : 'btn-teal') + ' flex-1 min-h-[44px] flex items-center justify-center gap-1.5 text-sm font-semibold py-3 px-4'}>
          <Icon name={followed ? 'check' : 'bell'} className="w-4 h-4" /> {followed ? t('society.following') : t('society.follow')}
        </button>
        <button onClick={() => { setRateOpen(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-white/15 text-slate-200 text-sm font-semibold py-3 px-4">
          <Icon name="star" className="w-4 h-4" /> {t('society.review')}
        </button>
      </div>

      {claim && saasOn && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={closeClaim}>
          <div role="dialog" aria-modal="true" aria-label={t('society.onboardTitle')} className="glass rounded-2xl p-6 w-full max-w-md" style={{ background: '#15122a' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">{t('society.onboardTitle')}</h3>
            <p className="text-gray-400 text-sm mb-4">{t('society.onboardSub')}</p>
            <div className="space-y-3">
              <input value={cl.name} onChange={(e) => setCl({ ...cl, name: e.target.value })} placeholder={t('society.yourName')} className={inp} />
              <input value={cl.mobile} onChange={(e) => setCl({ ...cl, mobile: e.target.value })} placeholder={t('society.mobile')} inputMode="numeric" className={inp} />
              <input value={cl.role} onChange={(e) => setCl({ ...cl, role: e.target.value })} placeholder={t('society.rolePlaceholder')} className={inp} />
              <input value={cl.regNo} onChange={(e) => setCl({ ...cl, regNo: e.target.value })} placeholder={t('society.regNoPlaceholder')} className={inp} />
              {/* The second argument is the raw `File`. The preview object is capped at 2 MB and is
                  only good for showing a filename; `submitClaim` uploads the file itself. */}
              <EvidenceUpload doc={cl.cert} onChange={(d, f) => setCl({ ...cl, cert: d, certFile: f })} label={t('society.uploadCert')} ariaLabel={t('society.uploadCertAria')} />
              <p className="text-gray-500 text-[11px]">{t('society.onboardNote')}</p>
            </div>
            <div className="flex gap-2 mt-5"><button onClick={closeClaim} className="btn-outline flex-1">{t('society.cancel')}</button><button onClick={submitClaim} disabled={claimBusy} className="btn-teal flex-1 disabled:opacity-60">{claimBusy ? t('society.sending') : t('society.requestOnboarding')}</button></div>
          </div>
        </div>
      )}

      {resOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={closeResident}>
          <div role="dialog" aria-modal="true" aria-label={t('society.verifyLiveHere')} className="glass rounded-2xl p-6 w-full max-w-md" style={{ background: '#15122a' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-bold">{t('society.verifyLiveHere')}</h3>
              <span className="ml-auto text-xs text-gray-500">{t('society.stepOf', { step: resStep })}</span>
            </div>
            {resStep === 1 ? (
              <>
                <p className="text-gray-400 text-sm mb-4"><Trans i18nKey="society.residentStep1" components={{ 1: <b className="text-violet-300" /> }} /></p>
                <div className="space-y-3">
                  <input value={res.flat} onChange={(e) => setRes({ ...res, flat: e.target.value })} placeholder={t('society.flatPlaceholder')} className={inp} />
                  <input value={res.wing} onChange={(e) => setRes({ ...res, wing: e.target.value })} placeholder={t('society.wingPlaceholder')} className={inp} />
                  {unitTaken ? <p className="text-red-300 text-xs flex items-center gap-1.5"><Icon name="alert-triangle" className="w-3.5 h-3.5 flex-shrink-0" /> {t('society.unitTakenWarning')}</p> : null}
                  <Select
                    value={res.proofType}
                    onChange={(v) => setRes({ ...res, proofType: v })}
                    options={PROOF_TYPES.map(([value, labelKey]) => ({ value, label: t(labelKey) }))}
                    ariaLabel={t('society.proofType')}
                  />
                  <EvidenceUpload doc={res.doc} onChange={(d) => setRes({ ...res, doc: d })} label={t('society.uploadProof')} ariaLabel={t('society.uploadProofAria')} />
                  <textarea value={res.note} onChange={(e) => setRes({ ...res, note: e.target.value })} placeholder={t('society.notePlaceholder')} rows={2} className={inp} />
                </div>
                <div className="flex gap-2 mt-5"><button onClick={closeResident} className="btn-outline flex-1">{t('society.cancel')}</button><button onClick={resToStep2} className="btn-teal flex-1">{t('society.continue')}</button></div>
              </>
            ) : (
              <>
                <p className="text-gray-400 text-sm mb-4">
                  <Trans
                    i18nKey="society.residentStep2"
                    values={{ mobile: (user && user.mobile) || t('society.yourMobile') }}
                    components={{ 1: <b className="text-white" /> }}
                  />
                </p>
                <OtpBoxes value={otp.otp} onChange={(v) => { otp.setOtp(v); otp.setOtpError(false); }} error={otp.otpError} />
                <div className="text-center mt-2 text-xs text-gray-500">
                  {otp.canResend ? <button onClick={otp.resend} className="text-teal-400 hover:text-teal-300">{t('society.resendCode')}</button> : otp.otpSent ? t('society.resendIn', { seconds: otp.seconds }) : t('society.sending')}
                </div>
                <div className="flex gap-2 mt-5"><button onClick={() => setResStep(1)} className="btn-outline flex-1">{t('society.back')}</button><button onClick={submitResident} className="btn-teal flex-1">{t('society.submitForReview')}</button></div>
              </>
            )}
          </div>
        </div>
      )}

      {sugOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={() => setSugOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label={t('society.addDetailsTitle')} className="glass rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" style={{ background: '#15122a' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">{t('society.addDetailsTitle')}</h3>
            <p className="text-gray-400 text-sm mb-4">{t('society.addDetailsSub')}</p>
            <div className="space-y-3">
              <div>
                <label htmlFor="sug-builder" className="block text-xs font-medium text-gray-400 mb-1">{t('society.builderLabel')}</label>
                <input id="sug-builder" value={sug.builder} onChange={(e) => setSug({ ...sug, builder: e.target.value })} placeholder={t('society.builderPlaceholder')} className={inp} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="sug-year" className="block text-xs font-medium text-gray-400 mb-1">{t('society.yearLabel')}</label>
                  <input id="sug-year" value={sug.year} onChange={(e) => setSug({ ...sug, year: e.target.value })} placeholder={t('society.yearPlaceholder')} inputMode="numeric" className={inp} />
                </div>
                <div>
                  <label htmlFor="sug-towers" className="block text-xs font-medium text-gray-400 mb-1">{t('society.towersLabel')}</label>
                  <input id="sug-towers" value={sug.towers} onChange={(e) => setSug({ ...sug, towers: e.target.value })} placeholder={t('society.towersPlaceholder')} inputMode="numeric" className={inp} />
                </div>
              </div>
              <div>
                <label htmlFor="sug-units" className="block text-xs font-medium text-gray-400 mb-1">{t('society.unitsLabel')}</label>
                <input id="sug-units" value={sug.units} onChange={(e) => setSug({ ...sug, units: e.target.value })} placeholder={t('society.unitsPlaceholder')} inputMode="numeric" className={inp} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-2">{t('society.amenitiesLabel')}</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.entries(SOC_AMEN).map(([key, [labelKey, icon]]) => {
                    const on = sug.amenities.includes(key);
                    return (
                      <button key={key} type="button" onClick={() => toggleSugAmenity(key)} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs text-left transition ${on ? 'border-brand-teal bg-brand-teal/15 text-white' : 'border-white/10 text-gray-400 hover:border-white/25'}`}>
                        <Icon name={on ? 'check' : icon} className={`w-3.5 h-3.5 flex-shrink-0 ${on ? 'text-brand-teal-3' : 'text-gray-500'}`} /> {t(labelKey)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5"><button onClick={() => setSugOpen(false)} className="btn-outline flex-1">{t('society.cancel')}</button><button onClick={submitSuggest} className="btn-teal flex-1">{t('society.submitForReview')}</button></div>
          </div>
        </div>
      )}

      {contribOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={() => setContribOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label={t(CONTRIB_META[cKind].addKey)} className="glass rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" style={{ background: '#15122a' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><Icon name={CONTRIB_META[cKind].icon} className="w-5 h-5 text-teal-400" /> {t(CONTRIB_META[cKind].addKey)}</h3>
            <p className="text-gray-400 text-sm mb-4">{t('society.contribSub')}</p>

            <div className="flex gap-1.5 mb-4">
              {Object.entries(CONTRIB_META).map(([kind, m]) => (
                <button key={kind} type="button" onClick={() => { setCKind(kind); setCForm((f) => ({ ...f, category: m.cats[0] })); }} className={`flex-1 rounded-lg border px-2 py-2 text-xs font-medium transition ${cKind === kind ? 'border-brand-teal bg-brand-teal/15 text-white' : 'border-white/10 text-gray-400 hover:border-white/25'}`}><Icon name={m.icon} className="w-4 h-4 mx-auto mb-1" /> {t(m.labelKey)}</button>
              ))}
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">{t('society.category')}</label>
                <Select value={cForm.category} onChange={(v) => setCForm((f) => ({ ...f, category: v }))} options={CONTRIB_META[cKind].cats.map((c) => ({ value: c, label: c }))} ariaLabel={t('society.contribCategoryAria')} />
              </div>

              {cKind === 'tip' ? (
                <textarea value={cForm.text} onChange={(e) => setCForm((f) => ({ ...f, text: e.target.value }))} rows={4} maxLength={600} placeholder={t('society.tipPlaceholder')} className={inp} />
              ) : null}

              {cKind === 'pick' ? (
                <>
                  <input value={cForm.name} onChange={(e) => setCForm((f) => ({ ...f, name: e.target.value }))} placeholder={t('society.pickNamePlaceholder')} className={inp} />
                  <input value={cForm.contact} onChange={(e) => setCForm((f) => ({ ...f, contact: e.target.value }))} placeholder={t('society.pickPhonePlaceholder')} inputMode="tel" className={inp} />
                  <textarea value={cForm.note} onChange={(e) => setCForm((f) => ({ ...f, note: e.target.value }))} rows={3} maxLength={300} placeholder={t('society.pickNotePlaceholder')} className={inp} />
                </>
              ) : null}

              {cKind === 'photo' ? (
                <>
                  <EvidenceUpload doc={cForm.photo} onChange={(d, f) => setCForm((fm) => ({ ...fm, photo: d, photoFile: f }))} label={t('society.uploadPhoto')} ariaLabel={t('society.uploadPhoto')} />
                  {/* Against the server's ceiling, not `doc.tooLarge`. That flag means "over the 2 MB
                      data-URL preview cap", which mattered when the photo *was* the preview and was
                      kept in localStorage. The bytes now go to `POST /me/photos`, which takes 5 MB,
                      so warning at 2 MB told a resident to go and shrink a photograph the platform
                      would have accepted untouched. */}
                  {cForm.photoFile && cForm.photoFile.size > 5 * 1024 * 1024 ? <p className="text-amber-300 text-xs flex items-center gap-1.5"><Icon name="alert-triangle" className="w-3.5 h-3.5 flex-shrink-0" /> {t('society.photoTooLarge')}</p> : null}
                  <input value={cForm.caption} onChange={(e) => setCForm((f) => ({ ...f, caption: e.target.value }))} placeholder={t('society.captionPlaceholder')} className={inp} />
                </>
              ) : null}
            </div>

            <div className="flex gap-2 mt-5"><button onClick={() => setContribOpen(false)} className="btn-outline flex-1">{t('society.cancel')}</button><button onClick={submitContribution} className="btn-teal flex-1">{t('society.postToCommunity')}</button></div>
          </div>
        </div>
      )}

      {boardOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={() => setBoardOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label={t(BOARD_META[bKind].addKey)} className="glass rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" style={{ background: '#15122a' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><Icon name={BOARD_META[bKind].icon} className="w-5 h-5 text-teal-400" /> {t(BOARD_META[bKind].addKey)}</h3>
            <p className="text-gray-400 text-sm mb-4">{t('society.boardSub')}</p>
            <div className="flex gap-1.5 mb-4">
              {Object.entries(BOARD_META).map(([kind, meta]) => (
                <button key={kind} type="button" onClick={() => { setBKind(kind); setBForm((f) => ({ ...f, category: meta.cats[0] })); }} className={`flex-1 rounded-lg border px-2 py-2 text-xs font-medium transition ${bKind === kind ? 'border-brand-teal bg-brand-teal/15 text-white' : 'border-white/10 text-gray-400 hover:border-white/25'}`}><Icon name={meta.icon} className="w-4 h-4 mx-auto mb-1" /> {t(meta.labelKey)}</button>
              ))}
            </div>
            <div className="space-y-3">
              <input value={bForm.title} onChange={(e) => setBForm((f) => ({ ...f, title: e.target.value }))} placeholder={bKind === 'event' ? t('society.eventTitlePlaceholder') : t('society.noticeTitlePlaceholder')} className={inp} />
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">{t('society.category')}</label>
                <Select value={bForm.category} onChange={(v) => setBForm((f) => ({ ...f, category: v }))} options={BOARD_META[bKind].cats.map((c) => ({ value: c, label: c }))} ariaLabel={t('society.boardCategoryAria')} />
              </div>
              {bKind === 'event' ? (
                <div className="flex gap-2">
                  <div className="flex-1"><label className="block text-xs font-medium text-gray-400 mb-1">{t('society.dateLabel')}</label><input type="date" value={bForm.date} onChange={(e) => setBForm((f) => ({ ...f, date: e.target.value }))} className={inp} /></div>
                  <div className="w-28"><label className="block text-xs font-medium text-gray-400 mb-1">{t('society.timeLabel')}</label><input type="time" value={bForm.time} onChange={(e) => setBForm((f) => ({ ...f, time: e.target.value }))} className={inp} /></div>
                </div>
              ) : null}
              <textarea value={bForm.body} onChange={(e) => setBForm((f) => ({ ...f, body: e.target.value }))} rows={3} maxLength={800} placeholder={t('society.detailsPlaceholder')} className={inp} />
            </div>
            <div className="flex gap-2 mt-5"><button onClick={() => setBoardOpen(false)} className="btn-outline flex-1">{t('society.cancel')}</button><button onClick={submitBoard} className="btn-teal flex-1">{t('society.post')}</button></div>
          </div>
        </div>
      )}

      {waOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={() => setWaOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label={t('society.waModalTitle')} className="glass rounded-2xl p-6 w-full max-w-md" style={{ background: '#15122a' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><Icon name="message-circle" className="w-5 h-5 text-emerald-300" /> {t('society.waModalTitle')}</h3>
            <p className="text-gray-400 text-sm mb-4">{t('society.waModalSub')}</p>
            <input value={waUrl} onChange={(e) => setWaUrl(e.target.value)} placeholder={t('society.waUrlPlaceholder')} inputMode="url" className={inp} />
            <p className="text-[11px] text-slate-500 mt-2"><Trans i18nKey="society.waOnlyGenuine" components={{ 1: <b /> }} /></p>
            <div className="flex gap-2 mt-5"><button onClick={() => setWaOpen(false)} className="btn-outline flex-1">{t('society.cancel')}</button><button onClick={submitWa} className="btn-teal flex-1">{t('society.submitForReview')}</button></div>
          </div>
        </div>
      )}

      {reportFor && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={() => setReportFor(null)}>
          <div role="dialog" aria-modal="true" aria-label={t('society.submitReport')} className="glass rounded-2xl p-6 w-full max-w-md" style={{ background: '#15122a' }} onClick={(e) => e.stopPropagation()}>
            {/* `targetType` is a stored id ('review' | 'question' | 'answer'), so the
                label is looked up rather than inserted raw — Devanagari needs the
                noun inflected, which an English word dropped into a template cannot do. */}
            <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><Icon name="flag" className="w-5 h-5 text-amber-300" /> {t('society.reportThis', { type: t(REPORT_TARGET_KEYS[reportFor.targetType] || 'society.targetReview') })}</h3>
            <p className="text-gray-400 text-sm mb-4">{t('society.reportSub')}</p>
            {reportFor.snapshot ? <p className="text-xs text-gray-400 rounded-lg bg-white/5 border border-white/10 p-2.5 mb-3 line-clamp-3">“{reportFor.snapshot}”</p> : null}
            {/* A reason *code*, then the prose.
                This was one free-text box, and its contents were the whole complaint. A queue of
                sentences cannot be counted or filtered — "he put my number on here" and "this is
                spam" arrived as the same shapeless field — and the server refuses a report with no
                recognised reason, so the box on its own could not have submitted anything at all.
                The picker is what ops filter on; the textarea, still here, is what they read. */}
            <Select
              value={reportReason}
              onChange={setReportReason}
              options={reportReasons.map(([value, label]) => ({ value, label }))}
              ariaLabel={t('society.reasonLabel')}
              className="mb-2.5"
            />
            <textarea value={reportDetails} onChange={(e) => setReportDetails(e.target.value)} rows={3} maxLength={200} placeholder={t('society.detailsPlaceholder')} className={inp} />
            <div className="flex gap-2 mt-5"><button onClick={() => setReportFor(null)} className="btn-outline flex-1">{t('society.cancel')}</button><button onClick={submitReport} disabled={reportBusy} className="btn-teal flex-1 disabled:opacity-60">{t('society.submitReport')}</button></div>
          </div>
        </div>
      )}

      {locOpen && (
        <SocietyLocationModal
          societyName={soc.name}
          initial={hasCoords ? { lat: soc.lat, lng: soc.lng } : null}
          onSubmit={submitLocation}
          onClose={() => setLocOpen(false)}
        />
      )}
    </>
  );
}
