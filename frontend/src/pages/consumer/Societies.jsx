import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import Select from '../../components/ui/Select.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useFollows } from '../../context/FollowContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useScrollReveal } from '../../lib/useScrollReveal.js';
import { useSignInGate } from '../../lib/useSignInGate.js';
import { listLocalities } from '../../services/localityService.js';
import { listSocietiesPage } from '../../services/societyService.js';
import SocietySelect from './list-property/SocietySelect.jsx';
import { Stars } from './property/Stars.jsx';

const titleCase = (slug) => String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 250;

/* Sort options carry i18n keys, not English labels — the <Select> is fed
   translated copy at render time so the list follows the reader's language. */
const SORTS = [
  { value: 'relevance', labelKey: 'societies.sortRelevance' },
  { value: 'rating', labelKey: 'societies.sortRating' },
  { value: 'homes', labelKey: 'societies.sortHomes' },
  { value: 'name', labelKey: 'societies.sortName' },
];

/* The rating is the server's aggregate on the row: no reviews means unrated, not a failed read. */
function SocietyCard({ s, followed, onFollow, t }) {
  return (
    <div className="glass rounded-2xl p-5 flex flex-col gap-3 hover:border-teal-400/30 transition-all reveal">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {/* Stays small on purpose: the two-line clamped title can't be padded without shifting the card rows;
              'View hub' on the same card clears 44px, which is the WCAG exemption. */}
          <Link to={`/society/${s.slug}`} data-tap-exempt className="font-bold text-white text-[15px] leading-snug hover:text-teal-300 transition-colors line-clamp-2">
            {s.name}
          </Link>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
            <span className="inline-flex items-center gap-1"><Icon name="map-pin" className="w-3.5 h-3.5 text-teal-400" /> {s.localityName}</span>
            {s.builder ? <span className="inline-flex items-center gap-1 truncate max-w-[9rem]"><Icon name="hard-hat" className="w-3.5 h-3.5 text-teal-400" /> {s.builder}</span> : null}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs">
        {s.rating.count ? (
          <span className="inline-flex items-center gap-1.5" data-testid="society-rating"><Stars value={s.rating.avg} size={13} /> <span className="font-semibold text-white">{s.rating.avg}</span> <span className="text-gray-500">({s.rating.count})</span></span>
        ) : (
          <span className="text-gray-500 inline-flex items-center gap-1"><Icon name="sparkles" className="w-3.5 h-3.5 text-teal-400" /> {t('societies.notRated')}</span>
        )}
        <span className="ml-auto inline-flex items-center gap-1 font-semibold text-teal-300">
          <Icon name="home" className="w-3.5 h-3.5" /> {s.homes ? t('societies.homes', { count: s.homes }) : t('societies.noHomes')}
        </span>
      </div>

      <div className="flex items-center gap-2 mt-auto pt-1">
        <button
          type="button"
          onClick={() => onFollow(s.slug)}
          aria-pressed={followed}
          className={(followed ? 'btn-teal' : 'btn-outline') + ' !h-11 sm:!h-9 flex-1 text-sm'}
        >
          <Icon name={followed ? 'check' : 'bell'} className="w-4 h-4 mr-1.5" /> {followed ? t('societies.following') : t('societies.follow')}
        </button>
        <Link to={`/society/${s.slug}`} className="btn-outline !h-11 sm:!h-9 px-3 text-sm inline-flex items-center">
          {t('societies.viewHub')} <Icon name="arrow-right" className="w-4 h-4 ml-1.5" />
        </Link>
      </div>
    </div>
  );
}

export default function Societies() {
  const { t } = useTranslation();
  const rootRef = useScrollReveal();
  const nav = useNavigate();
  const sendToSignIn = useSignInGate();
  const { isIn } = useAuth();
  const follows = useFollows();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();

  const [query, setQuery] = useState(params.get('q') || '');
  const [loc, setLoc] = useState(params.get('loc') || '');
  const [sort, setSort] = useState('relevance');
  const [q, setQ] = useState(query.trim());
  /* `rows` keeps the previous answer while the next one is in flight, so a filter tap does not
     collapse the grid under the reader's thumb; `key` says which request the rows answer. */
  const [feed, setFeed] = useState({ rows: [], ratings: {}, total: 0, page: 0, key: '', status: 'loading' });
  const [more, setMore] = useState('idle');
  const readId = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => setQ(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const key = JSON.stringify([q, loc, sort]);
  const read = useCallback(
    (page) => listSocietiesPage({ q, locality: loc, sort, page, size: PAGE_SIZE }),
    [q, loc, sort],
  );

  useEffect(() => {
    const id = ++readId.current;
    setFeed((f) => ({ ...f, status: 'loading' }));
    setMore('idle');
    read(0)
      .then((p) => { if (id === readId.current) setFeed({ ...p, page: 0, key, status: 'ready' }); })
      .catch((err) => {
        console.warn('[societies] directory unavailable', err);
        if (id === readId.current) setFeed({ rows: [], ratings: {}, total: 0, page: 0, key, status: 'failed' });
      });
    // `key` is derived from the same inputs as `read`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read]);

  const showMore = async () => {
    const id = readId.current;
    setMore('busy');
    try {
      const p = await read(feed.page + 1);
      if (id !== readId.current) return;
      setFeed((f) => ({
        ...f,
        rows: [...f.rows, ...p.rows.filter((r) => !f.rows.some((x) => x.slug === r.slug))],
        ratings: { ...f.ratings, ...p.ratings },
        total: p.total,
        page: f.page + 1,
      }));
      setMore('idle');
    } catch (err) {
      console.warn('[societies] next page unavailable', err);
      if (id === readId.current) setMore('failed');
    }
  };

  // Keep the locality (and query) in the URL so a filtered view is shareable and
  // deep-linkable (e.g. the Locality page can link "Societies in Baner").
  useEffect(() => {
    const next = {};
    if (query.trim()) next.q = query.trim();
    if (loc) next.loc = loc;
    setParams(next, { replace: true });
  }, [query, loc, setParams]);

  const loading = feed.status === 'loading';
  const failed = feed.status === 'failed';
  const fresh = feed.status === 'ready' && feed.key === key;

  const [localityRows, setLocalityRows] = useState([]);
  useEffect(() => {
    let alive = true;
    listLocalities().then((rows) => { if (alive) setLocalityRows(rows); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const nameOf = useMemo(() => {
    const byslug = Object.fromEntries(localityRows.map((l) => [l.slug, l.name]));
    return (slug) => byslug[slug] || titleCase(slug);
  }, [localityRows]);

  const cards = useMemo(() => feed.rows.map((soc) => ({
    slug: soc.slug, name: soc.name, builder: soc.builder || '',
    localitySlug: soc.localitySlug || '',
    localityName: soc.localitySlug ? nameOf(soc.localitySlug) : '',
    /* A slug the index lacks is unrated, which is the honest thing to say about a building with no
       reviews anywhere. */
    rating: feed.ratings[soc.slug] || { avg: null, count: 0 },
    homes: soc.listingCount,
  })), [feed.rows, feed.ratings, nameOf]);

  const localities = useMemo(() => {
    const known = localityRows.filter((l) => !l.archived || l.liveListings > 0 || l.slug === loc)
      .map((l) => ({ value: l.slug, label: l.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const extra = loc && !known.some((o) => o.value === loc) ? [{ value: loc, label: nameOf(loc) }] : [];
    return [{ value: '', label: t('societies.allLocalities') }, ...known, ...extra];
  }, [localityRows, loc, nameOf, t]);

  const sortOptions = useMemo(() => SORTS.map((o) => ({ value: o.value, label: t(o.labelKey) })), [t]);

  const onFollow = async (slug) => {
    if (!isIn) { sendToSignIn('society'); return; }
    /* The context returns the state it settled on after any rollback, so
       a refused write toasts 'unfollowed', not a false confirmation. */
    const now = await follows.toggle(slug);
    toast(now ? t('societies.followToast') : t('societies.unfollowToast'), now ? 'success' : 'info');
  };

  /* The picker resolves or mints by Google Place ID; `source` is 'create' only when the row is new,
     and claiming we added a society we merely found sends the member looking for a row that is not new. */
  const addSociety = async (picked) => {
    if (!picked?.slug) return;
    if (isIn && !follows.has(picked.slug)) await follows.toggle(picked.slug);
    toast(picked.source === 'create' ? t('societies.addedToast') : t('societies.alreadyListedToast'), 'success');
    nav('/society/' + picked.slug);
  };

  return (
    <div ref={rootRef} className="soc-page">
      <div className="pt-8 sm:pt-10 pb-24 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="reveal mb-6">
          <p className="text-teal-400 text-xs font-semibold tracking-widest uppercase mb-1.5">{t('societies.eyebrow')}</p>
          <h1 className="text-3xl sm:text-4xl font-extrabold">{t('societies.title')}</h1>
          <p className="text-gray-400 mt-2 max-w-2xl text-sm sm:text-base">
            {t('societies.intro')}
          </p>
        </header>

        {/* Toolbar */}
        <div className="glass rounded-2xl p-3 sm:p-4 mb-6 reveal flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 flex-1 focus-within:border-teal-400/50">
            <Icon name="search" className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={60}
              placeholder={t('societies.searchPlaceholder')}
              className="w-full bg-transparent text-sm text-white placeholder-gray-500 outline-none"
              aria-label={t('societies.searchAria')}
            />
            {query ? (
              <button type="button" onClick={() => setQuery('')} aria-label={t('societies.clearSearch')} className="text-gray-500 hover:text-white"><Icon name="x" className="w-4 h-4" /></button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={loc} onChange={setLoc} options={localities} ariaLabel={t('societies.filterLocality')} className="min-w-0 flex-1 lg:flex-none" />
            <Select value={sort} onChange={setSort} options={sortOptions} ariaLabel={t('societies.sortAria')} className="min-w-0 flex-1 lg:flex-none" />
          </div>
        </div>

        {/* Count + add-society funnel */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4 reveal">
          <p className="text-sm text-gray-400">
            <span className="font-semibold text-white">{feed.total}</span> {feed.total === 1 ? t('societies.countOne') : t('societies.countOther')}{loc ? ` ${t('societies.inLocality', { locality: nameOf(loc) })}` : ''}
          </p>
        </div>

        <div className="relative z-20 mb-6 rounded-2xl border border-dashed border-teal-400/40 bg-teal-500/5 px-4 py-3.5 reveal">
          <p className="mb-2 text-sm font-semibold text-white">{t('societies.cantFindTitle')}</p>
          <SocietySelect allowNotOnMaps={false} mintOrigin="demand" authReason="community" onChange={addSociety} placeholder={t('societies.addPlaceholder')} />
        </div>

        {/* Loading and failed are not "no match": printing that would blame the reader's filters for a read
            not yet made or not completed. */}
        {!cards.length && !failed && !fresh ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="glass h-40 animate-pulse rounded-2xl" />
            ))}
          </div>
        ) : failed ? (
          <div className="glass rounded-2xl px-6 py-14 text-center reveal">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10">
              <Icon name="wifi-off" className="h-6 w-6 text-amber-400" />
            </div>
            <p className="text-sm font-semibold text-white">{t('societies.unavailable')}</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500">{t('societies.unavailableSub')}</p>
            <button type="button" onClick={() => window.location.reload()} className="btn-outline mt-4">{t('societies.retry')}</button>
          </div>
        ) : cards.length ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy={loading}>
              {cards.map((s) => (
                <SocietyCard key={s.slug} s={s} followed={follows.has(s.slug)} onFollow={onFollow} t={t} />
              ))}
            </div>
            {feed.rows.length < feed.total ? (
              <div className="flex justify-center mt-8">
                <button type="button" onClick={showMore} disabled={more === 'busy' || loading} className="btn-outline !h-11 px-5 disabled:opacity-60">
                  {more === 'failed' ? t('societies.retry') : t('societies.showMore')} <Icon name="chevron-down" className="w-4 h-4 ml-1.5" />
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="glass rounded-2xl px-6 py-14 text-center reveal">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-500/10">
              <Icon name="building-2" className="h-6 w-6 text-teal-400" />
            </div>
            <p className="text-sm font-semibold text-white">{t('societies.noMatch')}</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500">{query ? t('societies.noMatchSubAdd') : t('societies.noMatchSub')}</p>
            <button type="button" onClick={() => { setQuery(''); setLoc(''); }} className="btn-outline mt-4">{t('societies.resetFilters')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
