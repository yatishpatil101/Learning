import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAppFlags } from '../../context/AppFlagsContext.jsx';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import { useEffect, useState, useCallback } from 'react';
import { referralListingsTarget } from '../../lib/referralConfig.js';
import { loadListingQuota } from '../../lib/data/listingQuota.js';
import { getEntitlements } from '../../services/entitlementService.js';
import { getDealFees } from '../../services/feesService.js';
import { getMyReferralSummary, referralLink } from '../../services/referralService.js';
import { usePricing } from '../../context/PricingContext.jsx';

const rupees = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

export default function Refer() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const { fee } = usePricing();
  const { flagEnabled } = useAppFlags();
  // Quota rewards (free contacts / listing slots) are Ops-switchable. The rent
  // agreement track below is part of the base referral program and always runs.
  const quotaRewards = flagEnabled('referralRewards');
  const role = user?.role || null;

  /**
   * The code, and the count of people who used it, both come from the server now.
   *
   * This used to be `const CODE = referralCode()` — a synchronous read of a string the *browser*
   * minted: four letters of the user's name and the last four digits of their mobile, kept under
   * `pnReferralCode:<mobile>` in localStorage. The server mints `PUNE-AB12` in `referral_codes`
   * (V23), permanent by design because "rotating it would break every card and forwarded message
   * already carrying the old one". Two codes for one user is one too many, and the browser's was
   * the one `POST /referrals/redeem` could not resolve — so every link this page has ever produced
   * pointed at a scheme that could not recognise it.
   *
   * `invited` moves with it, and the meaning tightens. Locally it counted *completed shares*, which
   * is a number about this browser's owner rather than about anybody they reached. The server's
   * counts redemptions. The copy under it — "You've invited N" — was only ever true of the second.
   *
   * The **contact and listing balances** are the server's too now (D31b). They used to be read
   * straight out of the same localStorage counters this page incremented, which meant the page
   * that advertised the reward was also the page that granted it. `GET /me/entitlements` derives
   * the bonus from the referrals that justify it every time it is asked, so a clawed-back referral
   * takes its contacts back with it and no counter has to be un-incremented by hand.
   *
   * The *progress* narrative moved with them (D234). `listed` and `joined` were localStorage
   * counters drained from a browser-side credit ledger, and `referralFreeAgreements()` divided one
   * of them by three — so the free-agreement perk survived a clawback, and could be minted by
   * clearing site data and referring the same friend again. `converted` and `invited` come off the
   * same summary as the code, and `agreements.free` off the same entitlements call as the contact
   * and listing bonuses. Nothing on this page is now both the advertisement and the grant.
   *
   * Nothing renders until the summary resolves. The alternative is a page that shows a blank code
   * for a tick and a Copy button that puts an empty string on the clipboard, which is the quiet
   * kind of wrong: the user gets feedback saying "Copied".
   */
  const [summary, setSummary] = useState(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const reloadSummary = useCallback(() => {
    let alive = true;
    getMyReferralSummary()
      .then((s) => { if (alive && s) { setSummary(s); setSummaryFailed(false); } })
      .catch(() => { if (alive) setSummaryFailed(true); });
    return () => { alive = false; };
  }, []);
  useEffect(() => reloadSummary(), [reloadSummary]);

  const CODE = summary?.code || '';
  /* Built from the summary's code, never from a default. `referralLink` moved out of the store with
     this line: its old signature defaulted the argument to the browser-minted code, so the page
     could show the server's code and share a link carrying the other one. It now takes the code and
     returns '' for a blank one, which is what this expression used to guard by hand. */
  const LINK = referralLink(CODE);
  const L_TARGET = referralListingsTarget;
  const [copied, setCopied] = useState(null); // 'code' | 'link' | null
  /* The progress narrative, from the server. `listed` used to be a localStorage counter drained
     from a browser-side credit ledger; it is now `converted` — referrals the server has actually
     qualified or approved, which is the same set `GET /me/entitlements` derives every bonus on this
     page from. The two can no longer disagree, because there is only one of them. `joined` is
     `invited`, people who have redeemed the code, for the same reason. */
  const invited = summary?.invited || 0;
  const listed = summary?.converted || 0;
  const joined = invited;

  /* Balances, from whoever is serving. `null` until the answer lands — rendered as an em dash
     rather than as 0, because "you have 0 contacts left" and "we have not asked yet" are different
     sentences and only one of them should send a user to the checkout. */
  const [ent, setEnt] = useState(null);
  useEffect(() => {
    let alive = true;
    getEntitlements()
      .then((e) => { if (alive) setEnt(e); })
      .catch(() => { if (alive) setEnt(null); });
    return () => { alive = false; };
  }, []);
  const contacts = ent?.contacts?.referralBonus ?? 0;
  /* Free rent agreements earned, from the server. This was `referralFreeAgreements()`, a local
     division of a local counter — so it survived a clawback and could be minted by clearing site
     data and starting again. `agreements.free` is derived on every request from the qualified
     referrals that justify it. */
  const free = ent?.agreements?.free ?? 0;
  const bonusSlots = ent?.listings?.referralBonus ?? 0;
  const left = ent?.contacts?.unlimited ? null : (ent?.contacts?.remaining ?? null);
  /* Listing slots left, both halves from the server. This used to subtract `activeListingCount()`
     — a count of the listings *this browser* had posted — from `listingLimit(planLimit)`, which
     added the referral bonus a second time on top of the allowance that already contained it. An
     owner who had posted from another device was told they had their whole ceiling free. */
  const [quota, setQuota] = useState(null);
  useEffect(() => {
    let alive = true;
    loadListingQuota(user).then((q) => { if (alive) setQuota(q); });
    return () => { alive = false; };
  }, [user]);
  const slotsLeft = quota?.allowance == null ? null : Math.max(0, quota.allowance - quota.used);

  // The reward this page advertises is a free rent agreement, so the figure it quotes has to be the
  // one the wizard will actually charge. Same `GET /fees` row the sidebar and the checkout read.
  // A null `platformFee` means unpublished rather than free, so it is left on the fallback.
  const [rentPlatformFee, setRentPlatformFee] = useState(null);
  useEffect(() => {
    let alive = true;
    getDealFees('rent')
      .then((row) => { if (alive && row && row.platformFee != null) setRentPlatformFee(row.platformFee); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  /**
   * The published fee for this deal, or the configured schedule's figure until it resolves.
   *
   * The fallback used to be a module-scope `fee('rentAgreementPlatform')` evaluated once at import,
   * and two things were wrong with that. It read a back-office document no signed-out visitor has,
   * so live it always returned the constant compiled into the bundle. And being module-scope it
   * could not have been corrected by any later fetch even had one existed — the value was frozen
   * the first time this file was imported, which is exactly how it came to promise a ₹500 saving
   * against a ₹1,999 charge. Reading it through `usePricing()` fixes both: the number now comes
   * from the server, and it re-renders when it arrives.
   *
   * It stays a fallback rather than becoming the answer for the reason `Plans.jsx` keeps one — a
   * page whose whole job is persuasion has to render something.
   */
  const FEE_RENT_AGREEMENT = rentPlatformFee == null ? fee('rentAgreementPlatform') : rupees(rentPlatformFee);

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

  /* A completed share used to bump a local `invited` counter as well as re-reading the server's.
     It no longer does. That counter incremented every time somebody pressed Share — it was a count
     of button presses wearing the name of a count of people, and it drifted further from the
     server's every time the page was used. `GET /me/referrals` counts codes actually redeemed,
     which is the honest answer to "how many people have you invited", so this just asks again. */
  const countInvite = () => { reloadSummary(); };

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
          {!CODE ? (
            /* Not a spinner for its own sake: every control in this card is a function of the code,
               so rendering them before it arrives means a Copy button that writes "" and then says
               "Copied". The failure branch says what failed rather than showing an empty card, and
               offers the retry, because a referral scheme that silently has no code looks to the
               user like a scheme they are not in. */
            <div className="py-10 text-center">
              {summaryFailed ? (
                <>
                  <p className="text-sm text-gray-400">{t('misc1.referCodeUnavailable', 'We could not load your referral code just now.')}</p>
                  <button onClick={reloadSummary} className="btn-outline mt-3 px-4 py-2 rounded-xl text-sm font-semibold">{t('common.retry', 'Try again')}</button>
                </>
              ) : (
                <p className="text-sm text-gray-500">{t('common.loading', 'Loading…')}</p>
              )}
            </div>
          ) : (
          <>
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
          </>
          )}
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
                <p className="text-xl font-extrabold text-teal-300" data-testid="refer-balance-contacts">{ent == null ? '—' : (ent.contacts?.unlimited ? '∞' : left)}</p>
                <p className="text-gray-500 text-[11px]">{t('misc1.referBalanceContacts')}</p>
              </div>
            </div>
            <div className="glass rounded-2xl px-5 py-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0"><Icon name="home" className="w-[18px] h-[18px] text-emerald-400" /></div>
              <div className="min-w-0">
                <p className="text-xl font-extrabold text-emerald-300" data-testid="refer-balance-slots">{slotsLeft == null ? '—' : slotsLeft}</p>
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
