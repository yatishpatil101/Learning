import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { posts } from 'virtual:blog-index';
import HScroll from '../../../components/ui/HScroll.jsx';
import { GUIDE_LOCALITIES } from '../../../lib/guideLocalities.js';

const headingRow = 'mb-2 flex items-center justify-between gap-3';
const allLink = 'tap-extend relative text-xs font-semibold text-brand-teal-3 hover:text-brand-teal-2';

export default function ExploreStrips() {
  const { t } = useTranslation();
  return (
    <section className="max-w-7xl mx-auto grid gap-6 px-4 pb-10 sm:px-6 lg:grid-cols-2 lg:gap-10 lg:px-8">
      <div className="min-w-0">
        <div className={headingRow}>
          <h2 className="text-sm font-semibold text-white">{t('home.explore.localities')}</h2>
          <Link to="/locality" className={allLink}>{t('home.explore.allLocalities')}</Link>
        </div>
        <HScroll className="flex gap-2 pb-1">
          {Object.entries(GUIDE_LOCALITIES).map(([slug, name]) => (
            <Link key={slug} to={`/locality/${slug}`} className="tap-extend relative inline-flex h-8 flex-shrink-0 items-center rounded-full border border-white/10 px-3 text-sm text-slate-300 hover:border-white/25 hover:text-white">{name}</Link>
          ))}
        </HScroll>
      </div>
      <div className="min-w-0">
        <div className={headingRow}>
          <h2 className="text-sm font-semibold text-white">{t('home.explore.blog')}</h2>
          <Link to="/blog" className={allLink}>{t('home.explore.allPosts')}</Link>
        </div>
        <ul>
          {posts.slice(0, 3).map((post) => (
            <li key={post.slug}>
              <Link to={`/blog/${post.slug}`} className="flex min-h-[44px] items-center justify-between gap-3 border-t border-white/10 text-sm text-slate-200 hover:text-white">
                <span className="truncate">{post.title}</span>
                <span className="flex-shrink-0 text-xs text-slate-500">{post.topicLabel}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
