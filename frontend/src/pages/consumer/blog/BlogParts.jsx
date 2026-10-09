import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';

// Literal class strings so Tailwind's scanner keeps them; keys match TOPICS in scripts/vite-plugin-blog.mjs.
const TONES = {
  renting: { icon: 'key-round', text: 'text-teal-400', cover: 'from-teal-400/25 via-teal-400/[0.08]' },
  buying: { icon: 'building', text: 'text-sky-400', cover: 'from-sky-400/25 via-sky-400/[0.08]' },
  owners: { icon: 'home', text: 'text-amber-400', cover: 'from-amber-400/25 via-amber-400/[0.08]' },
  localities: { icon: 'map-pin', text: 'text-violet-400', cover: 'from-violet-400/25 via-violet-400/[0.08]' },
};
const toneOf = (topic) => TONES[topic] || TONES.renting;

const CARD = 'group rounded-2xl border border-white/10 bg-ink-card shadow-[var(--tile-shadow)] transition-colors duration-200 hover:border-teal-400/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400';

export function PostMeta({ post, className = '', withAuthor = false }) {
  return (
    <p className={`text-xs text-gray-500 ${className}`}>
      {withAuthor && `${post.author} · `}
      <time dateTime={post.published}>{post.dateLabel}</time> · {post.readMinutes} min read
    </p>
  );
}

export function TopicIcon({ topic, className = 'h-4 w-4' }) {
  const tone = toneOf(topic);
  return <Icon name={tone.icon} aria-hidden="true" className={`${className} ${tone.text}`} />;
}

export function TopicLabel({ post }) {
  return (
    <span className={`text-[11px] font-semibold uppercase tracking-widest ${toneOf(post.topic).text}`}>{post.topicLabel}</span>
  );
}

function Cover({ tone, featured = false }) {
  return (
    <div aria-hidden="true" className={`relative h-14 shrink-0 overflow-hidden bg-gradient-to-br to-transparent ${tone.cover} ${featured ? 'sm:h-auto sm:w-1/3' : ''}`}>
      <Icon name={tone.icon} className={`absolute -right-3 top-1/2 h-24 w-24 -translate-y-1/2 opacity-20 ${featured ? 'sm:h-44 sm:w-44' : ''} ${tone.text}`} />
      <span className={`absolute left-4 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg bg-ink-card ${featured ? 'sm:left-6 sm:h-11 sm:w-11' : ''} ${tone.text}`}>
        <Icon name={tone.icon} className="h-[18px] w-[18px]" />
      </span>
    </div>
  );
}

function CardFooter({ post }) {
  return (
    <div className="mt-auto flex items-center justify-between gap-3 pt-4">
      <PostMeta post={post} />
      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-teal-400">
        Read <Icon name="arrow-right" aria-hidden="true" className="h-4 w-4" />
      </span>
    </div>
  );
}

export function FeaturedCard({ post }) {
  return (
    <Link to={`/blog/${post.slug}`} className={`${CARD} flex flex-col overflow-hidden sm:flex-row`}>
      <Cover tone={toneOf(post.topic)} featured />
      <div className="flex flex-1 flex-col p-5 sm:p-7">
        <p className="flex items-center gap-2">
          <span className="rounded-full bg-teal-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-teal-300">Latest</span>
          <TopicLabel post={post} />
        </p>
        <h2 className="mt-2.5 text-xl font-extrabold leading-snug text-white group-hover:text-teal-300 sm:text-2xl">{post.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-400 sm:text-[15px]">{post.description}</p>
        <CardFooter post={post} />
      </div>
    </Link>
  );
}

export function PostCard({ post, heading: Heading = 'h2' }) {
  return (
    <Link to={`/blog/${post.slug}`} className={`${CARD} flex h-full flex-col overflow-hidden`}>
      <Cover tone={toneOf(post.topic)} />
      <div className="flex flex-1 flex-col p-5">
        <TopicLabel post={post} />
        <Heading className="mt-2 text-base font-bold leading-snug text-white group-hover:text-teal-300">{post.title}</Heading>
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-gray-400">{post.description}</p>
        <CardFooter post={post} />
      </div>
    </Link>
  );
}

export function OwnerCta() {
  return (
    <aside className="rounded-2xl border border-teal-400/20 bg-gradient-to-br from-teal-400/[0.12] to-transparent p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-7">
      <div>
        <p className="text-base font-bold text-white">Looking for a home in Pune?</p>
        <p className="mt-1 text-sm text-gray-400">Talk to owners directly. Zero brokerage.</p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 sm:mt-0 sm:shrink-0">
        <Link to="/listings?deal=rent" className="btn-teal inline-flex min-h-[44px] items-center rounded-xl px-5 text-sm font-semibold">Browse homes</Link>
        <Link to="/list-property" className="inline-flex min-h-[44px] items-center rounded-xl border border-white/15 px-5 text-sm font-semibold text-gray-200 transition-colors hover:border-teal-400/40 hover:text-white">
          List your property
        </Link>
      </div>
    </aside>
  );
}
