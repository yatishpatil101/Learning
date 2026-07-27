import Icon from '../../../components/Icon.jsx';
import EvidenceUpload from '../../../components/ui/EvidenceUpload.jsx';
import Select from '../../../components/ui/Select.jsx';
import OtpBoxes from '../../../components/auth/OtpBoxes.jsx';
import SocietyLocationModal from '../../../components/society/SocietyLocationModal.jsx';
import { PROOF_TYPES, SOC_AMEN, CONTRIB_META, BOARD_META } from './constants.js';

export default function SocietyModals({ ctx }) {
  const {
    onFollow, followed, setRateOpen,
    claim, saasOn, closeClaim, cl, setCl, inp, submitClaim,
    resOpen, closeResident, resStep, res, setRes, unitTaken, resToStep2, user, otp, submitResident, setResStep,
    sugOpen, setSugOpen, sug, setSug, toggleSugAmenity, submitSuggest,
    contribOpen, setContribOpen, cKind, setCKind, cForm, setCForm, submitContribution,
    boardOpen, setBoardOpen, bKind, setBKind, bForm, setBForm, submitBoard,
    waOpen, setWaOpen, waUrl, setWaUrl, submitWa,
    reportFor, setReportFor, reportReason, setReportReason, submitReport,
    locOpen, soc, hasCoords, submitLocation, setLocOpen,
  } = ctx;
  return (
    <>
      {/* Sticky mobile action bar — the two primary society actions (Follow / Review)
          otherwise live only in the hero and scroll away on this long page. Mirrors the
          Property page pattern; desktop keeps the hero + sidebar actions. */}
      <div className="pn-sticky-cta lg:hidden">
        <button onClick={onFollow} className={(followed ? 'btn-outline' : 'btn-teal') + ' flex-1 min-h-[44px] flex items-center justify-center gap-1.5 text-sm font-semibold py-3 px-4'}>
          <Icon name={followed ? 'check' : 'bell'} className="w-4 h-4" /> {followed ? 'Following' : 'Follow'}
        </button>
        <button onClick={() => { setRateOpen(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-white/15 text-slate-200 text-sm font-semibold py-3 px-4">
          <Icon name="star" className="w-4 h-4" /> Review
        </button>
      </div>

      {claim && saasOn && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={closeClaim}>
          <div role="dialog" aria-modal="true" aria-label="Onboard your society" className="glass rounded-2xl p-6 w-full max-w-md" style={{ background: '#15122a' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">Onboard your society</h3>
            <p className="text-gray-400 text-sm mb-4">We&apos;ll set up free Society SaaS and a verified listing hub once we confirm you&apos;re on the committee.</p>
            <div className="space-y-3">
              <input value={cl.name} onChange={(e) => setCl({ ...cl, name: e.target.value })} placeholder="Your name" className={inp} />
              <input value={cl.mobile} onChange={(e) => setCl({ ...cl, mobile: e.target.value })} placeholder="Mobile" inputMode="numeric" className={inp} />
              <input value={cl.role} onChange={(e) => setCl({ ...cl, role: e.target.value })} placeholder="Role (e.g. Secretary, Committee member)" className={inp} />
              <input value={cl.regNo} onChange={(e) => setCl({ ...cl, regNo: e.target.value })} placeholder="Society registration no. (e.g. PNA/1234/2015)" className={inp} />
              <EvidenceUpload doc={cl.cert} onChange={(d) => setCl({ ...cl, cert: d })} label="Upload registration certificate (optional)" ariaLabel="Upload society registration certificate" />
              <p className="text-gray-500 text-[11px]">The Maharashtra registration number &amp; certificate help us verify the committee. Only one onboarding request is accepted per society.</p>
            </div>
            <div className="flex gap-2 mt-5"><button onClick={closeClaim} className="btn-outline flex-1">Cancel</button><button onClick={submitClaim} className="btn-teal flex-1">Request onboarding</button></div>
          </div>
        </div>
      )}

      {resOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={closeResident}>
          <div role="dialog" aria-modal="true" aria-label="Verify you live here" className="glass rounded-2xl p-6 w-full max-w-md" style={{ background: '#15122a' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-bold">Verify you live here</h3>
              <span className="ml-auto text-xs text-gray-500">Step {resStep} of 2</span>
            </div>
            {resStep === 1 ? (
              <>
                <p className="text-gray-400 text-sm mb-4">Add your flat &amp; a proof so we can grant a <b className="text-violet-300">Resident</b> badge. Only your badge is public — flat details &amp; documents stay private.</p>
                <div className="space-y-3">
                  <input value={res.flat} onChange={(e) => setRes({ ...res, flat: e.target.value })} placeholder="Flat / unit no. (e.g. B-1204)" className={inp} />
                  <input value={res.wing} onChange={(e) => setRes({ ...res, wing: e.target.value })} placeholder="Wing / tower (optional)" className={inp} />
                  {unitTaken ? <p className="text-red-300 text-xs flex items-center gap-1.5"><Icon name="alert-triangle" className="w-3.5 h-3.5 flex-shrink-0" /> This unit already has a verified resident. You can still apply — it&apos;ll need extra review.</p> : null}
                  <Select
                    value={res.proofType}
                    onChange={(v) => setRes({ ...res, proofType: v })}
                    options={PROOF_TYPES.map(([value, label]) => ({ value, label }))}
                    ariaLabel="Proof type"
                  />
                  <EvidenceUpload doc={res.doc} onChange={(d) => setRes({ ...res, doc: d })} label="Upload proof of residence (recommended)" ariaLabel="Upload proof of residence" />
                  <textarea value={res.note} onChange={(e) => setRes({ ...res, note: e.target.value })} placeholder="Anything to help us verify (optional)" rows={2} className={inp} />
                </div>
                <div className="flex gap-2 mt-5"><button onClick={closeResident} className="btn-outline flex-1">Cancel</button><button onClick={resToStep2} className="btn-teal flex-1">Continue</button></div>
              </>
            ) : (
              <>
                <p className="text-gray-400 text-sm mb-4">We sent a 6-digit code to <b className="text-white">{(user && user.mobile) || 'your mobile'}</b>. Enter it to confirm this is really you.</p>
                <OtpBoxes value={otp.otp} onChange={(v) => { otp.setOtp(v); otp.setOtpError(false); }} error={otp.otpError} />
                <div className="text-center mt-2 text-xs text-gray-500">
                  {otp.canResend ? <button onClick={otp.resend} className="text-teal-400 hover:text-teal-300">Resend code</button> : otp.otpSent ? `Resend in ${otp.seconds}s` : 'Sending…'}
                </div>
                <div className="flex gap-2 mt-5"><button onClick={() => setResStep(1)} className="btn-outline flex-1">Back</button><button onClick={submitResident} className="btn-teal flex-1">Submit for review</button></div>
              </>
            )}
          </div>
        </div>
      )}

      {sugOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={() => setSugOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Add society details" className="glass rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" style={{ background: '#15122a' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">Add society details</h3>
            <p className="text-gray-400 text-sm mb-4">Know this place? Share what you can. Our team reviews every submission before it goes live — it won&apos;t show as verified.</p>
            <div className="space-y-3">
              <div>
                <label htmlFor="sug-builder" className="block text-xs font-medium text-gray-400 mb-1">Builder / developer</label>
                <input id="sug-builder" value={sug.builder} onChange={(e) => setSug({ ...sug, builder: e.target.value })} placeholder="e.g. Kolte-Patil" className={inp} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="sug-year" className="block text-xs font-medium text-gray-400 mb-1">Year built</label>
                  <input id="sug-year" value={sug.year} onChange={(e) => setSug({ ...sug, year: e.target.value })} placeholder="e.g. 2018" inputMode="numeric" className={inp} />
                </div>
                <div>
                  <label htmlFor="sug-towers" className="block text-xs font-medium text-gray-400 mb-1">Towers / wings</label>
                  <input id="sug-towers" value={sug.towers} onChange={(e) => setSug({ ...sug, towers: e.target.value })} placeholder="e.g. 5" inputMode="numeric" className={inp} />
                </div>
              </div>
              <div>
                <label htmlFor="sug-units" className="block text-xs font-medium text-gray-400 mb-1">Total units / flats</label>
                <input id="sug-units" value={sug.units} onChange={(e) => setSug({ ...sug, units: e.target.value })} placeholder="e.g. 420" inputMode="numeric" className={inp} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-2">Amenities</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.entries(SOC_AMEN).map(([key, [label, icon]]) => {
                    const on = sug.amenities.includes(key);
                    return (
                      <button key={key} type="button" onClick={() => toggleSugAmenity(key)} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs text-left transition ${on ? 'border-brand-teal bg-brand-teal/15 text-white' : 'border-white/10 text-gray-400 hover:border-white/25'}`}>
                        <Icon name={on ? 'check' : icon} className={`w-3.5 h-3.5 flex-shrink-0 ${on ? 'text-brand-teal-3' : 'text-gray-500'}`} /> {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5"><button onClick={() => setSugOpen(false)} className="btn-outline flex-1">Cancel</button><button onClick={submitSuggest} className="btn-teal flex-1">Submit for review</button></div>
          </div>
        </div>
      )}

      {contribOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={() => setContribOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Add a community contribution" className="glass rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" style={{ background: '#15122a' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><Icon name={CONTRIB_META[cKind].icon} className="w-5 h-5 text-teal-400" /> Add {CONTRIB_META[cKind].label.toLowerCase()}</h3>
            <p className="text-gray-400 text-sm mb-4">Shared publicly with your name &amp; verified badge. Keep it real &amp; useful for neighbours.</p>

            <div className="flex gap-1.5 mb-4">
              {Object.entries(CONTRIB_META).map(([kind, m]) => (
                <button key={kind} type="button" onClick={() => { setCKind(kind); setCForm((f) => ({ ...f, category: m.cats[0] })); }} className={`flex-1 rounded-lg border px-2 py-2 text-xs font-medium transition ${cKind === kind ? 'border-brand-teal bg-brand-teal/15 text-white' : 'border-white/10 text-gray-400 hover:border-white/25'}`}><Icon name={m.icon} className="w-4 h-4 mx-auto mb-1" /> {m.label}</button>
              ))}
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Category</label>
                <Select value={cForm.category} onChange={(v) => setCForm((f) => ({ ...f, category: v }))} options={CONTRIB_META[cKind].cats.map((c) => ({ value: c, label: c }))} ariaLabel="Contribution category" />
              </div>

              {cKind === 'tip' ? (
                <textarea value={cForm.text} onChange={(e) => setCForm((f) => ({ ...f, text: e.target.value }))} rows={4} maxLength={600} placeholder="e.g. Water tanker fills at 7am — keep your sump open by 6:45. Guest parking is behind D-wing." className={inp} />
              ) : null}

              {cKind === 'pick' ? (
                <>
                  <input value={cForm.name} onChange={(e) => setCForm((f) => ({ ...f, name: e.target.value }))} placeholder="Person / service name (e.g. Sunita — maid)" className={inp} />
                  <input value={cForm.contact} onChange={(e) => setCForm((f) => ({ ...f, contact: e.target.value }))} placeholder="Phone (optional)" inputMode="tel" className={inp} />
                  <textarea value={cForm.note} onChange={(e) => setCForm((f) => ({ ...f, note: e.target.value }))} rows={3} maxLength={300} placeholder="Why you recommend them (optional)" className={inp} />
                </>
              ) : null}

              {cKind === 'photo' ? (
                <>
                  <EvidenceUpload doc={cForm.photo} onChange={(d) => setCForm((f) => ({ ...f, photo: d }))} label="Upload a society photo" ariaLabel="Upload a society photo" />
                  {cForm.photo && cForm.photo.tooLarge ? <p className="text-amber-300 text-xs flex items-center gap-1.5"><Icon name="alert-triangle" className="w-3.5 h-3.5 flex-shrink-0" /> That image is over 2MB — please pick a smaller one.</p> : null}
                  <input value={cForm.caption} onChange={(e) => setCForm((f) => ({ ...f, caption: e.target.value }))} placeholder="Caption (optional)" className={inp} />
                </>
              ) : null}
            </div>

            <div className="flex gap-2 mt-5"><button onClick={() => setContribOpen(false)} className="btn-outline flex-1">Cancel</button><button onClick={submitContribution} className="btn-teal flex-1">Post to community</button></div>
          </div>
        </div>
      )}

      {boardOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={() => setBoardOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Add an event or notice" className="glass rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" style={{ background: '#15122a' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><Icon name={BOARD_META[bKind].icon} className="w-5 h-5 text-teal-400" /> Add {BOARD_META[bKind].label.toLowerCase()}</h3>
            <p className="text-gray-400 text-sm mb-4">Posted as a resident — visible to everyone viewing this society.</p>
            <div className="flex gap-1.5 mb-4">
              {Object.entries(BOARD_META).map(([kind, meta]) => (
                <button key={kind} type="button" onClick={() => { setBKind(kind); setBForm((f) => ({ ...f, category: meta.cats[0] })); }} className={`flex-1 rounded-lg border px-2 py-2 text-xs font-medium transition ${bKind === kind ? 'border-brand-teal bg-brand-teal/15 text-white' : 'border-white/10 text-gray-400 hover:border-white/25'}`}><Icon name={meta.icon} className="w-4 h-4 mx-auto mb-1" /> {meta.label}</button>
              ))}
            </div>
            <div className="space-y-3">
              <input value={bForm.title} onChange={(e) => setBForm((f) => ({ ...f, title: e.target.value }))} placeholder={bKind === 'event' ? 'Event title (e.g. Water tank cleaning)' : 'Notice title (e.g. Diwali decoration drive)'} className={inp} />
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Category</label>
                <Select value={bForm.category} onChange={(v) => setBForm((f) => ({ ...f, category: v }))} options={BOARD_META[bKind].cats.map((c) => ({ value: c, label: c }))} ariaLabel="Board category" />
              </div>
              {bKind === 'event' ? (
                <div className="flex gap-2">
                  <div className="flex-1"><label className="block text-xs font-medium text-gray-400 mb-1">Date</label><input type="date" value={bForm.date} onChange={(e) => setBForm((f) => ({ ...f, date: e.target.value }))} className={inp} /></div>
                  <div className="w-28"><label className="block text-xs font-medium text-gray-400 mb-1">Time</label><input type="time" value={bForm.time} onChange={(e) => setBForm((f) => ({ ...f, time: e.target.value }))} className={inp} /></div>
                </div>
              ) : null}
              <textarea value={bForm.body} onChange={(e) => setBForm((f) => ({ ...f, body: e.target.value }))} rows={3} maxLength={800} placeholder="Details (optional)" className={inp} />
            </div>
            <div className="flex gap-2 mt-5"><button onClick={() => setBoardOpen(false)} className="btn-outline flex-1">Cancel</button><button onClick={submitBoard} className="btn-teal flex-1">Post</button></div>
          </div>
        </div>
      )}

      {waOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={() => setWaOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Add WhatsApp group link" className="glass rounded-2xl p-6 w-full max-w-md" style={{ background: '#15122a' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><Icon name="message-circle" className="w-5 h-5 text-emerald-300" /> Resident WhatsApp group</h3>
            <p className="text-gray-400 text-sm mb-4">Paste the group&apos;s invite link. We review it before it goes public to keep scam links out.</p>
            <input value={waUrl} onChange={(e) => setWaUrl(e.target.value)} placeholder="https://chat.whatsapp.com/…" inputMode="url" className={inp} />
            <p className="text-[11px] text-slate-500 mt-2">Only genuine <b>chat.whatsapp.com</b> invite links are accepted.</p>
            <div className="flex gap-2 mt-5"><button onClick={() => setWaOpen(false)} className="btn-outline flex-1">Cancel</button><button onClick={submitWa} className="btn-teal flex-1">Submit for review</button></div>
          </div>
        </div>
      )}

      {reportFor && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }} onClick={() => setReportFor(null)}>
          <div role="dialog" aria-modal="true" aria-label="Report content" className="glass rounded-2xl p-6 w-full max-w-md" style={{ background: '#15122a' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><Icon name="flag" className="w-5 h-5 text-amber-300" /> Report this {reportFor.targetType}</h3>
            <p className="text-gray-400 text-sm mb-4">Tell us what&apos;s wrong — spam, scam, abusive or wrong info. Our team reviews every report.</p>
            {reportFor.snapshot ? <p className="text-xs text-gray-400 rounded-lg bg-white/5 border border-white/10 p-2.5 mb-3 line-clamp-3">“{reportFor.snapshot}”</p> : null}
            <textarea value={reportReason} onChange={(e) => setReportReason(e.target.value)} rows={3} maxLength={200} placeholder="Reason (optional)" className={inp} />
            <div className="flex gap-2 mt-5"><button onClick={() => setReportFor(null)} className="btn-outline flex-1">Cancel</button><button onClick={submitReport} className="btn-teal flex-1">Submit report</button></div>
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
