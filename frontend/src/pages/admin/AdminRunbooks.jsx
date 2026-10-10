import { useCallback, useMemo } from 'react';
import { Link, useParams } from 'react-router';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Loading from '../../components/ui/Loading.jsx';
import ArticleProse from '../../components/help/ArticleProse.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useHelpTree } from '../../lib/useHelp.js';
import { moduleLabel, portalPath, runbooksFor } from '../../lib/adminModules.js';

export default function AdminRunbooks() {
  const { slug } = useParams();
  const { user } = useAuth();
  const { articles, pending } = useHelpTree();
  const runbooks = useMemo(() => runbooksFor(articles, user), [articles, user]);
  const active = slug ? runbooks.find((a) => a.slug === slug) : null;
  const to = (s) => portalPath(user, `/admin/runbooks/${s}`);

  const resolveHref = useCallback((href) => {
    const linked = href.match(/^\/help\/a\/([^/?#]+)/)?.[1];
    if (linked && runbooks.some((a) => a.slug === linked)) return portalPath(user, `/admin/runbooks/${linked}`);
    return portalPath(user, href);
  }, [runbooks, user]);

  if (pending) return <Loading />;

  return (
    <div>
      <PageHeader title="Runbooks" subtitle="What to monitor and work on, for each desk you can open." />
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <nav aria-label="Runbooks" className={(slug ? 'hidden lg:block ' : '') + 'space-y-1'}>
          {runbooks.map((a) => (
            <Link
              key={a.slug}
              to={to(a.slug)}
              aria-current={a.slug === slug ? 'page' : undefined}
              className={'block rounded-xl border px-3 py-2.5 transition ' + (a.slug === slug
                ? 'border-brand-teal/40 bg-brand-teal/10 text-brand-teal'
                : 'border-white/10 bg-white/[0.03] text-gray-200 hover:bg-white/5')}
            >
              <span className="block text-sm font-semibold">{a.title}</span>
              <span className="mt-0.5 block text-[11px] text-gray-400">
                {a.modules?.length ? a.modules.map(moduleLabel).join(' · ') : 'Everyone'}
              </span>
            </Link>
          ))}
        </nav>

        <section className={(slug ? '' : 'hidden lg:block ') + 'min-w-0 rounded-2xl border border-white/10 bg-ink-2 p-4 sm:p-6'}>
          {slug ? <Link to={portalPath(user, '/admin/runbooks')} className="mb-3 inline-block text-xs text-brand-teal lg:hidden">← All runbooks</Link> : null}
          {active ? (
            <article data-testid="runbook-article">
              <h2 className="text-xl font-extrabold">{active.title}</h2>
              <p className="mb-5 mt-1 text-xs text-gray-400">{active.summary}{active.updated ? ` · Updated ${active.updated}` : ''}</p>
              <ArticleProse html={active.html} resolveHref={resolveHref} />
            </article>
          ) : (
            <p className="text-sm text-gray-400">
              {slug ? 'This runbook is not available for your desks. ' : ''}Pick a runbook from the list.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
