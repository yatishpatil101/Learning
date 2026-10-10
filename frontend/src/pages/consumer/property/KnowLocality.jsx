import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { posts } from 'virtual:blog-index';
import Icon from '../../../components/Icon.jsx';
import { GUIDE_LOCALITIES, guideSlugFor } from '../../../lib/guideLocalities.js';

const relatedPosts = (all, { deal, locality }) => {
  const topic = deal === 'rent' ? 'renting' : 'buying';
  return all
    .map((post) => ({ post, score: (post.near.includes(locality) ? 2 : 0) + (post.topic === topic ? 1 : 0) }))
    .filter((r) => r.score)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((r) => r.post);
};

export default function KnowLocality({ p }) {
  const { t } = useTranslation();
  const slug = guideSlugFor(p);
  if (!slug) return null;
  const name = GUIDE_LOCALITIES[slug];
  const more = relatedPosts(posts, { deal: p.deal, locality: slug });
  return (
    <section data-testid="property-guide" className="section-mb glass rounded-2xl overflow-hidden">
      <Link to={`/locality/${slug}`} className="flex min-h-[44px] items-center gap-3 px-4 py-3 hover:bg-white/5">
        <Icon name="map-pin" className="h-5 w-5 flex-shrink-0 text-brand-teal-2" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-white">{t('property.guideKnow', { locality: name })}</span>
          <span className="block truncate text-xs text-slate-400">{t('property.guideSub')}</span>
        </span>
        <Icon name="chevron-right" className="h-4 w-4 flex-shrink-0 text-slate-500" />
      </Link>
      {more.length ? (
        <ul className="border-t border-white/10">
          {more.map((post) => (
            <li key={post.slug}>
              <Link to={`/blog/${post.slug}`} className="flex min-h-[44px] items-center gap-3 px-4 text-sm text-slate-300 hover:bg-white/5 hover:text-white">
                <Icon name="book-open" className="h-4 w-4 flex-shrink-0 text-slate-500" />
                <span className="truncate">{post.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
