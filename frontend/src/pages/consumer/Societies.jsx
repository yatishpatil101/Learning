import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import Select from '../../components/ui/Select.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useScrollReveal } from '../../lib/useScrollReveal.js';
import { listProperties } from '../../services/propertyService.js';
import { allSocieties, listingsInSociety } from '../../data/societies.js';
import {
  resolveSociety, entityRating,
  getFollowedSocieties, toggleFollowSociety, mintDemandSociety,
} from '../../lib/store.js';
import { Stars } from './property/Stars.jsx';

const titleCase = (slug) => String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const norm = (s) => String(s || '').trim().toLowerCase();

/* Sort options carry i18n keys, not English labels — the <Select> is fed
   translated copy at render time so the list follows the reader's language. */
const SORTS = [
  { value: 'relevance', labelKey: 'societies.sortRelevance' },
  { value: 'rating', labelKey: 'societies.sortRating' },
  { value: 'homes', labelKey: 'societies.sortHomes' },
  { value: 'name', labelKey: 'societies.sortName' },
];

function SocietyCard({ s, followed, onFollow, t }) {
  return (
    <div className="glass rounded-2xl p-5 flex flex-col gap-3 hover:border-teal-400/30 transition-all reveal">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/society/${s.slug}`} className="font-bold text-white text-[15px] leading-snug hover:text-teal-300 transition-colors line-clamp-2">
            {s.name}
          </Link>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
            <span className="inline-flex items-center gap-1"><Icon name="map-pin" className="w-3.5 h-3.5 text-teal-400" /> {titleCase(s.localitySlug)}</span>
            {s.builder ? <span className="inline-flex items-center gap-1 truncate max-w-[9rem]"><Icon name="hard-hat" className="w-3.5 h-3.5 text-teal-400" /> {s.builder}</span> : null}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {s.managed ? (
            <span className="tag" style={{ background: 'rgba(37,99,235,.9)', color: '#fff', border: 'none' }}><Icon name="shield-check" className="w-3 h-3" /> {t('societies.managed')}</span>
          ) : s.verified ? (
            <span className="tag" style={{ background: 'rgba(13,148,136,.85)', color: '#fff', border: 'none' }}><Icon name="badge-check" className="w-3 h-3" /> {t('societies.verified')}</span>
          ) : (
            <span className="tag" style={{ background: 'rgba(251,191,36,.15)', color: '#fcd34d', border: '1px solid rgba(251,191,36,.3)' }}>{t('societies.community')}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs">
        {s.rating.count ? (
          <span className="inline-flex items-center gap-1.5"><Stars value={s.rating.avg} size={13} /> <span className="font-semibold text-white">{s.rating.avg}</span> <span className="text-gray-500">({s.rating.count})</span></span>
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
          className={(followed ? 'btn-teal' : 'btn-outline') + ' !h-9 flex-1 text-sm'}
        >
          <Icon name={followed ? 'check' : 'bell'} className="w-4 h-4 mr-1.5" /> {followed ? t('societies.following') : t('societies.follow')}
        </button>
        <Link to={`/society/${s.slug}`} className="btn-outline !h-9 px-3 text-sm inline-flex items-center">
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
  const { isIn } = useAuth();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();

  const [query, setQuery] = useState(params.get('q') || '');
  const [loc, setLoc] = useState(params.get('loc') || '');
  const [sort, setSort] = useState('relevance');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [listings, setListings] = useState([]);
  const [followed, setFollowed] = useState(() => new Set(getFollowedSocieties()));
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(24);

  useEffect(() => {
    let alive = true;
    listProperties({}).then((all) => { if (alive) setListings(all); });
    return () => { alive = false; };
  }, []);

  // Keep the locality (and query) in the URL so a filtered view is shareable and
  // deep-linkable (e.g. the Locality page can link "Societies in Baner").
  useEffect(() => {
    const next = {};
    if (query.trim()) next.q = query.trim();
    if (loc) next.loc = loc;
    setParams(next, { replace: true });
  }, [query, loc, setParams]);

  const enriched = useMemo(() => allSocieties().map((raw) => {
    const soc = resolveSociety(raw.slug) || raw;
    const community = soc.tier === 'community';
    const verified = !community && !!(soc.registration && soc.conveyance);
    return {
      id: soc.id, slug: soc.slug, name: soc.name, builder: soc.builder || '',
      localitySlug: soc.localitySlug || '',
      verified, community, managed: soc.claimStatus === 'claimed',
      rating: entityRating('society', soc.id),
      homes: listingsInSociety(listings, soc.id).length,
    };
  }), [listings]);

  const localities = useMemo(() => {
    const set = [...new Set(enriched.map((s) => s.localitySlug).filter(Boolean))].sort();
    return [{ value: '', label: t('societies.allLocalities') }, ...set.map((slug) => ({ value: slug, label: titleCase(slug) }))];
  }, [enriched, t]);

  const sortOptions = useMemo(() => SORTS.map((o) => ({ value: o.value, label: t(o.labelKey) })), [t]);

  const results = useMemo(() => {
    const q = norm(query);
    let list = enriched.filter((s) => {
      if (loc && s.localitySlug !== loc) return false;
      if (verifiedOnly && !s.verified) return false;
      if (q && !(`${s.name} ${s.builder} ${titleCase(s.localitySlug)}`.toLowerCase().includes(q))) return false;
      return true;
    });
    const rel = (s) => (Number(s.verified) * 4) + Math.min(s.homes, 3) + (s.rating.avg / 5);
    list = list.slice().sort((a, b) => {
      if (sort === 'rating') return (b.rating.avg - a.rating.avg) || (b.rating.count - a.rating.count) || a.name.localeCompare(b.name);
      if (sort === 'homes') return (b.homes - a.homes) || (Number(b.verified) - Number(a.verified)) || a.name.localeCompare(b.name);
      if (sort === 'name') return a.name.localeCompare(b.name);
      return rel(b) - rel(a) || a.name.localeCompare(b.name);
    });
    return list;
  }, [enriched, query, loc, verifiedOnly, sort]);

  useEffect(() => { setLimit(24); }, [query, loc, verifiedOnly, sort]);

  const exact = useMemo(() => results.find((s) => norm(s.name) === norm(query)), [results, query]);
  const canCreate = query.trim().length >= 2 && !exact;

  const onFollow = (slug) => {
    if (!isIn) { nav('/signin?next=' + encodeURIComponent('/societies')); return; }
    const now = toggleFollowSociety(slug);
    setFollowed(new Set(getFollowedSocieties()));
    toast(now ? t('societies.followToast') : t('societies.unfollowToast'), now ? 'success' : 'info');
  };

  const addSociety = () => {
    if (!isIn) { nav('/signin?next=' + encodeURIComponent('/societies')); return; }
    setBusy(true);
    const rec = mintDemandSociety({ name: query.trim(), localitySlug: loc || undefined });
    setBusy(false);
    if (!rec) return;
    toast(t('societies.addedToast'), 'success');
    nav('/society/' + rec.slug);
  };

  const visible = results.slice(0, limit);

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
          {/* flex-wrap + min-w-0: three controls do not fit one phone row. The two
              selects are `flex-1`, but a flex item defaults to `min-width: auto`, so
              they refused to shrink below their content ("Sort: Recommended" alone
              claims 186px) and pushed the Verified toggle to x=364..481 on a 412px
              screen — 69px of it off the edge, with no page scroll to reach it,
              because an ancestor clips the overflow. So the control was simply
              unreachable on a phone rather than visibly broken, which is why it
              survived the suite.

              min-w-0 lets the selects give way; flex-wrap lets Verified drop to its
              own row when they cannot give way enough. Unchanged at lg, where the
              toolbar is one row on a wide canvas. */}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={loc} onChange={setLoc} options={localities} ariaLabel={t('societies.filterLocality')} className="min-w-0 flex-1 lg:flex-none" />
            <Select value={sort} onChange={setSort} options={sortOptions} ariaLabel={t('societies.sortAria')} className="min-w-0 flex-1 lg:flex-none" />
            <button
              type="button"
              onClick={() => setVerifiedOnly((v) => !v)}
              aria-pressed={verifiedOnly}
              className={(verifiedOnly ? 'btn-teal' : 'btn-outline') + ' !h-10 px-3.5 text-sm whitespace-nowrap'}
            >
              <Icon name="badge-check" className="w-4 h-4 mr-1.5" /> {t('societies.verified')}
            </button>
          </div>
        </div>

        {/* Count + add-society funnel */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4 reveal">
          <p className="text-sm text-gray-400">
            <span className="font-semibold text-white">{results.length}</span> {results.length === 1 ? t('societies.countOne') : t('societies.countOther')}{loc ? ` ${t('societies.inLocality', { locality: titleCase(loc) })}` : ''}
          </p>
        </div>

        {canCreate ? (
          <button
            type="button"
            onClick={addSociety}
            disabled={busy}
            className="w-full mb-6 flex items-center gap-3 rounded-2xl border border-dashed border-teal-400/40 bg-teal-500/5 px-4 py-3.5 text-left transition hover:bg-teal-500/10 disabled:opacity-60 reveal"
          >
            <span className="w-9 h-9 rounded-xl bg-teal-500/15 flex items-center justify-center flex-shrink-0"><Icon name="plus" className="w-5 h-5 text-teal-300" /></span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-white">{t('societies.cantFind', { query: query.trim() })}</span>
              <span className="block text-xs text-gray-400">{t('societies.addHint')}</span>
            </span>
            <Icon name="arrow-right" className="w-4 h-4 text-teal-300 ml-auto flex-shrink-0" />
          </button>
        ) : null}

        {/* Grid */}
        {results.length ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {visible.map((s) => (
                <SocietyCard key={s.id} s={s} followed={followed.has(s.slug)} onFollow={onFollow} t={t} />
              ))}
            </div>
            {results.length > limit ? (
              <div className="flex justify-center mt-8">
                <button type="button" onClick={() => setLimit((n) => n + 24)} className="btn-outline">
                  {t('societies.showMore')} <Icon name="chevron-down" className="w-4 h-4 ml-1.5" />
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
            <button type="button" onClick={() => { setQuery(''); setLoc(''); setVerifiedOnly(false); }} className="btn-outline mt-4">{t('societies.resetFilters')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
