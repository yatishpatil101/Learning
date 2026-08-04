import { Link } from 'react-router';
import { Crown, Check, Sparkles, Gift } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';
import { fee } from '../../../lib/store.js';

/* P2 — freemium gate. The free plan includes one live listing; posting another
   needs an owner plan, or a referred owner who posts (one extra free slot each).
   Shown in place of the form when a NEW post is over quota (editing an existing
   listing never hits this). The free referral route disappears when Ops turns
   off the `referralRewards` flag. */
export default function ListingPaywall({ count, limit }) {
  const { t } = useTranslation();
  const { flagEnabled } = useAppFlags();
  const canRefer = flagEnabled('referralRewards');
  return (
    <div className="glass-card rounded-2xl p-6 sm:p-8 text-center" data-testid="listing-paywall">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400/20 to-teal-400/20 border border-amber-400/30 flex items-center justify-center mx-auto mb-5">
        <Crown className="w-7 h-7 text-amber-300" />
      </div>
      <h2 className="text-xl font-bold text-white mb-2">{t('listProperty.paywall.title')}</h2>
      <p className="text-gray-400 text-sm leading-relaxed max-w-md mx-auto mb-1">
        {t('listProperty.paywall.bodyPre')} <strong className="text-gray-200">{limit}</strong> {t('listProperty.paywall.liveListing', { count: limit })} {t('listProperty.paywall.bodyMid')} <strong className="text-gray-200">{count}</strong>.
        {' '}{t(canRefer ? 'listProperty.paywall.bodyEndRefer' : 'listProperty.paywall.bodyEnd')}
      </p>
      <p className="text-gray-500 text-xs mb-6">{t('listProperty.paywall.tip')}</p>

      {/* Free route — refer an owner. Each referred owner who posts unlocks one
          extra free slot. Everything else in the plan stays paid-only. */}
      {canRefer && (
        <>
          <div className="rounded-xl border border-teal-500/30 bg-teal-500/[0.08] p-5 max-w-sm mx-auto text-left mb-4">
            <div className="flex items-center gap-2 mb-1.5">
              <Gift className="w-4 h-4 text-teal-300 flex-shrink-0" />
              <span className="text-sm font-bold text-white">{t('listProperty.paywall.referTitle')}</span>
              <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-emerald-300 px-2 py-0.5 rounded-full bg-emerald-500/15">{t('listProperty.paywall.referFree')}</span>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed mb-3">{t('listProperty.paywall.referBody')}</p>
            <Link to="/refer" data-testid="paywall-refer" className="btn-teal w-full px-4 py-2.5 rounded-xl text-white font-semibold text-sm inline-flex items-center justify-center gap-2">
              <Gift className="w-4 h-4" /> {t('listProperty.paywall.referCta')}
            </Link>
          </div>

          <p className="text-gray-500 text-[11px] uppercase tracking-wider mb-4">{t('listProperty.paywall.orPay')}</p>
        </>
      )}

      <div className="rounded-xl border border-teal-500/25 bg-teal-500/[0.06] p-5 max-w-sm mx-auto text-left mb-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-bold text-white">{t('listProperty.paywall.ownerPlan')}</span>
          <span className="text-teal-300 font-extrabold">{fee('ownerPlanYearly')}<span className="text-gray-500 text-xs font-medium">{t('listProperty.unit.perYr')}</span></span>
        </div>
        <ul className="space-y-2 text-xs text-gray-300">
          {[t('listProperty.paywall.feat1'), t('listProperty.paywall.feat2'), t('listProperty.paywall.feat3')].map((f) => (
            <li key={f} className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" /> {f}</li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link to="/checkout?plan=owner2" className="btn-teal px-6 py-3 rounded-xl text-white font-semibold text-sm inline-flex items-center justify-center gap-2">
          <Sparkles className="w-4 h-4" /> {t('listProperty.paywall.upgradePost')}
        </Link>
        <Link to="/plans" className="btn-outline px-6 py-3 rounded-xl text-gray-300 font-semibold text-sm">
          {t('listProperty.paywall.comparePlans')}
        </Link>
      </div>
    </div>
  );
}
