import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';

export default function ConnectivityCard({ conn }) {
  const { t } = useTranslation();
  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6 reveal">
      <h2 className="text-lg font-bold text-white mb-3">{t('locality.connTitle')}</h2>
      <div className="space-y-1">
        {conn.map(([k, ic, d]) => (
          <div key={k} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0"><span className="flex items-center gap-3 text-sm text-gray-300"><Icon name={ic} className="w-4 h-4 text-teal-400" /> {k}</span><span className="text-gray-500 text-xs font-medium">{d}</span></div>
        ))}
      </div>
    </div>
  );
}
