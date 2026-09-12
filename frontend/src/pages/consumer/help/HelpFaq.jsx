import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import HelpLayout from '../../../components/help/HelpLayout.jsx';
import { Breadcrumbs, EmptyState } from '../../../components/help/HelpCards.jsx';
import { listFaqs } from '../../../services/contentService.js';
import { localizeRecord } from '../../../lib/contentLang.js';
import { useHelpSearch, useHelpLang, useHelpPath } from '../../../lib/useHelp.js';
import { useHelpSeo } from '../../../lib/useHelpSeo.js';

/* FAQ page.
 *
 * Reads the content seam (`services/contentService.listFaqs`) rather than
 * duplicating the questions into Markdown — one answer, two surfaces, and the
 * same source the support page uses.
 *
 * FAQs are admin-editable records, so their translations live on the record
 * itself under a nested `translations` object and are resolved by
 * lib/contentLang.js; see that file for why they cannot sit in the locale
 * bundles. The seam speaks the server's vocabulary — `question` / `answer` /
 * `category`, not the mock's `q` / `a` / `cat`.
 *
 * The list is rendered in whatever order it arrives. `GET /faqs` makes no order
 * promise (see contentService.js), so sorting here would invent one; the page
 * groups by category instead, which is an order the copy itself supplies.
 *
 * FAQs are short answers. Anything needing more than a paragraph belongs in an
 * article, which is why each open question links onward into the help centre. */

const LOCALIZED_FIELDS = ['question', 'answer', 'category'];

export default function HelpFaq() {
  const { t } = useTranslation();
  const lang = useHelpLang();
  const hp = useHelpPath();
  useHelpSeo('/help/faq', lang);
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    let alive = true;
    listFaqs()
      .then((f) => { if (alive) { setRaw(Array.isArray(f) ? f : []); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const faqs = useMemo(
    () => raw.map((f) => localizeRecord(f, LOCALIZED_FIELDS, lang)),
    [raw, lang],
  );

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return faqs;
    return faqs.filter((f) => `${f.question} ${f.answer} ${f.category || ''}`.toLowerCase().includes(q));
  }, [faqs, filter]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const f of visible) {
      const cat = f.category || t('help.faq');
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(f);
    }
    return [...map.entries()];
  }, [visible, t]);

  // Where a question needs more than a paragraph, point at the article that has it.
  const openFaq = faqs.find((f) => f.id === open);
  const relatedResults = useHelpSearch(openFaq ? openFaq.question : '', 1);
  const related = relatedResults[0]?.article || null;

  return (
    <HelpLayout title={t('help.faq')}>
      <div className="max-w-3xl">
        <Breadcrumbs trail={[[t('help.centre'), hp('/help')], [t('help.faq'), null]]} />

        <h1 className="text-xl font-extrabold text-white sm:text-2xl">{t('help.faqTitle')}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-400">{t('help.faqSubtitle')}</p>

        <div className="relative mt-6">
          <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 w-4 h-4 -translate-y-1/2 text-gray-500" />
          <label htmlFor="faq-filter" className="sr-only">{t('help.faqFilterLabel')}</label>
          <input
            id="faq-filter"
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('help.faqFilter')}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-gray-500 focus:border-teal-400/50 focus:outline-none"
          />
        </div>

        <div className="mt-8 space-y-8">
          {loading ? (
            <p className="text-sm text-gray-500">{t('help.faqLoading')}</p>
          ) : groups.length === 0 ? (
            <EmptyState title={filter ? t('help.faqNoMatch', { query: filter }) : t('help.faqNone')}>
              <Link to={hp('/help')} className="text-teal-400 hover:underline">{t('help.browseHelp')}</Link>
            </EmptyState>
          ) : (
            groups.map(([cat, items]) => (
              <section key={cat}>
                <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-gray-500">{cat}</h2>
                <div className="space-y-2">
                  {items.map((f) => {
                    const isOpen = open === f.id;
                    return (
                      <div key={f.id} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
                        <h3>
                          <button
                            type="button"
                            onClick={() => setOpen(isOpen ? null : f.id)}
                            aria-expanded={isOpen}
                            aria-controls={`faq-panel-${f.id}`}
                            className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-sm font-medium text-white transition-colors hover:bg-white/[0.04]"
                          >
                            {f.question}
                            <Icon
                              name="chevron-down"
                              className={`w-4 h-4 shrink-0 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                            />
                          </button>
                        </h3>
                        {isOpen && (
                          <div id={`faq-panel-${f.id}`} className="px-4 pb-4">
                            <p className="text-sm leading-relaxed text-gray-400">{f.answer}</p>
                            {related && (
                              <Link
                                to={hp(`/help/a/${related.slug}`)}
                                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-teal-400 hover:underline"
                              >
                                {t('help.faqReadMore', { title: related.title })}
                                <Icon name="arrow-right" className="w-3 h-3" />
                              </Link>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        <div className="mt-12 rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-sm font-semibold text-white">{t('help.faqNotAnswered')}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-gray-500">{t('help.faqNotAnsweredBody')}</p>
          <Link
            to="/support"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-teal-500 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-teal-400"
          >
            <Icon name="life-buoy" className="w-4 h-4" /> {t('help.raiseATicket')}
          </Link>
        </div>
      </div>
    </HelpLayout>
  );
}
