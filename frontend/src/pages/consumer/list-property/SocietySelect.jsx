import { useEffect, useMemo, useRef, useState, useId } from 'react';
import { Check, ShieldCheck, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { searchSocieties, addCommunitySociety } from '../../../lib/store.js';
import { useSocietyCatalogue } from '../../../lib/useSocietyCatalogue.js';
import { cleanText } from './sanitize.js';
import { fld } from './styles.js';

/**
 * SocietySelect — "select or create" society typeahead.
 *
 * Replaces the free-text society field so every listing binds to a real society
 * ENTITY (`societyId`), never a raw string. Verified societies rank first (green
 * badge); community (user-added, unverified) ones show below with an amber badge.
 * When no match exists, "Add '<name>'" mints a community society inline + drops an
 * ops verification lead — turning the listing funnel into the society-acquisition
 * engine. The typed name is always kept in sync so validation/legacy reads work.
 *
 * @param {string} value - Selected societyId ('' when unbound).
 * @param {string} name - Current display name (form.society).
 * @param {(sel: {id: string, name: string}) => void} onChange
 * @param {string} [localityLabel] - Selected locality (used to rank + seed a mint).
 * @param {number|null} [lat] @param {number|null} [lng] @param {string} [pincode]
 *        Inherited by a minted society so ops gets good data (zero extra friction).
 * @param {string} [placeholder] @param {boolean} [invalid] @param {string} [dataErr]
 */
const norm = (s) => String(s || '').trim().toLowerCase();

export default function SocietySelect({
  value, name, onChange,
  localityLabel = '', lat = null, lng = null, pincode = '',
  placeholder, invalid = false, dataErr = 'society',
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(name || '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [meta, setMeta] = useState(null); // { verified, community } of the bound society
  const rootRef = useRef(null);
  const focusedRef = useRef(false);
  const listId = useId();

  // Keep the visible text in sync when the form is reset/prefilled externally
  // (edit flow), but never fight the user while they're typing.
  useEffect(() => {
    if (!focusedRef.current) setQuery(name || '');
  }, [name]);

  // The dedup this control exists to perform is only as good as the catalogue it
  // searches: against the curated head alone, "Add '<name>'" would offer to mint a
  // society that is already one of the 320 RERA rows (D129).
  const catalogueReady = useSocietyCatalogue();
  const results = useMemo(() => searchSocieties(query, localityLabel), [query, localityLabel, catalogueReady]); // eslint-disable-line react-hooks/exhaustive-deps -- invalidation signal for the module-level society store; see `lib/useSocietyCatalogue.js`.
  const exact = useMemo(() => results.find((r) => norm(r.name) === norm(query)) || null, [results, query]);
  // `!exact` is only trustworthy once the catalogue is complete: against the curated
  // head every one of the 320 RERA names looks unknown, so this row would offer — and
  // a fast typist would accept — a mint of a society that already exists.
  const canCreate = catalogueReady && query.trim().length >= 2 && !exact;
  // Flat item list = societies + optional create row, for shared keyboard nav.
  const items = useMemo(
    () => (canCreate ? [...results, { create: true, name: query.trim() }] : results),
    [results, canCreate, query],
  );

  // Resolve the badge shown under the field for the currently-bound society.
  useEffect(() => {
    if (!value) { setMeta(null); return; }
    const hit = results.find((r) => r.id === value);
    if (hit) setMeta({ verified: hit.verified, community: hit.community });
  }, [value, results]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pickSociety = (s) => {
    setQuery(s.name);
    setMeta({ verified: s.verified, community: s.community });
    onChange({ id: s.id, name: s.name });
    setOpen(false);
  };

  const createSociety = () => {
    // Belt and braces with `canCreate`: keyboard Enter commits `items[active]`, and a
    // list that shrinks as the catalogue lands can leave `active` pointing at the row
    // that used to be the create row.
    if (!catalogueReady) return;
    const rec = addCommunitySociety({ name: query.trim(), localityLabel, lat, lng, pincode });
    if (!rec) return;
    setQuery(rec.name);
    // addCommunitySociety hands back the canonical row when the name already exists,
    // so trust the record rather than assuming what we asked for was minted.
    setMeta({ verified: !!(rec.registration && rec.conveyance), community: rec.tier === 'community' });
    onChange({ id: rec.id, name: rec.name });
    setOpen(false);
  };

  const commit = (item) => (item.create ? createSociety() : pickSociety(item));

  const onType = (raw) => {
    const v = cleanText(raw);
    setQuery(v);
    setOpen(true);
    setActive(0);
    // Auto-bind on an exact name match; otherwise keep the name but drop the id
    // so we never claim a listing belongs to a society the user didn't pick.
    // Read the gated `results` rather than calling searchSocieties() again: a second,
    // ungated read here would answer "no match" for every RERA society during the load
    // window, and the effect below is what repairs it if the user out-types the chunk.
    const hit = results.find((r) => norm(r.name) === norm(v));
    onChange({ id: hit ? hit.id : '', name: v });
  };

  /* Re-attempt the bind once the catalogue completes.
     Typing (or pasting, or autofilling) an exact RERA society name before the chunk
     lands leaves `value` empty, and nothing else re-derives it — `results` recomputing
     only refreshes the badge. The listing then persists with no societyId and
     `societyForListing` hands it to a *different* society via the locality hash pool,
     while the correct name still displays. Silent, and wrong on someone else's page. */
  useEffect(() => {
    if (!catalogueReady || value || !query.trim()) return;
    const hit = results.find((r) => norm(r.name) === norm(query));
    if (hit) onChange({ id: hit.id, name: hit.name });
    // onChange is the parent's setter and is not memoised; including it would re-run
    // this on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogueReady, results, query, value]);

  const onKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) commit(items[active]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  const Badge = ({ verified, community }) => {
    if (verified) return <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: '#2dd4bf', background: 'rgba(20,184,166,0.12)' }}><ShieldCheck className="w-3 h-3" /> {t('listProperty.society.verified')}</span>;
    if (community) return <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: '#fbbf24', background: 'rgba(251,191,36,0.12)' }}>{t('listProperty.society.unverified')}</span>;
    return null;
  };

  return (
    <div ref={rootRef} className={`pn-dropdown ${open ? 'is-open' : ''}`} style={{ position: 'relative' }}>
      <input
        value={query}
        maxLength={60}
        onChange={(e) => onType(e.target.value)}
        onFocus={() => { focusedRef.current = true; setOpen(true); }}
        onBlur={() => { focusedRef.current = false; }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        data-err={dataErr}
        placeholder={placeholder || t('listProperty.society.placeholder')}
        className={`${fld} ${invalid ? 'pn-invalid' : ''}`}
      />

      {open && (
        <div className="pn-dropdown__menu" role="listbox" id={listId} aria-label={t('listProperty.society.groupHeading')}>
          {results.length > 0 && <div className="pn-dropdown__group">{t('listProperty.society.groupHeading')}</div>}
          {results.map((s, i) => (
            <button
              type="button"
              key={s.id}
              role="option"
              aria-selected={s.id === value}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(s)}
              className={`pn-dropdown__option ${i === active ? 'is-active' : ''}`}
            >
              <span className="opt-label" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                <Badge verified={s.verified} community={s.community} />
              </span>
              {s.id === value ? <Check className="opt-check" style={{ opacity: 1, transform: 'scale(1)' }} /> : null}
            </button>
          ))}

          {canCreate && (
            <button
              type="button"
              role="option"
              aria-selected={false}
              onMouseEnter={() => setActive(results.length)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={createSociety}
              className={`pn-dropdown__option ${active === results.length ? 'is-active' : ''}`}
            >
              <Plus className="opt-icon" />
              <span className="opt-label">{t('listProperty.society.addOption', { name: query.trim() })}</span>
            </button>
          )}

          {results.length === 0 && !canCreate && <div className="pn-dropdown__empty">{t('listProperty.society.empty')}</div>}
        </div>
      )}

      {value && meta && (
        <p className="mt-1 text-xs" style={{ color: meta.verified ? '#2dd4bf' : '#fbbf24' }}>
          {meta.verified
            ? t('listProperty.society.verifiedNote')
            : t('listProperty.society.pendingNote')}
        </p>
      )}
    </div>
  );
}
