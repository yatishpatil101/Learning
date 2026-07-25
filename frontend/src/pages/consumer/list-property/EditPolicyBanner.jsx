import { Info, Zap, ShieldCheck, ArrowRight, Clock, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/* P1 — owner-facing transparency while editing a LIVE listing.
   Explains the two edit tiers and, once the owner starts changing things, shows
   a running summary of what publishes instantly vs what triggers a quick
   re-check (with the reassurance that the listing stays live throughout). */
export default function EditPolicyBanner({ approved, changes }) {
  const { t } = useTranslation();
  const tierA = changes?.tierA || [];
  const tierB = changes?.tierB || [];
  const hasChanges = tierA.length > 0 || tierB.length > 0;

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
            {tierB.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-emerald-300 font-semibold">
                <Zap className="w-3.5 h-3.5" /> {t('listProperty.editPolicy.updatesGoLive', { count: tierB.length })}
              </span>
            )}
            {tierA.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-amber-300 font-semibold">
                <ShieldCheck className="w-3.5 h-3.5" /> {t('listProperty.editPolicy.changesRecheck', { count: tierA.length })}
              </span>
            )}
          </div>

          {approved && tierA.length > 0 && (
            <>
              <p className="text-[11px] text-gray-400 mt-2">
                {t('listProperty.editPolicy.rechecking')} <span className="text-gray-200">{tierA.map((c) => c.label).join(', ')}</span>
              </p>
              {/* Status timeline — reassures the owner nothing goes offline. */}
              <div className="flex items-center gap-2 mt-3 text-[10px] font-semibold">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300"><CheckCircle2 className="w-3 h-3" /> {t('listProperty.editPolicy.live')}</span>
                <ArrowRight className="w-3 h-3 text-gray-600" />
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300"><Clock className="w-3 h-3" /> {t('listProperty.editPolicy.updateUnderReview')}</span>
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
