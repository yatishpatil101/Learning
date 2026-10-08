import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';

export default function SocietySidebar({ ctx }) {
  const { t } = useTranslation();
  const { followed, onFollow, soc } = ctx;
  return (
    <aside className="space-y-4">
      {soc._generic ? null : (
        <div className="glass rounded-2xl p-6 reveal">
          <h3 className="font-bold mb-2 flex items-center gap-2"><Icon name="bell" className="w-4 h-4 text-teal-400" /> {t('society.stayUpdated')}</h3>
          <p className="text-gray-400 text-sm mb-3">{t('society.stayUpdatedBody', { name: soc.name })}</p>
          <button onClick={onFollow} className={(followed ? 'btn-teal' : 'btn-outline') + ' w-full'}><Icon name={followed ? 'check' : 'bell'} className="w-4 h-4 mr-1.5" /> {followed ? t('society.following') : t('society.followSociety')}</button>
        </div>
      )}
      <div className="glass rounded-2xl p-6 reveal">
        <h3 className="font-bold mb-3 flex items-center gap-2"><Icon name="hand-coins" className="w-4 h-4 text-emerald-400" /> {t('society.whyTitle')}</h3>
        <ul className="space-y-2.5 text-sm text-gray-300">
          <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" /> {t('society.why1')}</li>
          <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" /> {t('society.why2')}</li>
          <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" /> {t('society.why3')}</li>
        </ul>
      </div>
    </aside>
  );
}
