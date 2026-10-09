import { useSearchParams } from 'react-router';
import { blog, topics, posts } from 'virtual:blog-posts';
import Icon from '../../../components/Icon.jsx';
import usePageHead from '../../../lib/usePageHead.js';
import { FeaturedCard, OwnerCta, PostCard, TopicIcon } from './BlogParts.jsx';

const CHIP = 'inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400';
const CHIP_ON = 'border-teal-400/50 bg-teal-400/15 text-teal-300';
const CHIP_OFF = 'border-white/10 bg-ink-card text-gray-400 hover:border-teal-400/30 hover:text-white';

const usedTopics = Object.entries(topics)
  .map(([id, label]) => ({ id, label, count: posts.filter((p) => p.topic === id).length }))
  .filter((t) => t.count);

export default function BlogIndex() {
  usePageHead({ title: blog.title, description: blog.description, path: '/blog' });
  const [params, setParams] = useSearchParams();
  const topic = usedTopics.some((t) => t.id === params.get('topic')) ? params.get('topic') : '';
  const shown = topic ? posts.filter((p) => p.topic === topic) : posts;
  const [featured, ...rest] = shown;

  const pick = (id) => setParams(id ? { topic: id } : {}, { replace: true, preventScrollReset: true });
  const chip = (id, label, count) => (
    <button key={id || 'all'} type="button" aria-pressed={topic === id} onClick={() => pick(id)} className={`${CHIP} ${topic === id ? CHIP_ON : CHIP_OFF}`}>
      {id && <TopicIcon topic={id} />}
      {label} <span className="text-xs font-medium opacity-70">{count}</span>
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="relative overflow-hidden rounded-3xl border border-teal-400/15 bg-gradient-to-br from-teal-400/[0.14] via-teal-400/[0.04] to-transparent px-5 py-8 sm:px-10 sm:py-14">
        <Icon name="book-open" aria-hidden="true" className="pointer-events-none absolute -bottom-10 -right-8 hidden h-64 w-64 text-teal-400 opacity-[0.08] sm:block" />
        <p className="inline-flex items-center gap-1.5 rounded-full border border-teal-400/25 bg-teal-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-teal-300">
          <Icon name="book-open" aria-hidden="true" className="h-3.5 w-3.5" /> Draazy Guides
        </p>
        <h1 className="relative mt-4 text-[1.85rem] font-extrabold leading-[1.15] text-white sm:text-5xl">{blog.heading}</h1>
        <p className="relative mt-3 max-w-2xl text-[15px] leading-relaxed text-gray-400 sm:text-lg">{blog.intro}</p>
      </header>

      {posts.length ? (
        <>
          {usedTopics.length > 1 && (
            <nav aria-label="Topics" className="mt-6 flex flex-wrap gap-2">
              {chip('', 'All guides', posts.length)}
              {usedTopics.map((t) => chip(t.id, t.label, t.count))}
            </nav>
          )}

          <div className="mt-6 space-y-4">
            <FeaturedCard post={featured} />
            {rest.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {rest.map((p) => <PostCard key={p.slug} post={p} />)}
              </div>
            )}
          </div>

          <div className="mt-10"><OwnerCta /></div>
        </>
      ) : (
        <p className="mt-6 rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-gray-500">
          The first guides are on their way.
        </p>
      )}
    </div>
  );
}
