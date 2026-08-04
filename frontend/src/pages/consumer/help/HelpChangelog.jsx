import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import HelpLayout from '../../../components/help/HelpLayout.jsx';
import ArticleProse from '../../../components/help/ArticleProse.jsx';
import { Breadcrumbs, EmptyState } from '../../../components/help/HelpCards.jsx';
import { changelog } from '../../../lib/help.js';
import { useHelpLang, useHelpPath } from '../../../lib/useHelp.js';
import { useHelpSeo } from '../../../lib/useHelpSeo.js';

/* Product changelog. Entries are compiled from src/content/changelog.md at build
   time, so shipping a release note is a Markdown edit, not a code change.
   Release notes stay in English: they are written for and read by the people
   who follow releases, and a stale translation of "what changed" is worse than
   none. `lang="en"` marks that explicitly for assistive tech. */

export default function HelpChangelog() {
  const { t } = useTranslation();
  const hp = useHelpPath();
  useHelpSeo('/help/changelog', useHelpLang());

  return (
    <HelpLayout title={t('help.changelogTitle')}>
      <div className="max-w-3xl">
        <Breadcrumbs trail={[[t('help.centre'), hp('/help')], [t('help.changelog'), null]]} />

        <h1 className="text-xl font-extrabold text-white sm:text-2xl">{t('help.changelogTitle')}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-400">{t('help.changelogSubtitle')}</p>

        {changelog.length === 0 ? (
          <div className="mt-8">
            <EmptyState icon="megaphone" title={t('help.changelogEmpty')} />
          </div>
        ) : (
          <ol className="mt-10 space-y-10">
            {changelog.map((entry) => (
              <li key={entry.version} className="relative border-l border-white/10 pl-6">
                <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-teal-400 ring-4 ring-[#0f0d1a]" />
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-base font-bold text-white">{entry.version}</h2>
                  {entry.date && (
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <Icon name="calendar" className="w-3.5 h-3.5" /> {entry.date}
                    </span>
                  )}
                </div>
                <div className="mt-3" lang="en">
                  <ArticleProse html={entry.html} />
                </div>
              </li>
            ))}
          </ol>
        )}

        <p className="mt-12 border-t border-white/5 pt-6 text-xs text-gray-500">
          {t('help.changelogRegression')}{' '}
          <Link to="/support?cat=other" className="text-teal-400 hover:underline">{t('help.changelogTellUs')}</Link>
          {' '}{t('help.changelogTriage')}
        </p>
      </div>
    </HelpLayout>
  );
}
