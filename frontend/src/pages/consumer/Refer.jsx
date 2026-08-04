import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAppFlags } from '../../context/AppFlagsContext.jsx';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import { useEffect, useState } from 'react';
import { referralCode, referralLink, getReferralStats, addReferralInvite, claimReferralCredits, referralListingsTarget, referralFreeAgreements, referralContactsEarned, referralBonusListings, contactsRemaining, listingLimit, activeListingCount, fee } from '../../lib/store.js';

const FEE_RENT_AGREEMENT = fee('rentAgreementPlatform');

export default function Refer() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const { flagEnabled } = useAppFlags();
  // Quota rewards (free contacts / listing slots) are Ops-switchable. The rent
  // agreement track below is part of the base referral program and always runs.
  const quotaRewards = flagEnabled('referralRewards');
  const role = user?.role || null;

  const CODE = referralCode();
  const LINK = referralLink(CODE);
  const L_TARGET = referralListingsTarget;
  const [stats, setStats] = useState(() => getReferralStats());
  const [copied, setCopied] = useState(null); // 'code' | 'link' | null
  const invited = stats.invited || 0, listed = stats.listed || 0, joined = stats.joined || 0;
  const free = referralFreeAgreements();
  const contacts = referralContactsEarned();
  const bonusSlots = referralBonusListings();
  const left = contactsRemaining();
  const slotsLeft = Math.max(0, listingLimit() - activeListingCount());

  // Collect anything friends have earned for us since the last visit so the
  // numbers below are the real, spendable balance.
  useEffect(() => { if (claimReferralCredits()) setStats(getReferralStats()); }, []);

  const shareText = () => t('misc1.referShareMsg', { code: CODE, link: LINK });

  const writeClipboard = async (text) => {
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  };

  // Copying is not an invite — it only inflates a vanity metric. Give inline
  // feedback and leave the invite count to genuine share actions.
  const copyCode = async () => {
    const ok = await writeClipboard(CODE);
    if (ok) { setCopied('code'); setTimeout(() => setCopied((c) => (c === 'code' ? null : c)), 2000); }
    toast(t('misc1.referCodeCopied'), ok ? 'success' : 'error');
  };
  const copyLink = async () => {
    const ok = await writeClipboard(LINK);
    if (ok) { setCopied('link'); setTimeout(() => setCopied((c) => (c === 'link' ? null : c)), 2000); }
    toast(t(ok ? 'misc1.referLinkCopied' : 'misc1.referCodeCopied'), ok ? 'success' : 'error');
  };

  const countInvite = () => { addReferralInvite(); setStats(getReferralStats()); };

  // Native OS share sheet (mobile-first): WhatsApp, SMS, Telegram, email, etc.
  // Only counts as an invite when the user actually completes a share.
  const shareNative = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: t('misc1.referBadge'), text: shareText(), url: LINK });
        countInvite();
      } catch { /* user cancelled — don't count */ }
    } else {
      shareWA();
    }
  };
  const shareWA = () => {
    const msg = encodeURIComponent(shareText());
    countInvite();
    window.open('https://wa.me/?text=' + msg, '_blank', 'noopener');
  };

  const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share;

  return (
    <div className="pt-6 pb-14 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="text-center mb-6">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-amber-300 mb-3" style={{ background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.25)' }}><Icon name="gift" className="w-3.5 h-3.5" /> {t('misc1.referBadge')}</span>
        <h1 className="text-3xl sm:text-4xl font-extrabold">{t('misc1.referTitle')}</h1>
        <p className="text-gray-400 mt-2 max-w-2xl mx-auto">{t('misc1.referSub1')}<b className="text-gray-200">{t('misc1.referSubListHome')}</b>{t('misc1.referSub2')}<b className="text-gray-200">{t('misc1.referSubFindOne')}</b>{t('misc1.referSub3')}</p>
        <div className="flex flex-wrap items-center justify-center gap-2.5 mt-4">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-emerald-200 bg-emerald-500/10 border border-emerald-500/25"><Icon name="file-check-2" className="w-3.5 h-3.5 text-emerald-400" /> {t('misc1.referHookOwner')}</span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-teal-200 bg-teal-500/10 border border-teal-500/25"><Icon name="zap" className="w-3.5 h-3.5 text-teal-400" /> {t('misc1.referHookSeeker')}</span>
        </div>
      </div>

      {/* Share card + How-it-works side by side: fills the horizontal space that
          the old centred, narrow card left empty and cuts vertical scroll. */}
      <div className="grid lg:grid-cols-5 gap-4 sm:gap-5 mb-5 sm:mb-6 items-stretch">
        {/* Referral code / link / share */}
        <section className="glass rounded-2xl p-5 sm:p-6 lg:col-span-3 min-w-0">
          <p className="text-xs text-gray-400 mb-2 uppercase tracking-wider">{t('misc1.referYourCode')}</p>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-white/5 border border-dashed border-teal-400/40 px-3.5 sm:px-4 py-3 mb-3">
            <span className="text-lg sm:text-xl font-extrabold tracking-wider text-teal-300 min-w-0 truncate">{CODE}</span>
            <button onClick={copyCode} aria-label={t('misc1.referCopyCode')} className={`text-sm inline-flex items-center gap-1.5 shrink-0 transition-colors ${copied === 'code' ? 'text-emerald-300' : 'text-gray-300 hover:text-white'}`}>
              <Icon name={copied === 'code' ? 'check' : 'copy'} className="w-4 h-4" /> {copied === 'code' ? t('misc1.referCopied') : t('misc1.referCopy')}
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-2 uppercase tracking-wider">{t('misc1.referYourLink')}</p>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-white/5 border border-white/10 px-3.5 sm:px-4 py-3 mb-3">
            <span className="text-sm text-gray-300 truncate min-w-0" title={LINK}>{LINK}</span>
            <button onClick={copyLink} aria-label={t('misc1.referCopyLink')} className={`text-sm inline-flex items-center gap-1.5 shrink-0 transition-colors ${copied === 'link' ? 'text-emerald-300' : 'text-gray-300 hover:text-white'}`}>
              <Icon name={copied === 'link' ? 'check' : 'copy'} className="w-4 h-4" /> {copied === 'link' ? t('misc1.referCopied') : t('misc1.referCopy')}
            </button>
          </div>
          <div className={`grid grid-cols-1 gap-3 ${canNativeShare ? 'sm:grid-cols-2' : 'sm:grid-cols-1'}`}>
            {canNativeShare && (
              <button onClick={shareNative} className="btn-teal px-4 py-3 rounded-xl font-semibold inline-flex items-center justify-center gap-2">
                <Icon name="share-2" className="w-4 h-4" /> {t('misc1.referShare')}
              </button>
            )}
            <button onClick={shareWA} aria-label={t('misc1.referWhatsApp')} className={`px-4 py-3 rounded-xl font-semibold inline-flex items-center justify-center gap-2 transition-colors ${canNativeShare ? 'border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/10' : 'btn-teal'}`}>
              <Icon name="message-circle" className="w-4 h-4" /> {t('misc1.referWhatsApp')}
            </button>
          </div>
          <p data-testid="refer-invited" className="text-xs text-gray-500 mt-3 text-center">{t('misc1.referInvited', { count: invited })} · {t('misc1.referVerifyNote')}</p>
        </section>

        {/* How it works — stacked vertically to match the card height and use the
            right-hand space instead of a separate full-width row below. */}
        <section className="glass rounded-2xl p-5 sm:p-6 lg:col-span-2 min-w-0">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">{t('misc1.referHowItWorks', 'How it works')}</h2>
          <ol className="space-y-4">
            {[
              { icon: 'send', fg: 'text-teal-400', bg: 'bg-teal-500/15', title: t('misc1.referStep1Title'), body: t('misc1.referStep1Body') },
              { icon: 'users', fg: 'text-teal-400', bg: 'bg-teal-500/15', title: t('misc1.referStep2Title'), body: t('misc1.referStep2Body') },
              { icon: 'gift', fg: 'text-emerald-400', bg: 'bg-emerald-500/15', title: t('misc1.referStep3Title'), body: t('misc1.referStep3Body') },
            ].map((s, i) => (
              <li key={s.icon} className="flex gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${s.bg}`}><Icon name={s.icon} className={`w-[18px] h-[18px] ${s.fg}`} /></div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm leading-snug"><span className="text-gray-500 mr-1">{i + 1}.</span>{s.title}</p>
                  <p className="text-gray-400 text-xs mt-0.5 leading-relaxed">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className="mb-5 sm:mb-6">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4 flex items-center gap-2"><Icon name="sparkles" className="w-4 h-4 text-teal-400" /> {t('misc1.referYourRewards')}</h2>

        {/* Live, spendable balance — what the referrals have actually unlocked. */}
        {quotaRewards && (
          <div className="grid sm:grid-cols-2 gap-3 sm:gap-4 mb-4 sm:mb-5" data-testid="refer-balance">
            <div className="glass rounded-2xl px-5 py-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center shrink-0"><Icon name="phone-call" className="w-[18px] h-[18px] text-teal-400" /></div>
              <div className="min-w-0">
                <p className="text-xl font-extrabold text-teal-300" data-testid="refer-balance-contacts">{Number.isFinite(left) ? left : '∞'}</p>
                <p className="text-gray-500 text-[11px]">{t('misc1.referBalanceContacts')}</p>
              </div>
            </div>
            <div className="glass rounded-2xl px-5 py-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0"><Icon name="home" className="w-[18px] h-[18px] text-emerald-400" /></div>
              <div className="min-w-0">
                <p className="text-xl font-extrabold text-emerald-300" data-testid="refer-balance-slots">{slotsLeft}</p>
                <p className="text-gray-500 text-[11px]">{t('misc1.referBalanceSlots', { count: bonusSlots })}</p>
              </div>
            </div>
          </div>
        )}

        <div className={`grid gap-4 sm:gap-5 items-stretch ${quotaRewards ? 'md:grid-cols-2' : ''}`}>
          {/* Owner track */}
          <div className="glass rounded-2xl p-5 sm:p-6 relative flex flex-col">
            {role === 'owner' && <span className="absolute top-4 right-4 text-[10px] font-bold uppercase tracking-wider text-teal-300 px-2 py-0.5 rounded-full bg-teal-500/15">{t('misc1.referForYou')}</span>}
            <div className="w-11 h-11 rounded-xl bg-teal-500/15 flex items-center justify-center mb-3"><Icon name="file-check-2" className="w-5 h-5 text-teal-400" /></div>
            <h3 className="text-lg font-extrabold">{t('misc1.referListHomeTitle')}</h3>
            {quotaRewards && <p className="text-teal-300 text-sm font-medium mt-0.5 mb-3">{t('misc1.referOwnerSlotTrack')}</p>}
            <p className="text-gray-400 text-xs mb-4">{t('misc1.referOwnerTrackPre')}<b className="text-gray-200">{t('misc1.referFreeRentAgreement')}</b>{t('misc1.referOwnerTrackPost', { fee: FEE_RENT_AGREEMENT })}</p>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400">{t('misc1.referProgressLabel')}</span>
              <span className="text-xs font-bold text-teal-300">{listed % L_TARGET} / {L_TARGET}</span>
            </div>
            <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: Math.round(((listed % L_TARGET) / L_TARGET) * 100) + '%', background: 'linear-gradient(90deg,#0d9488,#14b8a6)' }} />
            </div>
            <p className="text-xs text-gray-500 mt-2">{listed === 0 ? t('misc1.referProgress0') : listed % L_TARGET === 0 ? t('misc1.referProgressNice', { count: listed }) : t('misc1.referProgressMore', { count: L_TARGET - (listed % L_TARGET) })}</p>
            {free > 0 && (
              <div className="mt-3 rounded-lg px-3 py-2 flex items-center gap-2 text-xs text-emerald-200" style={{ background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.3)' }}>
                <Icon name="party-popper" className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span><b>{free}</b> {t('misc1.referFreeAgreementsUnlocked', { count: free })}</span>
              </div>
            )}
            <div className="mt-4 pt-4 border-t border-white/5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">{t('misc1.referPerksLabel')}</p>
              <ul className="space-y-1.5">
                {[t('misc1.referOwnerPerk1'), t('misc1.referOwnerPerk2'), t('misc1.referOwnerPerk3')].map((perk) => (
                  <li key={perk} className="flex items-center gap-2 text-xs text-gray-300"><Icon name="check" className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" /> {perk}</li>
                ))}
              </ul>
            </div>
            <div className="flex gap-6 mt-auto pt-4">
              <div><p className="text-xl font-extrabold text-white">{listed}</p><p className="text-gray-500 text-[11px]">{t('misc1.referFriendsListed')}</p></div>
              <div><p className="text-xl font-extrabold text-emerald-300">{free}</p><p className="text-gray-500 text-[11px]">{t('misc1.referFreeAgreementsStat')}</p></div>
            </div>
          </div>

          {/* Seeker track — pure contact-quota reward, so it goes when Ops does. */}
          {quotaRewards && (
          <div className="glass rounded-2xl p-5 sm:p-6 relative flex flex-col" data-testid="refer-seeker-track">
            {role && role !== 'owner' && <span className="absolute top-4 right-4 text-[10px] font-bold uppercase tracking-wider text-teal-300 px-2 py-0.5 rounded-full bg-teal-500/15">{t('misc1.referForYou')}</span>}
            <div className="w-11 h-11 rounded-xl bg-teal-500/15 flex items-center justify-center mb-3"><Icon name="phone-call" className="w-5 h-5 text-teal-400" /></div>
            <h3 className="text-lg font-extrabold">{t('misc1.referJoinSearchTitle')}</h3>
            <p className="text-teal-300 text-sm font-medium mt-0.5 mb-4">{t('misc1.referSeekerTrackPre')}<b>{t('misc1.referPlus15Contacts')}</b>{t('misc1.referSeekerTrackPost')}</p>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400">{t('misc1.referRewardRate')}</span>
              <span className="text-xs font-bold text-teal-300">{t('misc1.referPlus15Contacts')}</span>
            </div>
            <div className="rounded-lg bg-teal-500/10 border border-teal-500/25 px-3 py-2.5 text-xs text-teal-200 flex items-center gap-2"><Icon name="zap" className="w-4 h-4 text-teal-400 flex-shrink-0" /> {t('misc1.referSeekerInstant')}</div>
            {contacts > 0 && (
              <div className="mt-3 rounded-lg px-3 py-2 flex items-center gap-2 text-xs text-teal-200 bg-teal-500/10 border border-teal-500/25">
                <Icon name="party-popper" className="w-4 h-4 text-teal-300 flex-shrink-0" />
                <span><b>{contacts}</b> {t('misc1.referBonusContactsUnlocked')}</span>
              </div>
            )}
            <div className="mt-4 pt-4 border-t border-white/5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">{t('misc1.referPerksLabel')}</p>
              <ul className="space-y-1.5">
                {[t('misc1.referSeekerPerk1'), t('misc1.referSeekerPerk2'), t('misc1.referSeekerPerk3')].map((perk) => (
                  <li key={perk} className="flex items-center gap-2 text-xs text-gray-300"><Icon name="check" className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" /> {perk}</li>
                ))}
              </ul>
            </div>
            <div className="flex gap-6 mt-auto pt-4">
              <div><p className="text-xl font-extrabold text-white">{joined}</p><p className="text-gray-500 text-[11px]">{t('misc1.referFriendsJoined')}</p></div>
              <div><p className="text-xl font-extrabold text-teal-300">{contacts}</p><p className="text-gray-500 text-[11px]">{t('misc1.referContactsEarned')}</p></div>
            </div>
          </div>
          )}
        </div>
      </section>

      {/* Move-in guarantee */}
      <section className="glass rounded-2xl p-5 sm:p-7" style={{ borderColor: 'rgba(16,185,129,.3)', background: 'linear-gradient(135deg,rgba(16,185,129,.08),rgba(20,184,166,.05))' }}>
        <div className="flex flex-col sm:flex-row items-start gap-5">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 flex items-center justify-center flex-shrink-0"><Icon name="shield-check" className="w-7 h-7 text-emerald-400" /></div>
          <div>
            <h2 className="text-xl font-bold mb-1">{t('misc1.referGuaranteeTitle')}</h2>
            <p className="text-gray-300 text-sm leading-relaxed mb-3">{t('misc1.referGuaranteeBody1')}<b>{t('misc1.referVerified')}</b>{t('misc1.referGuaranteeBody2')}<b>{t('misc1.referNextAgreementFree')}</b>{t('misc1.referGuaranteeBody3')}</p>
            <div className="flex flex-wrap gap-2">
              <span className="text-xs px-3 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">{t('misc1.referTagVerifiedOnly')}</span>
              <span className="text-xs px-3 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">{t('misc1.referTagReport7Days')}</span>
              <span className="text-xs px-3 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">{t('misc1.referTagNoQuestions')}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
