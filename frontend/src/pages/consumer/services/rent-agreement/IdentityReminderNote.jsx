import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';

export default function IdentityReminderNote({ fields }) {
  const { t } = useTranslation();
  if (!fields?.length) return null;
  return (
    <div data-testid="ra-identity-reminder" className="mb-5 rounded-xl border border-amber-500/25 bg-amber-500/8 p-3.5 flex items-start gap-2.5">
      <Icon name="shield-alert" className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-amber-100/90 text-xs leading-relaxed">{t('services.ra.identityReminder.note')}</p>
        <p className="text-amber-50 text-xs font-semibold mt-1">{t('services.ra.identityReminder.reEnter', { fields: fields.join(', ') })}</p>
      </div>
    </div>
  );
}
