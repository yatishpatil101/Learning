import { Link, useParams } from 'react-router';
import { posts } from 'virtual:blog-posts';
import Icon from '../../../components/Icon.jsx';
import ArticleProse from '../../../components/help/ArticleProse.jsx';
import ArticleToc from '../../../components/help/ArticleToc.jsx';
import usePageHead from '../../../lib/usePageHead.js';
import Byline from '../../../components/Byline.jsx';
import { PostCard, OwnerCta, TopicLabel } from './BlogParts.jsx';

export default function BlogPost() {
  const { slug } = useParams();
  const post = posts.find((p) => p.slug === slug);

  usePageHead(post
    ? { title: post.seoTitle, description: post.description, path: `/blog/${post.slug}` }
    : { title: 'Post not found | Draazy', noindex: true });

  if (!post) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-xl font-bold text-white">Post not found</h1>
        <Link to="/blog" className="mt-4 inline-block text-sm text-teal-400 hover:underline">Back to the blog</Link>
      </div>
    );
  }

  const more = post.related.map((s) => posts.find((p) => p.slug === s));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_13rem] xl:gap-10">
        <article className="mx-auto min-w-0 max-w-3xl">
          <nav aria-label="Breadcrumb" className="mb-5">
            <ol className="flex items-center gap-1 text-xs text-gray-500">
              <li><Link to="/" className="hover:text-teal-400">Home</Link></li>
              <li aria-hidden="true"><Icon name="chevron-right" className="w-3 h-3 text-gray-700" /></li>
              <li><Link to="/blog" className="hover:text-teal-400">Blog</Link></li>
            </ol>
          </nav>

          <header className="mb-7 border-b border-white/10 pb-6">
            <Link to={`/blog?topic=${post.topic}`} className="hover:underline"><TopicLabel post={post} /></Link>
            <h1 className="mt-2 text-[1.65rem] font-extrabold leading-tight text-white sm:text-4xl">{post.title}</h1>
            <p className="mt-3 text-base leading-relaxed text-gray-400">{post.description}</p>
            <Byline updated={post.updated} label={post.updatedLabel} className="mt-4"> · {post.readMinutes} min read</Byline>
            {post.dataset && (
              <a href={post.dataset} download className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-teal-400 hover:underline">
                <Icon name="download" aria-hidden="true" className="h-4 w-4" /> Download the data (CSV)
              </a>
            )}
          </header>

          {post.image && (
            <img src={post.image} alt={post.imageAlt} className="mb-8 aspect-[1.91/1] w-full rounded-xl object-cover" />
          )}

          <ArticleToc headings={post.headings} variant="inline" />
          <ArticleProse html={post.html} />

          <div className="mt-10"><OwnerCta /></div>

          {more.length > 0 && (
            <nav aria-label="More guides" className="mt-12">
              <h2 className="mb-4 text-lg font-bold text-white">Keep reading</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {more.map((p) => <PostCard key={p.slug} post={p} heading="h3" />)}
              </div>
            </nav>
          )}
        </article>

        <ArticleToc headings={post.headings} variant="rail" />
      </div>
    </div>
  );
}
