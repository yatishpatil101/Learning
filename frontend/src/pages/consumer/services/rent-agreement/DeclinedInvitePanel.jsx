import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import { digits } from './helpers.js';

export default function DeclinedInvitePanel({ stalled, onRecover, busy }) {
  const { t } = useTranslation();
  const [mobile, setMobile] = useState('');
  const [confirming, setConfirming] = useState(false);
  const valid = /^[6-9]\d{9}$/.test(mobile);
  const side = { context: stalled.role === 'owner' ? 'owner' : undefined };
  return (
    <div className="mt-5 p-4 rounded-xl bg-amber-500/8 border border-amber-500/25 max-w-md mx-auto text-left" data-testid="ra-declined-panel">
      <p className="text-white font-semibold text-sm flex items-center gap-2">
        <Icon name="alert-triangle" className="w-4 h-4 text-amber-300" />
        {t(stalled.declined ? 'services.ra.declined.title' : 'services.ra.declined.noTenantTitle', side)}
      </p>
      <p className="text-gray-400 text-xs mt-1 leading-relaxed">{t('services.ra.declined.desc', side)}</p>
      <label className="lbl mt-3" htmlFor="ra-reinvite-mobile">{t('services.ra.declined.mobileLabel', side)}</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input id="ra-reinvite-mobile" inputMode="numeric" maxLength={10} value={mobile} onChange={(e) => setMobile(digits(e.target.value))}
          className="field flex-1 px-4 py-3 rounded-xl text-white text-sm" placeholder={t('services.ra.declined.mobilePlaceholder')} />
        <button type="button" disabled={!valid || busy} onClick={() => onRecover('reinvite', mobile)}
          className="btn-teal px-4 py-3 rounded-xl text-white text-sm font-semibold inline-flex items-center justify-center gap-2 min-h-[44px] disabled:opacity-50">
          <Icon name="user-plus" className="w-4 h-4" /> {t('services.ra.declined.reinvite')}
        </button>
      </div>
      <button type="button" disabled={busy} onClick={() => (confirming ? onRecover('cancel') : setConfirming(true))}
        className="mt-3 text-gray-500 hover:text-gray-300 disabled:opacity-50 text-[11px] font-semibold underline underline-offset-2">
        {t(confirming ? 'services.ra.declined.cancelConfirm' : 'services.ra.declined.cancel')}
      </button>
    </div>
  );
}
