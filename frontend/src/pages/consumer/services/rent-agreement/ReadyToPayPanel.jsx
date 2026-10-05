import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import { fmt } from './helpers.js';

export default function ReadyToPayPanel({ request, onPay, busy, unconfirmed }) {
  const { t } = useTranslation();
  // Asked again here: a co-filled deed carries the other side's answers, which the review-step tick never covered.
  const coFilled = (request.parties || []).find((p) => p.status === 'accepted');
  const [declare, setDeclare] = useState(false);
  return (
    <div className="mt-5 p-4 rounded-xl bg-teal-500/8 border border-teal-500/25 max-w-md mx-auto text-left" data-testid="ra-pay-panel">
      <p className="text-white font-semibold text-sm flex items-center gap-2">
        <Icon name="credit-card" className="w-4 h-4 text-teal-300" />
        {t(unconfirmed ? 'services.ra.donePaymentPendingTitle' : coFilled ? 'services.ra.pay.coFilledTitle' : 'services.ra.pay.title', { context: coFilled?.role === 'owner' ? 'owner' : undefined })}
      </p>
      <p className="text-gray-400 text-xs mt-1 leading-relaxed">
        {t(unconfirmed ? 'services.ra.donePaymentPendingDesc' : 'services.ra.pay.desc')}
      </p>
      <label className="flex items-start gap-2.5 mt-3 cursor-pointer">
        <input type="checkbox" checked={declare} onChange={(e) => setDeclare(e.target.checked)} className="accent-teal-500 w-4 h-4 mt-0.5" />
        <span className="text-xs text-gray-400">{t('services.ra.review.declaration')}</span>
      </label>
      <button type="button" disabled={busy || !declare} onClick={onPay}
        className="btn-teal mt-3 w-full px-4 py-3 rounded-xl text-white text-sm font-semibold inline-flex items-center justify-center gap-2 min-h-[44px] disabled:opacity-50">
        <Icon name="credit-card" className="w-4 h-4" />
        {unconfirmed ? t('services.ra.donePaymentPendingCta') : t('services.ra.pay.cta', { amount: fmt(request.amount) })}
      </button>
    </div>
  );
}
