import { Link, useSearchParams } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import HelpLayout from '../../../components/help/HelpLayout.jsx';
import { Breadcrumbs, EmptyState } from '../../../components/help/HelpCards.jsx';
import { excerptFor } from '../../../lib/help.js';
import { useHelpSearch, useHelpTree, useHelpPath } from '../../../lib/useHelp.js';

/* Full search results. The query lives in the URL so a result set is shareable
   and survives a reload — the reason Enter goes here rather than only opening
   the suggestion dropdown. */

/** Wrap matched terms so the reader can see why a result matched. */
function Highlight({ text, terms }) {
  if (!terms.length) return text;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const parts = String(text).split(new RegExp(`(${escaped})`, 'gi'));
  const lower = terms.map((t) => t.toLowerCase());
  return parts.map((part, i) =>
    lower.includes(part.toLowerCase())
      ? <mark key={i} className="rounded bg-teal-400/20 px-0.5 text-teal-200">{part}</mark>
      : part);
}

export default function HelpSearchResults() {
  const [params] = useSearchParams();
  const { t } = useTranslation();
  const query = (params.get('q') || '').trim();
  const results = useHelpSearch(query);
  const { categories } = useHelpTree();
  const hp = useHelpPath();
  const terms = query.split(/\s+/).filter((term) => term.length > 1);

  return (
    <HelpLayout title={query ? `${t('help.searchTitle')}: ${query}` : t('help.searchTitle')}>
      <Breadcrumbs trail={[[t('help.centre'), hp('/help')], [t('help.searchTitle'), null]]} />

      <h1 className="text-xl font-extrabold text-white sm:text-2xl">
        {query ? t('help.resultsFor', { query }) : t('help.searchTitle')}
      </h1>
      {query && (
        <p className="mt-1.5 text-sm text-gray-500">{t('help.resultCount', { count: results.length })}</p>
      )}

      <div className="mt-8">
        {!query ? (
          <EmptyState title={t('help.searchEmptyTitle')}>
            <Trans
              i18nKey="help.searchEmptyBody"
              components={{ 1: <Link to={hp('/help')} className="text-teal-400 hover:underline" /> }}
            />
          </EmptyState>
        ) : results.length === 0 ? (
          <EmptyState title={t('help.nothingMatched', { query })}>
            <Trans
              i18nKey="help.nothingMatchedBody"
              components={{ 1: <Link to="/support" className="text-teal-400 hover:underline" /> }}
            />
          </EmptyState>
        ) : (
          <ul className="-mx-3 divide-y divide-white/5">
            {results.map(({ article }) => {
              const category = categories.find((c) => c.id === article.category);
              return (
                <li key={article.slug}>
                  <Link to={hp(`/help/a/${article.slug}`)} className="group block rounded-lg px-3 py-4 transition-colors hover:bg-white/[0.04]">
                    {category && (
                      <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-teal-400/80">
                        <Icon name={category.icon} className="w-3 h-3" /> {category.title}
                      </span>
                    )}
                    <span className="block text-sm font-bold text-white group-hover:text-teal-300">
                      <Highlight text={article.title} terms={terms} />
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-gray-500" lang={article.lang}>
                      <Highlight text={excerptFor(article, query)} terms={terms} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </HelpLayout>
  );
}
