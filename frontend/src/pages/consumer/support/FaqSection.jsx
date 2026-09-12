import Icon from '../../../components/Icon.jsx';
import { useTranslation } from 'react-i18next';

export default function FaqSection({ faqs, openFaq, setOpenFaq }) {
  const { t } = useTranslation();
  if (faqs.length === 0) return null;
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 mt-10 reveal">
      <h2 className="text-xl font-bold text-white mb-4">{t('misc.faqTitle')}</h2>
      <div className="space-y-2">
        {faqs.map((f) => (
          <div key={f.id} className="glass-card rounded-xl overflow-hidden">
            <button
              onClick={() => setOpenFaq(openFaq === f.id ? null : f.id)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-white hover:bg-white/5"
            >
              {f.question}
              <Icon name="chevron-down" className={'w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ' + (openFaq === f.id ? 'rotate-180' : '')} />
            </button>
            {openFaq === f.id && <p className="px-4 pb-4 text-sm text-gray-400 leading-relaxed">{f.answer}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
