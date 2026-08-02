import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';

export default function MarketPulseCard({ pulse }) {
  const { t } = useTranslation();
  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6 reveal">
      <h2 className="text-lg font-bold text-white mb-4">{t('locality.pulseTitle')}</h2>
      <div className="grid grid-cols-2 gap-4">
        {pulse.map(([k, v, ic, c]) => (
          <div key={k} className="bg-white/4 border border-white/8 rounded-xl p-3"><div className="flex items-center gap-2 mb-1.5"><Icon name={ic} className={'w-4 h-4 ' + c} /><span className="text-gray-500 text-[11px]">{t(k)}</span></div><p className="text-white font-semibold text-sm">{typeof v === 'string' ? t(v) : t(v.key, v.args)}</p></div>
        ))}
      </div>
    </div>
  );
}
