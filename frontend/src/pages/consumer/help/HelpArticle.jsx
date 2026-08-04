import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import HelpLayout from '../../../components/help/HelpLayout.jsx';
import ArticleProse from '../../../components/help/ArticleProse.jsx';
import ArticleToc from '../../../components/help/ArticleToc.jsx';
import ArticleFeedback from '../../../components/help/ArticleFeedback.jsx';
import { Breadcrumbs, EmptyState } from '../../../components/help/HelpCards.jsx';
import { articleNeighbours, markViewed } from '../../../lib/help.js';
import { useHelpTree, useHelpLang, useHelpPath } from '../../../lib/useHelp.js';
import { useHelpSeo } from '../../../lib/useHelpSeo.js';
import { useAuth } from '../../../context/AuthContext.jsx';

export default function HelpArticle() {
  const { slug } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const lang = useHelpLang();
  const hp = useHelpPath();
  const { sections, categories, articles } = useHelpTree();

  const article = articles.find((a) => a.slug === slug) || null;
  const category = article ? categories.find((c) => c.id === article.category) : null;
  const section = category ? sections.find((s) => s.id === category.section) : null;
  const { prev, next } = articleNeighbours(article, user, lang);

  // An untranslated article serves identical English at all three URLs, so the
  // alternates would be a duplicate-content signal rather than a translation
  // one. Only publish them once the article actually exists in this language.
  useHelpSeo(`/help/a/${slug}`, lang, {
    index: article ? article.access !== 'staff' : false,
  });

  useEffect(() => { if (article) markViewed(article.slug); }, [article]);

  // Deep links to a heading arrive before the prose has painted, so the browser's
  // native hash scroll lands nowhere. Re-run it once the article is on screen.
  useEffect(() => {
    if (!article || !window.location.hash) return undefined;
    const id = window.location.hash.slice(1);
    const timer = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 60);
    return () => clearTimeout(timer);
  }, [article]);

  if (!article) {
    return (
      <HelpLayout title={t('help.articleNotFound')}>
        <EmptyState icon="file-text" title={t('help.articleNotFound')}>
          <Trans
            i18nKey="help.articleNotFoundBody"
            components={{
              1: <Link to={hp('/help')} className="text-teal-400 hover:underline" />,
              3: <Link to="/support" className="text-teal-400 hover:underline" />,
            }}
          />
        </EmptyState>
      </HelpLayout>
    );
  }

  return (
    <HelpLayout title={article.title}>
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_13rem] xl:gap-10">
        <article className="min-w-0 max-w-3xl">
          <Breadcrumbs
            trail={[
              [t('help.centre'), hp('/help')],
              [section?.title || t('help.topics'), null],
              [category?.title || '', category ? hp(`/help/c/${category.id}`) : null],
              [article.title, null],
            ]}
          />

          <header className="mb-7">
            {article.access === 'staff' && (
              <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-amber-300">
                <Icon name="lock" className="w-3 h-3" /> {t('help.internalBadge')}
              </p>
            )}
            <h1 className="text-2xl font-extrabold leading-tight text-white sm:text-3xl">{article.title}</h1>
            <p className="mt-2.5 text-sm leading-relaxed text-gray-400">{article.summary}</p>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
              <span className="flex items-center gap-1">
                <Icon name="clock" className="w-3.5 h-3.5" /> {t('help.minRead', { count: article.readMinutes })}
              </span>
              {article.updated && (
                <span className="flex items-center gap-1">
                  <Icon name="calendar" className="w-3.5 h-3.5" /> {t('help.updatedOn', { date: article.updated })}
                </span>
              )}
            </div>
          </header>

          {/* Falling back to English is better than hiding the article, but the
              reader has to be told, or a page that suddenly switches language
              reads as a bug rather than a gap in our content. */}
          {!article.translated && (
            <div
              lang="en"
              className="mb-7 flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5"
            >
              <Icon name="info" className="mt-0.5 w-4 h-4 shrink-0 text-teal-400" />
              <div>
                <p className="text-sm font-semibold text-white">{t('help.notTranslatedTitle')}</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">{t('help.notTranslatedBody')}</p>
              </div>
            </div>
          )}

          <ArticleToc headings={article.headings} variant="inline" />

          {/* `lang` marks the body's actual language for screen readers and for
              the browser's hyphenation and font selection, which matters when the
              body is English inside an otherwise-Marathi page. */}
          <div lang={article.lang}>
            <ArticleProse html={article.html} />
          </div>

          {article.tags.length > 0 && (
            <div className="mt-10 flex flex-wrap items-center gap-2">
              <Icon name="tag" className="w-3.5 h-3.5 text-gray-600" />
              {article.tags.map((tag) => (
                <Link
                  key={tag}
                  to={hp(`/help/search?q=${encodeURIComponent(tag)}`)}
                  className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-gray-500 transition-colors hover:border-teal-400/40 hover:text-teal-300"
                >
                  {tag}
                </Link>
              ))}
            </div>
          )}

          <ArticleFeedback slug={article.slug} title={article.title} />

          {(prev || next) && (
            <nav aria-label={t('help.moreIn', { section: category?.title || '' })} className="mt-8 grid gap-3 sm:grid-cols-2">
              {prev ? (
                <Link
                  to={hp(`/help/a/${prev.slug}`)}
                  className="group rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-teal-400/40"
                >
                  <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-widest text-gray-500">
                    <Icon name="arrow-left" className="w-3 h-3" /> {t('help.previous')}
                  </span>
                  <span className="mt-1.5 block text-sm font-semibold text-gray-200 group-hover:text-teal-300">{prev.title}</span>
                </Link>
              ) : <span className="hidden sm:block" />}

              {next && (
                <Link
                  to={hp(`/help/a/${next.slug}`)}
                  className="group rounded-xl border border-white/10 bg-white/[0.03] p-4 text-right transition-colors hover:border-teal-400/40 sm:col-start-2"
                >
                  <span className="flex items-center justify-end gap-1 text-[11px] font-semibold uppercase tracking-widest text-gray-500">
                    {t('help.next')} <Icon name="arrow-right" className="w-3 h-3" />
                  </span>
                  <span className="mt-1.5 block text-sm font-semibold text-gray-200 group-hover:text-teal-300">{next.title}</span>
                </Link>
              )}
            </nav>
          )}
        </article>

        <ArticleToc headings={article.headings} variant="rail" />
      </div>
    </HelpLayout>
  );
}
