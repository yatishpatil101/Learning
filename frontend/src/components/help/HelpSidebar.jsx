import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import { useHelpPath } from '../../lib/useHelp.js';

/* Grouped navigation for the help centre: section → category → article.
 *
 * Rendered twice — once as a sticky desktop rail, once inside the mobile drawer
 * in HelpLayout — so it takes no layout responsibility of its own beyond the list. */

export default function HelpSidebar({ sections, categories, articles, onNavigate }) {
  const { t } = useTranslation();
  const hp = useHelpPath();
  return (
    <nav aria-label={t('help.helpTopics')} className="space-y-7">
      {sections.map((section) => {
        const inSection = categories.filter((c) => c.section === section.id);
        if (!inSection.length) return null;

        return (
          <div key={section.id}>
            <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-gray-500">
              {section.title}
              {section.access === 'staff' && (
                <Icon name="lock" className="w-3 h-3 text-amber-400/70" aria-label={t('help.staffOnly')} />
              )}
            </p>

            <div className="space-y-4">
              {inSection.map((category) => {
                const inCategory = articles.filter((a) => a.category === category.id);
                return (
                  <div key={category.id}>
                    <NavLink
                      to={hp(`/help/c/${category.id}`)}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        `flex items-center gap-2 text-sm font-semibold transition-colors ${
                          isActive ? 'text-teal-400' : 'text-gray-300 hover:text-white'}`}
                    >
                      <Icon name={category.icon} className="w-4 h-4 shrink-0 text-teal-400/70" />
                      {category.title}
                    </NavLink>

                    {inCategory.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 border-l border-white/10 pl-3 ml-2">
                        {inCategory.map((article) => (
                          <li key={article.slug}>
                            <NavLink
                              to={hp(`/help/a/${article.slug}`)}
                              onClick={onNavigate}
                              className={({ isActive }) =>
                                `block rounded-md py-1.5 pl-2 pr-1 text-[13px] leading-snug transition-colors ${
                                  isActive
                                    ? 'bg-teal-400/10 text-teal-300 font-medium'
                                    : 'text-gray-400 hover:text-white hover:bg-white/[0.04]'}`}
                            >
                              {article.title}
                            </NavLink>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
