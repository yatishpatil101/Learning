import { Info, Zap, ShieldCheck, ArrowRight, Clock, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/* P1 — owner-facing transparency while editing a LIVE listing.
   Explains the two edit tiers and, once the owner starts changing things, shows
   a running summary of what publishes instantly vs what needs a re-check.

   The counts come from `changes.instant` / `changes.recheck`, not from tierB/tierA
   directly: the server re-moderates on a set that cuts across both tiers (see
   FOUNDATION_FORM_KEYS in editPolicy.js), and this banner used to promise that a
   price or furnishing edit "goes live now" when it actually took the listing out of
   search until a moderator re-approved it (D76).

   Since Q14 a re-check has two prices, and the banner has to say which one the owner
   is paying. `changes.remoderation` is the half that genuinely goes dark;
   `changes.staysLive` is re-checked in the background with the listing still in
   search. Saying "off search" for the second would be the same lie in the other
   direction — and the one that stops owners keeping their price honest. */
export default function EditPolicyBanner({ approved, changes }) {
  const { t } = useTranslation();
  const recheck = changes?.recheck || [];
  const instant = changes?.instant || [];
  const offSearch = (changes?.remoderation || []).length > 0;
  const staysLive = !offSearch && (changes?.staysLive || []).length > 0;
  const hasChanges = recheck.length > 0 || instant.length > 0;

  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6 mb-6 border border-white/10">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-indigo-400/15 flex items-center justify-center flex-shrink-0">
          <Info className="w-5 h-5 text-indigo-300" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-white">
            {approved ? t('listProperty.editPolicy.editingLiveTitle') : t('listProperty.editPolicy.editingTitle')}
          </h2>
          <p className="text-gray-400 text-xs mt-0.5 leading-relaxed">
            {approved
              ? t('listProperty.editPolicy.liveBody')
              : t('listProperty.editPolicy.reviewBody')}
          </p>
        </div>
      </div>

      {/* Tier legend */}
      <div className="grid sm:grid-cols-2 gap-3 mt-4">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3">
          <div className="flex items-center gap-1.5 text-emerald-300 text-xs font-semibold mb-1">
            <Zap className="w-3.5 h-3.5" /> {t('listProperty.editPolicy.publishInstantly')}
          </div>
          <p className="text-[11px] text-gray-400 leading-relaxed">{t('listProperty.editPolicy.publishInstantlyDesc')}</p>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3">
          <div className="flex items-center gap-1.5 text-amber-300 text-xs font-semibold mb-1">
            <ShieldCheck className="w-3.5 h-3.5" /> {t('listProperty.editPolicy.needsRecheck')}
          </div>
          <p className="text-[11px] text-gray-400 leading-relaxed">{t('listProperty.editPolicy.needsRecheckDesc')}</p>
        </div>
      </div>

      {/* Live summary of the current edit */}
      {hasChanges && (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            {instant.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-emerald-300 font-semibold">
                <Zap className="w-3.5 h-3.5" /> {t('listProperty.editPolicy.updatesGoLive', { count: instant.length })}
              </span>
            )}
            {recheck.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-amber-300 font-semibold">
                <ShieldCheck className="w-3.5 h-3.5" /> {t('listProperty.editPolicy.changesRecheck', { count: recheck.length })}
              </span>
            )}
          </div>

          {approved && recheck.length > 0 && (
            <>
              <p className="text-[11px] text-gray-400 mt-2">
                {t('listProperty.editPolicy.rechecking')} <span className="text-gray-200">{recheck.map((c) => c.label).join(', ')}</span>
              </p>
              {offSearch && (
                <p className="text-[11px] text-amber-300/90 mt-1.5">{t('listProperty.editPolicy.offSearchNote')}</p>
              )}
              {staysLive && (
                <p className="text-[11px] text-emerald-300/90 mt-1.5">{t('listProperty.editPolicy.staysLiveNote')}</p>
              )}
              {/* Status timeline. The middle state is genuinely offline whenever the
                  server's re-moderation set is touched, so say so rather than
                  reassuring the owner that nothing goes down — and equally, do not
                  imply a blackout when the listing in fact stays in search. */}
              <div className="flex items-center gap-2 mt-3 text-[10px] font-semibold">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300"><CheckCircle2 className="w-3 h-3" /> {t('listProperty.editPolicy.live')}</span>
                <ArrowRight className="w-3 h-3 text-gray-600" />
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${offSearch ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}><Clock className="w-3 h-3" /> {offSearch ? t('listProperty.editPolicy.underReviewOffSearch') : t('listProperty.editPolicy.underReviewStaysLive')}</span>
                <ArrowRight className="w-3 h-3 text-gray-600" />
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300"><CheckCircle2 className="w-3 h-3" /> {t('listProperty.editPolicy.live')}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
