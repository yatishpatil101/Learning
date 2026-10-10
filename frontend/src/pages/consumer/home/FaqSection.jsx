import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { listFaqs } from '../../../services/contentService.js';
import { FAQS } from './constants.js';

const HOME_FAQS = 6;

export default function FaqSection() {
  const { t, i18n } = useTranslation();
  const [cms, setCms] = useState([]);
  useEffect(() => {
    let alive = true;
    listFaqs().then((rows) => { if (alive) setCms(rows.slice(0, HOME_FAQS)); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const lang = i18n.language.split('-')[0];
  const items = cms.length
    ? cms.map((f) => ({ key: f.id, q: f.translations?.[lang]?.question || f.question, a: f.translations?.[lang]?.answer || f.answer }))
    : FAQS.map(([q], i) => ({ key: q, q: t(`home.faq.q${i + 1}`), a: t(`home.faq.a${i + 1}`) }));
  return (
    <section className="section-y-m py-16 sm:py-20 relative" style={{ background: 'var(--section-alt)' }} aria-labelledby="faqHeading">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="section-head text-center sm:mb-10">
          <h2 id="faqHeading" className="text-3xl sm:text-4xl font-extrabold text-white">{t('home.faq.title')}</h2>
          <p className="text-gray-400 mt-3">{t('home.faq.subtitle')}</p>
        </div>
        <div className="space-y-3">
          {items.map(({ key, q, a }) => (
            <details key={key} className="faq group rounded-2xl border border-white/10 bg-white/5 p-5">
              {/* The whole summary row is the toggle, so it carries the touch floor
                  rather than relying on the question happening to wrap to two lines. */}
              <summary className="flex min-h-[44px] sm:min-h-0 items-center justify-between gap-4 cursor-pointer list-none text-white font-semibold text-base">
                <span>{q}</span>
                <Icon name="chevron-down" className="faq-ico w-5 h-5 text-teal-400 flex-shrink-0" />
              </summary>
              <p className="text-gray-400 text-sm mt-3 leading-relaxed">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
