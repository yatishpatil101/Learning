import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { useFollows } from '../../../context/FollowContext.jsx';
import { listingsInSociety } from '../../../data/societies.js';
import { listProperties } from '../../../services/propertyService.js';
import { listFollowedSocietyRows } from '../../../services/societyService.js';
import { Card, SectionHead } from './components.jsx';
import SocietyFinder from './SocietyFinder.jsx';

const titleCase = (slug) => String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * The dashboard's followed-societies panel.
 *
 * Reads the follow set from `useFollows` rather than localStorage (D227). This was the one surface
 * that could not be ported alone: it does not start from a page of societies, so per-row
 * `followedByMe` could never have answered it — it needed `GET /me/societies/following` to exist.
 *
 * The slug stays the join key, and since D243 it is the *only* key: `listingsInSociety` matches on
 * the slug rather than on the synthetic `S01` id this panel used to look up on its behalf.
 *
 * Where the *description* of each followed society comes from used to be `resolveSociety`, a lookup
 * into the 348 rows bundled into `data/societies.js`. That is wrong in the one direction that
 * matters here: societies minted through the API are absent from the bundle by construction, so a
 * building this user deliberately went and followed rendered as a title-cased slug with no
 * locality chip and no managed tag — the least informative row on the panel belonged to the
 * society they cared enough about to track. It now reads `listFollowedSocietyRows()`, which is the
 * *same* request the follow context already makes, returning the rows instead of only their slugs;
 * there is no per-society fan-out.
 *
 * The two lists are joined on the slug rather than the rows being trusted wholesale, because the
 * follow context is the authority on *what* is followed (it holds the optimistic toggle, so an
 * unfollow leaves this list in the same frame) while the read below is the authority on what each
 * one *is*. A slug the read cannot describe still gets a row — the user followed it and must be
 * able to unfollow it — with the title-cased slug as a last resort, which is honest for exactly
 * the case it was never meant to cover: a read that has not landed, or an unreachable server.
 */
export default function FollowedSocietiesPanel() {
  const follows = useFollows();
  const [listings, setListings] = useState([]);
  const [socs, setSocs] = useState([]);

  useEffect(() => {
    let alive = true;
    listProperties({}).then((all) => { if (alive) setListings(all); });
    return () => { alive = false; };
  }, []);

  /* Keyed on the follow set's size rather than the Set itself: the context replaces the Set on
     every toggle, and a follow made in the finder below needs the new society's row. */
  useEffect(() => {
    let alive = true;
    listFollowedSocietyRows()
      .then((rows) => { if (alive) setSocs(rows); })
      .catch(() => { if (alive) setSocs([]); });
    return () => { alive = false; };
  }, [follows.slugs.size]);

  const bySlug = useMemo(() => new Map(socs.map((s) => [s.slug, s])), [socs]);

  const rows = useMemo(() => [...follows.slugs].map((slug) => {
    const soc = bySlug.get(slug) || null;
    const count = listingsInSociety(listings, slug).length;
    return { slug, soc, name: soc ? soc.name : titleCase(slug), count };
  }), [follows.slugs, listings, bySlug]);

  /* No refresh handshake with the finder any more: both read the same context, so a follow made in
     the search box appears in this list in the same frame the context's Set updates. */
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
              Track the exact buildings you want — we’ll alert you when a home is listed, prices move, or residents review.
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
                  {soc && soc.claimStatus === 'claimed' ? (
                    <span className="shrink-0 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-300">Managed</span>
                  ) : null}
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
