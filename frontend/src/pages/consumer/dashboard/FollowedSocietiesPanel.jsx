import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { useFollows } from '../../../context/FollowContext.jsx';
import { Card, SectionHead } from './components.jsx';
import SocietyFinder from './SocietyFinder.jsx';

const titleCase = (slug) => String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Followed societies: the follow context decides what is followed and describes each from the same read;
 * an unresolved slug (browser-local) still gets a title-cased row and can be unfollowed. */
export default function FollowedSocietiesPanel() {
  const follows = useFollows();
  const { slugs, rows: bySlug, busy, loading, refreshRows } = follows;

  // A follow made in the finder below has no row yet: re-read once its write settles, once per missing set.
  const missing = useMemo(() => [...slugs].filter((s) => !bySlug.has(s)).join(','), [slugs, bySlug]);
  const tried = useRef('');
  useEffect(() => {
    if (!missing || busy || loading || tried.current === missing) return;
    tried.current = missing;
    refreshRows().catch(() => {});
  }, [missing, busy, loading, refreshRows]);

  const rows = useMemo(() => [...slugs].map((slug) => {
    const soc = bySlug.get(slug) || null;
    return { slug, soc, name: soc ? soc.name : titleCase(slug), count: soc?.listingCount ?? 0 };
  }), [slugs, bySlug]);

  const unfollow = (slug) => { follows.toggle(slug); };

  return (
    <Card className="p-6">
      <SectionHead
        icon="building-2"
        iconCls="text-teal-400"
        title="Followed Societies"
        sub={rows.length ? `${rows.length} followed · we alert you when a new home is listed` : undefined}
        action={<Link to="/listings" className="text-teal-400 text-sm font-medium hover:text-teal-300">Browse homes →</Link>}
      />

      {rows.length === 0 ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-500/10">
              <Icon name="building-2" className="h-6 w-6 text-teal-400" />
            </div>
            <p className="text-sm font-semibold text-white">No societies followed yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500">
              Track the exact buildings you want — we’ll alert you when a home is listed or prices move.
            </p>
          </div>
          <SocietyFinder />
        </div>
      ) : (
        <div className="space-y-3">
          <SocietyFinder />
          {rows.map(({ slug, soc, name, count }) => (
            <div key={slug} className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-white/[0.02] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link to={`/society/${slug}`} className="truncate text-sm font-semibold text-white hover:text-teal-300">{name}</Link>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {soc ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-gray-300">
                      <Icon name="map-pin" className="h-3 w-3 text-gray-400" /> {titleCase(soc.localitySlug)}
                    </span>
                  ) : null}
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-teal-300">
                    <Icon name="home" className="h-3 w-3" /> {count ? `${count} home${count > 1 ? 's' : ''} listed now` : 'No homes listed now'}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Link to={`/society/${slug}`} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-gray-200 transition hover:bg-white/5">View hub</Link>
                <button
                  type="button"
                  onClick={() => unfollow(slug)}
                  aria-label={`Unfollow ${name}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-gray-500 transition hover:border-rose-400/40 hover:text-rose-300"
                >
                  <Icon name="trash-2" className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
