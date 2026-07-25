import Icon from '../../../components/Icon.jsx';
import { PROOF_TYPES } from './constants.js';

export default function SocietySidebar({ ctx }) {
  const {
    iAmResident, resStat, requireLogin, setResStep, setResOpen,
    wa, waRaw, iAmResidentOrAdmin, openWa, waExists, iAmAdmin, committee, refreshCommittee,
    saasOn, claimed, claimPending, setClaim, followed, onFollow, soc,
  } = ctx;
  return (
          <aside className="space-y-4">
            {/* Verified-resident card — the community trust lever */}
            <div className="glass rounded-2xl p-6 reveal" style={{ borderColor: 'rgba(139,92,246,.3)', background: 'linear-gradient(135deg,rgba(139,92,246,.1),rgba(139,92,246,.03))' }}>
              <div className="flex items-center gap-2 mb-2"><Icon name="badge-check" className="w-5 h-5 text-violet-300" /><h3 className="font-bold">Live here?</h3></div>
              {iAmResident ? (
                <p className="text-violet-200 text-sm flex items-center gap-1.5"><Icon name="check" className="w-4 h-4 flex-shrink-0" /> You&apos;re a <b>verified resident</b>. Your reviews &amp; answers carry a Resident badge.</p>
              ) : resStat && resStat.status === 'pending' ? (
                <p className="text-gray-300 text-sm flex items-center gap-1.5"><Icon name="clock" className="w-4 h-4 text-amber-300 flex-shrink-0" /> Verification under review — we&apos;ll confirm your Resident badge shortly.</p>
              ) : (
                <>
                  <p className="text-gray-300 text-sm mb-4">Verify your flat to get a <b>Resident</b> badge on your reviews &amp; answers — helping fellow home-hunters trust your word.{resStat && resStat.status === 'rejected' ? ' Your last request needs another look.' : ''}</p>
                  <button onClick={() => (requireLogin() ? (setResStep(1), setResOpen(true)) : null)} className="btn-outline w-full"><Icon name="home" className="w-4 h-4 mr-1.5" /> Verify you live here</button>
                </>
              )}
            </div>

            {/* Residents-only WhatsApp group — the invite is PRIVATE. Ops screen the
                link for scams, but the join URL is shown only to verified residents /
                committee, never published to the public. Non-residents see a
                verify-to-join teaser (no URL leak). */}
            <div className="glass rounded-2xl p-6 reveal" style={{ borderColor: 'rgba(37,211,102,.3)', background: 'linear-gradient(135deg,rgba(37,211,102,.1),rgba(37,211,102,.03))' }}>
              <div className="flex items-center gap-2 mb-2"><Icon name="message-circle" className="w-5 h-5 text-emerald-300" /><h3 className="font-bold">Resident WhatsApp group</h3></div>
              {wa ? (
                <>
                  <p className="text-gray-300 text-sm mb-4">Chat with neighbours, get instant help &amp; local updates in the verified resident group.</p>
                  <a href={wa.url} target="_blank" rel="noopener noreferrer" className="btn-teal w-full inline-flex items-center justify-center"><Icon name="message-circle" className="w-4 h-4 mr-1.5" /> Join WhatsApp group</a>
                  <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1"><Icon name="lock" className="w-3 h-3 flex-shrink-0" /> Private to verified residents — not shared publicly.</p>
                </>
              ) : waRaw && waRaw.status === 'pending' && iAmResidentOrAdmin ? (
                <p className="text-gray-300 text-sm flex items-center gap-1.5"><Icon name="clock" className="w-4 h-4 text-amber-300 flex-shrink-0" /> Your group link is under review — residents can join once our team approves it.<button onClick={openWa} className="text-brand-teal-3 hover:underline ml-1">Edit</button></p>
              ) : waExists ? (
                <>
                  <p className="text-gray-300 text-sm mb-4">This society has a <b>private</b> residents-only WhatsApp group. The invite isn&apos;t shared publicly — verify you live here to join.</p>
                  <button onClick={() => (requireLogin() ? (setResStep(1), setResOpen(true)) : null)} className="btn-outline w-full"><Icon name="home" className="w-4 h-4 mr-1.5" /> Verify you live here to join</button>
                </>
              ) : iAmResidentOrAdmin ? (
                <>
                  <p className="text-gray-300 text-sm mb-4">Add your society&apos;s WhatsApp group invite. We screen it for scam links first — then it&apos;s shared privately with verified residents only, never the public.</p>
                  <button onClick={openWa} className="btn-outline w-full"><Icon name="plus" className="w-4 h-4 mr-1.5" /> Add the group link</button>
                </>
              ) : (
                <p className="text-gray-400 text-sm">No resident group yet. Verified residents &amp; the committee can add one.</p>
              )}
            </div>

            {iAmAdmin ? (
              <div className="glass rounded-2xl p-6 reveal" style={{ borderColor: 'rgba(37,99,235,.35)', background: 'linear-gradient(135deg,rgba(37,99,235,.12),rgba(37,99,235,.03))' }}>
                <div className="flex items-center gap-2 mb-1"><Icon name="shield-check" className="w-5 h-5 text-blue-300" /><h3 className="font-bold">Committee console</h3></div>
                <p className="text-gray-400 text-xs mb-3">You manage this society. Approve residents proving they live here.</p>
                {committee.filter((r) => r.status === 'pending').length === 0 ? (
                  <p className="text-gray-400 text-sm">No pending resident requests.</p>
                ) : (
                  <ul className="space-y-3">
                    {committee.filter((r) => r.status === 'pending').map((r) => (
                      <li key={r.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{r.name}</div>
                            <div className="text-xs text-gray-400">{[r.wing, r.flat].filter(Boolean).join(' · ') || '—'}</div>
                          </div>
                          {r.flagged === 'conflict' ? <span className="tag" style={{ background: 'rgba(220,38,38,.85)', color: '#fff', border: 'none' }}><Icon name="alert-triangle" className="w-3 h-3" /> Unit taken</span> : null}
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2 text-[11px] text-gray-300">
                          {r.otpVerified ? <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 text-emerald-200 px-1.5 py-0.5"><Icon name="check" className="w-3 h-3" /> OTP</span> : null}
                          {r.doc ? <span className="inline-flex items-center gap-1 rounded bg-violet-500/15 text-violet-200 px-1.5 py-0.5"><Icon name="file-check" className="w-3 h-3" /> {PROOF_TYPES.find((p) => p[0] === r.proofType)?.[1] || 'Doc'}</span> : <span className="inline-flex items-center gap-1 rounded bg-white/10 text-gray-400 px-1.5 py-0.5">No doc</span>}
                        </div>
                        <div className="flex gap-2 mt-2.5">
                          <button onClick={() => refreshCommittee(r, 'verified')} className="btn-teal flex-1 py-1.5 text-xs">Verify</button>
                          <button onClick={() => refreshCommittee(r, 'rejected')} className="btn-outline flex-1 py-1.5 text-xs">Reject</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {saasOn ? (
              <div className="glass rounded-2xl p-6 reveal" style={{ borderColor: 'rgba(13,148,136,.3)', background: 'linear-gradient(135deg,rgba(13,148,136,.1),rgba(20,184,166,.05))' }}>
                <div className="flex items-center gap-2 mb-2"><Icon name="shield" className="w-5 h-5 text-teal-300" /><h3 className="font-bold">PuneNest Society</h3></div>
                {claimed ? (
                  <p className="text-teal-100 text-sm flex items-center gap-1.5"><Icon name="shield-check" className="w-4 h-4 flex-shrink-0" /> {iAmAdmin ? <>You <b>manage this society</b> on PuneNest. Approve residents in the committee console above.</> : <>This society is <b>managed on PuneNest</b> — verified admin, broker-free supply.</>}</p>
                ) : claimPending ? (
                  <p className="text-gray-300 text-sm flex items-center gap-1.5"><Icon name="clock" className="w-4 h-4 text-amber-300 flex-shrink-0" /> An onboarding request is <b>under review</b>. Our team will verify the committee shortly.</p>
                ) : (
                  <>
                    <p className="text-gray-300 text-sm mb-4">On the RWA / managing committee? Get <b>free</b> visitor &amp; gate management, maintenance dues, notices and complaints — and turn your society into a verified, broker-free supply pool.</p>
                    <button onClick={() => setClaim(true)} className="btn-teal w-full"><Icon name="building" className="w-4 h-4 mr-1.5" /> Claim / onboard this society</button>
                    <p className="text-gray-500 text-[11px] mt-2 text-center">Free for the first 50 Pune societies.</p>
                  </>
                )}
              </div>
            ) : null}
            <div className={'glass rounded-2xl p-6 reveal' + (followed ? ' ' : '')}>
              <h3 className="font-bold mb-2 flex items-center gap-2"><Icon name="bell" className="w-4 h-4 text-teal-400" /> Stay updated</h3>
              <p className="text-gray-400 text-sm mb-3">Follow {soc.name} to get alerts when a new home is listed or prices move.</p>
              <button onClick={onFollow} className={(followed ? 'btn-teal' : 'btn-outline') + ' w-full'}><Icon name={followed ? 'check' : 'bell'} className="w-4 h-4 mr-1.5" /> {followed ? 'Following' : 'Follow society'}</button>
            </div>
            <div className="glass rounded-2xl p-6 reveal">
              <h3 className="font-bold mb-3 flex items-center gap-2"><Icon name="hand-coins" className="w-4 h-4 text-emerald-400" /> Why PuneNest</h3>
              <ul className="space-y-2.5 text-sm text-gray-300">
                <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" /> Zero brokerage, deal direct with owners</li>
                <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" /> Verified owners &amp; protected numbers</li>
                <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" /> Society-level price, rent &amp; livability insights</li>
              </ul>
            </div>
          </aside>
  );
}
