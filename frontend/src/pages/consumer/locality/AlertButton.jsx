import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';

export default function AlertButton({ activeName, onClick }) {
  const { t } = useTranslation();
  return (
    <button type="button" onClick={onClick} className="px-5 py-3 rounded-xl text-gray-200 text-sm font-semibold border border-white/10 hover:bg-white/5 hover:border-teal-400/30 inline-flex items-center gap-2 transition-all">
      <Icon name="bell" className="w-4 h-4 text-teal-400" /> {t('locality.alertBtn', { name: activeName })}
    </button>
  );
}
