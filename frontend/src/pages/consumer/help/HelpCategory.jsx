import { Link, useParams } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import HelpLayout from '../../../components/help/HelpLayout.jsx';
import { ArticleRow, Breadcrumbs, EmptyState } from '../../../components/help/HelpCards.jsx';
import { useHelpTree, useHelpLang, useHelpPath } from '../../../lib/useHelp.js';
import { useHelpSeo } from '../../../lib/useHelpSeo.js';

export default function HelpCategory() {
  const { categoryId } = useParams();
  const { t } = useTranslation();
  const { sections, categories, articles: allArticles } = useHelpTree();
  const category = categories.find((c) => c.id === categoryId) || null;
  const hp = useHelpPath();
  // Staff runbooks stay out of the index: a crawler has no staff session, so the
  // category is a real URL with nothing behind it for the public.
  useHelpSeo(`/help/c/${categoryId}`, useHelpLang(), { index: category?.access !== 'staff' });

  if (!category) {
    return (
      <HelpLayout title={t('help.topicNotFound')}>
        <EmptyState icon="folder-x" title={t('help.topicNotFound')}>
          {t('help.topicNotFoundBody')}{' '}
          <Link to={hp('/help')} className="text-teal-400 hover:underline">{t('help.backToHelp')}</Link>.
        </EmptyState>
      </HelpLayout>
    );
  }

  const section = sections.find((s) => s.id === category.section);
  const articles = allArticles.filter((a) => a.category === category.id);
  const siblings = categories.filter((c) => c.section === category.section && c.id !== category.id);

  return (
    <HelpLayout title={category.title}>
      <Breadcrumbs
        trail={[[t('help.centre'), hp('/help')], [section?.title || t('help.topics'), null], [category.title, null]]}
      />

      <header className="mb-8 border-b border-white/5 pb-6">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-400/10">
            <Icon name={category.icon} className="w-5 h-5 text-teal-400" />
          </span>
          <div>
            <h1 className="text-xl font-extrabold text-white sm:text-2xl">{category.title}</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-gray-400">{category.description}</p>
          </div>
        </div>
      </header>

      {articles.length === 0 ? (
        <EmptyState icon="file-text" title={t('help.noArticlesYet')}>
          <Trans
            i18nKey="help.noArticlesYetBody"
            components={{ 1: <Link to="/support" className="text-teal-400 hover:underline" /> }}
          />
        </EmptyState>
      ) : (
        <div className="-mx-3 divide-y divide-white/5">
          {articles.map((a) => <ArticleRow key={a.slug} article={a} />)}
        </div>
      )}

      {siblings.length > 0 && (
        <section className="mt-12 border-t border-white/5 pt-6">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-gray-500">
            {t('help.moreIn', { section: section?.title || '' })}
          </p>
          <div className="flex flex-wrap gap-2">
            {siblings.map((c) => (
              <Link
                key={c.id}
                to={hp(`/help/c/${c.id}`)}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs text-gray-400 transition-colors hover:border-teal-400/40 hover:text-teal-300"
              >
                <Icon name={c.icon} className="w-3.5 h-3.5" /> {c.title}
              </Link>
            ))}
          </div>
        </section>
      )}
    </HelpLayout>
  );
}
