import Icon from '../../../components/Icon.jsx';
import MobileField from '../../../components/MobileField.jsx';
import NativeSelect from '../../../components/ui/NativeSelect.jsx';
import { useTranslation } from 'react-i18next';
import { CATEGORIES, getCatLabel } from '../../../lib/data/support.js';

export default function TicketForm({ form, set, fld, submit }) {
  const { t } = useTranslation();
  return (
    <div className="glass-card rounded-2xl p-6 sm:p-7 reveal">
      <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
        <Icon name="ticket-plus" className="w-5 h-5 text-teal-400" /> {t('misc.tfRaiseNew')}
      </h2>
      <p className="text-gray-500 text-xs mb-5">
        {t('misc.tfReplyNote')}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('misc.tfYourName')} <span className="text-rose-400">*</span>
          </label>
          <input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            type="text"
            placeholder={t('misc.tfYourNamePlaceholder')}
            className={fld}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('misc.tfMobile')} <span className="text-rose-400">*</span>
          </label>
          <MobileField value={form.mobile} onChange={(v) => set('mobile', v)} placeholder={t('misc.tfMobilePlaceholder')} disabled />
          <p className="text-gray-500 text-xs mt-1.5">{t('misc.tfMobileLocked')}</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('misc.tfCategory')} <span className="text-rose-400">*</span>
          </label>
          <NativeSelect value={form.category} onChange={(e) => set('category', e.target.value)} className={fld}>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {getCatLabel(c.key)}
              </option>
            ))}
          </NativeSelect>
        </div>
        {/* A priority picker stood here. Neither `SupportTicket` nor `SupportTicketCreate` carries
            priority, so it set a value nothing transmits and ops would never have seen an "urgent"
            ticket as urgent. Removed rather than disabled — a greyed-out control invites "why
            can't I?", where an absent one asks nothing. */}
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('misc.tfSubject')} <span className="text-rose-400">*</span>
          </label>
          <input
            value={form.subject}
            onChange={(e) => set('subject', e.target.value)}
            maxLength={120}
            type="text"
            placeholder={t('misc.tfSubjectPlaceholder')}
            className={fld}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('misc.tfDescribe')} <span className="text-rose-400">*</span>
          </label>
          <textarea
            value={form.message}
            onChange={(e) => set('message', e.target.value)}
            rows={4}
            placeholder={t('misc.tfDescribePlaceholder')}
            className={fld + ' resize-none'}
          />
        </div>
        {/* An image dropzone stood here. `MessageCreate` is `{ body }`, and the contract states an
            attachment field would be "accepted and dropped rather than stored as a client-supplied
            URL nothing can render". Offering an upload that silently discards the file is worse
            than not offering one. */}
      </div>

      <button
        onClick={submit}
        className="btn-teal w-full mt-5 py-3.5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2"
      >
        <Icon name="send" className="w-4 h-4" /> {t('misc.tfSubmit')}
      </button>
    </div>
  );
}
