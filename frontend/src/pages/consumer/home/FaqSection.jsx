import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { FAQS } from './constants.js';

export default function FaqSection() {
  const { t } = useTranslation();
  return (
    <section className="py-16 sm:py-20 relative" style={{ background: '#12101f' }} aria-labelledby="faqHeading">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <h2 id="faqHeading" className="text-3xl sm:text-4xl font-extrabold text-white">{t('home.faq.title')}</h2>
          <p className="text-gray-400 mt-3">{t('home.faq.subtitle')}</p>
        </div>
        <div className="space-y-3">
          {FAQS.map(([q], i) => (
            <details key={q} className="faq group rounded-2xl border border-white/10 bg-white/5 p-5">
              <summary className="flex items-center justify-between gap-4 cursor-pointer list-none text-white font-semibold text-base">
                <span>{t(`home.faq.q${i + 1}`)}</span>
                <Icon name="chevron-down" className="faq-ico w-5 h-5 text-teal-400 flex-shrink-0" />
              </summary>
              <p className="text-gray-400 text-sm mt-3 leading-relaxed">{t(`home.faq.a${i + 1}`)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
