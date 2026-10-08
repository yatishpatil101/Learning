import { Zap, ShieldCheck, ArrowRight, Clock, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/* Counts come from `changes.instant` / `changes.recheck`, not tierA/tierB, because the server re-moderates across both tiers;
   only `changes.remoderation` takes the listing off search. */
export default function EditPolicyBanner({ approved, changes }) {
  const { t } = useTranslation();
  const recheck = changes?.recheck || [];
  const instant = changes?.instant || [];
  const offSearch = (changes?.remoderation || []).length > 0;
  const staysLive = !offSearch && (changes?.staysLive || []).length > 0;
  const hasChanges = recheck.length > 0 || instant.length > 0;

  return (
    <div className="mb-6">
      <div className="grid sm:grid-cols-2 gap-3">
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
              {/* The middle state is offline whenever re-moderation is touched, but don't imply a blackout
                  when the listing stays in search. */}
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
