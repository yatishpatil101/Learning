import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import { SERVICES, FAQ } from './constants.js';

export default function InfoSections({ openFaq, setOpenFaq }) {
  const { t: tr } = useTranslation();
  return (
    <>
      {/* Services */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
        <h2 className="text-2xl font-bold text-white mb-6">{tr('services.ra.assist.title')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SERVICES.map(([, i], idx) => (
            <div key={idx} className="glass-card rounded-2xl p-5">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-teal-400/20 to-teal-600/20 border border-teal-400/20 flex items-center justify-center mb-3"><Icon name={i} className="w-5 h-5 text-teal-400" /></div>
              <h3 className="text-white font-semibold text-sm mb-1">{tr(`services.ra.assist.item.${idx}.name`)}</h3>
              <p className="text-gray-400 text-xs leading-relaxed">{tr(`services.ra.assist.item.${idx}.desc`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
        <h2 className="text-2xl font-bold text-white mb-6 text-center">{tr('services.ra.assist.faqTitle')}</h2>
        <div className="space-y-3">
          {FAQ.map((_f, i) => (
            <div key={i} className={'faq-item glass-card rounded-2xl overflow-hidden' + (openFaq === i ? ' open' : '')}>
              <div className="faq-q flex items-center justify-between gap-4 p-5" onClick={() => setOpenFaq(openFaq === i ? -1 : i)}>
                <p className="text-white font-medium text-sm">{tr(`services.ra.assist.faq.${i}.q`)}</p>
                <Icon name="chevron-down" className="faq-chev w-5 h-5 text-teal-400 flex-shrink-0" />
              </div>
              <div className="faq-a"><p className="px-5 pb-5 text-gray-400 text-sm leading-relaxed">{tr(`services.ra.assist.faq.${i}.a`)}</p></div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
