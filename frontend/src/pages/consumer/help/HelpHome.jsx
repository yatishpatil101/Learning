import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import HelpLayout from '../../../components/help/HelpLayout.jsx';
import HelpSearch from '../../../components/help/HelpSearch.jsx';
import { ArticleCard, CategoryCard } from '../../../components/help/HelpCards.jsx';
import { useHelpTree, useFeaturedArticles, useRecentArticles, useHelpLang, useHelpPath } from '../../../lib/useHelp.js';
import { useHelpSeo } from '../../../lib/useHelpSeo.js';

/* Help centre landing page.
   Uses the `wide` shell — the topic rail is redundant here because the whole
   page is the topic index. */

/* Slugs surfaced as "Popular" under the search box. Chosen rather than derived:
   these are the three questions support answers most often, and a computed
   "most viewed" would only rank whatever we happened to link to first. */
const POPULAR = ['zero-brokerage', 'spot-a-scam', 'post-a-listing'];

export default function HelpHome() {
  const { t } = useTranslation();
  const { sections, categories, articles } = useHelpTree();
  const featured = useFeaturedArticles(4);
  const recent = useRecentArticles().slice(0, 3);
  const hp = useHelpPath();
  useHelpSeo('/help', useHelpLang());

  const titleFor = (id) => categories.find((c) => c.id === id)?.title || '';
  const countIn = (id) => articles.filter((a) => a.category === id).length;

  return (
    <HelpLayout wide title={t('help.centre')}>
      {/* Hero */}
      <section className="py-6 text-center sm:py-12">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-400/25 bg-teal-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-teal-300">
          <Icon name="book-open" className="w-3.5 h-3.5" /> {t('help.centre')}
        </span>
        <h1 className="mt-4 text-2xl font-extrabold text-white sm:text-4xl">{t('help.heroTitle')}</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-gray-400 sm:text-base">
          {t('help.heroSubtitle')}
        </p>
        <div className="mx-auto mt-6 max-w-xl">
          <HelpSearch variant="hero" />
        </div>
        <p className="mt-3 text-xs text-gray-600">
          {t('help.popular')}{' '}
          {POPULAR.map((slug, i) => {
            const a = articles.find((x) => x.slug === slug);
            if (!a) return null;
            return (
              <span key={slug}>
                {i > 0 && <span className="text-gray-700"> · </span>}
                <Link to={hp(`/help/a/${slug}`)} className="text-gray-500 hover:text-teal-400">{a.title}</Link>
              </span>
            );
          })}
        </p>
      </section>

      {/* Recently viewed — only once there is history worth showing */}
      {recent.length > 0 && (
        <section className="mb-12">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-gray-500">
            {t('help.pickUpWhereYouLeftOff')}
          </h2>
          <div className="flex flex-wrap gap-2">
            {recent.map((a) => (
              <Link
                key={a.slug}
                to={hp(`/help/a/${a.slug}`)}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs text-gray-400 transition-colors hover:border-teal-400/40 hover:text-teal-300"
              >
                <Icon name="history" className="w-3.5 h-3.5" /> {a.title}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Start here */}
      {featured.length > 0 && (
        <section className="mb-14">
          <h2 className="mb-4 text-lg font-bold text-white">{t('help.startHere')}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((a) => (
              <ArticleCard key={a.slug} article={a} categoryTitle={titleFor(a.category)} />
            ))}
          </div>
        </section>
      )}

      {/* Browse by section */}
      {sections.map((section) => {
        const inSection = categories.filter((c) => c.section === section.id);
        if (!inSection.length) return null;

        return (
          <section key={section.id} className="mb-14">
            <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-lg font-bold text-white">{section.title}</h2>
              {section.access === 'staff' && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-300">
                  <Icon name="lock" className="w-3 h-3" /> {t('help.staffOnly')}
                </span>
              )}
              <p className="w-full text-sm text-gray-500 sm:w-auto">{section.description}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {inSection.map((c) => (
                <CategoryCard key={c.id} category={c} count={countIn(c.id)} />
              ))}
            </div>
          </section>
        );
      })}

      {/* Escalation */}
      <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">{t('help.needAPerson')}</h2>
            <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-gray-400">{t('help.needAPersonBody')}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link
              to="/support"
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-400"
            >
              <Icon name="life-buoy" className="w-4 h-4" /> {t('help.raiseATicket')}
            </Link>
            <Link
              to="/contact"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-gray-300 transition-colors hover:text-white"
            >
              <Icon name="phone" className="w-4 h-4" /> {t('help.contactUs')}
            </Link>
          </div>
        </div>
      </section>
    </HelpLayout>
  );
}
