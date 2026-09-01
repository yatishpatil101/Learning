import { Trans, useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';

export default function SocietySidebar({ ctx }) {
  const { t } = useTranslation();
  const {
    iAmResident, resStat, requireLogin, setResStep, setResOpen,
    wa, waRaw, iAmResidentOrAdmin, openWa, waExists, iAmAdmin, committee, refreshCommittee,
    saasOn, claimed, claimPending, setClaim, followed, onFollow, soc,
  } = ctx;
  return (
          <aside className="space-y-4">
            {/* Verified-resident card — the community trust lever */}
            <div className="glass rounded-2xl p-6 reveal" style={{ borderColor: 'rgba(139,92,246,.3)', background: 'linear-gradient(135deg,rgba(139,92,246,.1),rgba(139,92,246,.03))' }}>
              <div className="flex items-center gap-2 mb-2"><Icon name="badge-check" className="w-5 h-5 text-violet-300" /><h3 className="font-bold">{t('society.liveHereTitle')}</h3></div>
              {iAmResident ? (
                <p className="text-violet-200 text-sm flex items-center gap-1.5"><Icon name="check" className="w-4 h-4 flex-shrink-0" /> <span><Trans i18nKey="society.verifiedResidentNote" components={{ 1: <b /> }} /></span></p>
              ) : resStat && resStat.status === 'pending' ? (
                <p className="text-gray-300 text-sm flex items-center gap-1.5"><Icon name="clock" className="w-4 h-4 text-amber-300 flex-shrink-0" /> {t('society.residentPending')}</p>
              ) : (
                <>
                  <p className="text-gray-300 text-sm mb-4"><Trans i18nKey="society.residentPrompt" components={{ 1: <b /> }} />{resStat && resStat.status === 'rejected' ? t('society.residentRejected') : ''}</p>
                  <button onClick={() => (requireLogin() ? (setResStep(1), setResOpen(true)) : null)} className="btn-outline w-full"><Icon name="home" className="w-4 h-4 mr-1.5" /> {t('society.verifyLiveHere')}</button>
                </>
              )}
            </div>

            {/* Residents-only WhatsApp group — the invite is PRIVATE. Ops screen the
                link for scams, but the join URL is shown only to verified residents /
                committee, never published to the public. Non-residents see a
                verify-to-join teaser (no URL leak). */}
            <div className="glass rounded-2xl p-6 reveal" style={{ borderColor: 'rgba(37,211,102,.3)', background: 'linear-gradient(135deg,rgba(37,211,102,.1),rgba(37,211,102,.03))' }}>
              <div className="flex items-center gap-2 mb-2"><Icon name="message-circle" className="w-5 h-5 text-emerald-300" /><h3 className="font-bold">{t('society.waGroupTitle')}</h3></div>
              {wa ? (
                <>
                  <p className="text-gray-300 text-sm mb-4">{t('society.waGroupBody')}</p>
                  <a href={wa.url} target="_blank" rel="noopener noreferrer" className="btn-teal w-full inline-flex items-center justify-center"><Icon name="message-circle" className="w-4 h-4 mr-1.5" /> {t('society.waJoin')}</a>
                  <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1"><Icon name="lock" className="w-3 h-3 flex-shrink-0" /> {t('society.waPrivate')}</p>
                </>
              ) : waRaw && waRaw.status === 'pending' && iAmResidentOrAdmin ? (
                <p className="text-gray-300 text-sm flex items-center gap-1.5"><Icon name="clock" className="w-4 h-4 text-amber-300 flex-shrink-0" /> {t('society.waPending')}<button onClick={openWa} className="text-brand-teal-3 hover:underline ml-1">{t('society.waEdit')}</button></p>
              ) : waExists ? (
                <>
                  <p className="text-gray-300 text-sm mb-4"><Trans i18nKey="society.waExistsBody" components={{ 1: <b /> }} /></p>
                  <button onClick={() => (requireLogin() ? (setResStep(1), setResOpen(true)) : null)} className="btn-outline w-full"><Icon name="home" className="w-4 h-4 mr-1.5" /> {t('society.waVerifyToJoin')}</button>
                </>
              ) : iAmResidentOrAdmin ? (
                <>
                  <p className="text-gray-300 text-sm mb-4">{t('society.waAddBody')}</p>
                  <button onClick={openWa} className="btn-outline w-full"><Icon name="plus" className="w-4 h-4 mr-1.5" /> {t('society.waAddLink')}</button>
                </>
              ) : (
                <p className="text-gray-400 text-sm">{t('society.waNone')}</p>
              )}
            </div>

            {iAmAdmin ? (
              <div className="glass rounded-2xl p-6 reveal" style={{ borderColor: 'rgba(37,99,235,.35)', background: 'linear-gradient(135deg,rgba(37,99,235,.12),rgba(37,99,235,.03))' }}>
                <div className="flex items-center gap-2 mb-1"><Icon name="shield-check" className="w-5 h-5 text-blue-300" /><h3 className="font-bold">{t('society.committeeTitle')}</h3></div>
                <p className="text-gray-400 text-xs mb-3">{t('society.committeeSub')}</p>
                {committee.filter((r) => r.status === 'pending').length === 0 ? (
                  <p className="text-gray-400 text-sm">{t('society.committeeNoPending')}</p>
                ) : (
                  <ul className="space-y-3">
                    {committee.filter((r) => r.status === 'pending').map((r) => (
                      <li key={r.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{r.name}</div>
                            <div className="text-xs text-gray-400">{[r.wing, r.flat].filter(Boolean).join(' · ') || '—'}</div>
                          </div>
                          {r.flagged === 'conflict' ? <span className="tag" style={{ background: 'rgba(220,38,38,.85)', color: '#fff', border: 'none' }}><Icon name="alert-triangle" className="w-3 h-3" /> {t('society.unitTaken')}</span> : null}
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2 text-[11px] text-gray-300">
                          {/* The applicant's own words, and their relation to the flat.
                              These two badges used to read "OTP" and the proof-document type — an
                              `otpVerified` flag and an uploaded file the browser had written next
                              to the request and could therefore assert about itself. Neither ever
                              reached a server, so a reviewer was deciding on evidence that was, in
                              the literal sense, self-certified. What the server does hold is what
                              the applicant typed and who they say they are in the flat. */}
                          {r.relation ? <span className="inline-flex items-center gap-1 rounded bg-violet-500/15 text-violet-200 px-1.5 py-0.5"><Icon name="user-check" className="w-3 h-3" /> {r.relation}</span> : null}
                          {r.note ? <span className="inline-flex items-center gap-1 rounded bg-white/10 text-gray-300 px-1.5 py-0.5 max-w-full truncate"><Icon name="message-square" className="w-3 h-3 flex-shrink-0" /> {r.note}</span> : null}
                        </div>
                        <div className="flex gap-2 mt-2.5">
                          <button onClick={() => refreshCommittee(r, 'verified')} className="btn-teal flex-1 py-1.5 text-xs">{t('society.verify')}</button>
                          <button onClick={() => refreshCommittee(r, 'rejected')} className="btn-outline flex-1 py-1.5 text-xs">{t('society.reject')}</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {saasOn ? (
              <div className="glass rounded-2xl p-6 reveal" style={{ borderColor: 'rgba(13,148,136,.3)', background: 'linear-gradient(135deg,rgba(13,148,136,.1),rgba(20,184,166,.05))' }}>
                <div className="flex items-center gap-2 mb-2"><Icon name="shield" className="w-5 h-5 text-teal-300" /><h3 className="font-bold">{t('society.saasTitle')}</h3></div>
                {claimed ? (
                  <p className="text-teal-100 text-sm flex items-center gap-1.5"><Icon name="shield-check" className="w-4 h-4 flex-shrink-0" /> <span><Trans i18nKey={iAmAdmin ? 'society.saasManagedAdmin' : 'society.saasManaged'} components={{ 1: <b /> }} /></span></p>
                ) : claimPending ? (
                  <p className="text-gray-300 text-sm flex items-center gap-1.5"><Icon name="clock" className="w-4 h-4 text-amber-300 flex-shrink-0" /> <span><Trans i18nKey="society.saasPending" components={{ 1: <b /> }} /></span></p>
                ) : (
                  <>
                    <p className="text-gray-300 text-sm mb-4"><Trans i18nKey="society.saasPitch" components={{ 1: <b /> }} /></p>
                    <button onClick={() => setClaim(true)} className="btn-teal w-full"><Icon name="building" className="w-4 h-4 mr-1.5" /> {t('society.saasClaim')}</button>
                    <p className="text-gray-500 text-[11px] mt-2 text-center">{t('society.saasFree50')}</p>
                  </>
                )}
              </div>
            ) : null}
            <div className={'glass rounded-2xl p-6 reveal' + (followed ? ' ' : '')}>
              <h3 className="font-bold mb-2 flex items-center gap-2"><Icon name="bell" className="w-4 h-4 text-teal-400" /> {t('society.stayUpdated')}</h3>
              <p className="text-gray-400 text-sm mb-3">{t('society.stayUpdatedBody', { name: soc.name })}</p>
              <button onClick={onFollow} className={(followed ? 'btn-teal' : 'btn-outline') + ' w-full'}><Icon name={followed ? 'check' : 'bell'} className="w-4 h-4 mr-1.5" /> {followed ? t('society.following') : t('society.followSociety')}</button>
            </div>
            <div className="glass rounded-2xl p-6 reveal">
              <h3 className="font-bold mb-3 flex items-center gap-2"><Icon name="hand-coins" className="w-4 h-4 text-emerald-400" /> {t('society.whyTitle')}</h3>
              <ul className="space-y-2.5 text-sm text-gray-300">
                <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" /> {t('society.why1')}</li>
                <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" /> {t('society.why2')}</li>
                <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" /> {t('society.why3')}</li>
              </ul>
            </div>
          </aside>
  );
}
