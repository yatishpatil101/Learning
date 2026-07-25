import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';

export default function StepWitnesses({ step, wit, setWit }) {
  const { t } = useTranslation();
  return (
    <div className={'step-panel' + (step === 4 ? ' active' : '')}>
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-xl font-bold text-white">{t('services.ra.witnesses.title')}</h2>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-teal-300 bg-teal-400/12 border border-teal-400/25 rounded-full px-2 py-0.5">{t('services.ra.witnesses.optional')}</span>
      </div>
      <p className="text-gray-500 text-sm mb-4">{t('services.ra.witnesses.subtitle')}</p>
      <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl p-3.5 flex items-start gap-2.5 mb-6">
        <Icon name="fingerprint" className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
        <p className="text-amber-100/90 text-xs leading-relaxed">{t('services.ra.witnesses.biometricNote')}</p>
      </div>
      <div className="space-y-5">
        {[1, 2].map((n) => (
          <div key={n} className="bg-white/4 border border-white/8 rounded-xl p-4">
            <p className="text-white font-semibold text-sm mb-3">{t('services.ra.witnesses.witness', { n })}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="lbl">{t('services.ra.witnesses.fullName')}</label><input value={wit['w' + n + 'Name']} onChange={(e) => setWit((p) => ({ ...p, ['w' + n + 'Name']: e.target.value }))} className="field w-full px-4 py-3 rounded-xl text-white text-sm" /></div>
              <div><label className="lbl">{t('services.ra.witnesses.address')}</label><input value={wit['w' + n + 'Addr']} onChange={(e) => setWit((p) => ({ ...p, ['w' + n + 'Addr']: e.target.value }))} className="field w-full px-4 py-3 rounded-xl text-white text-sm" /></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
