import { useEffect, useMemo, useRef, useState, useId } from 'react';
import { Check, ShieldCheck, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { mintSociety } from '../../../services/societyService.js';
import { useSocietySearch } from '../../../lib/useSocietySearch.js';
import { cleanText } from './sanitize.js';
import { fld } from './styles.js';

/* Every listing binds to a real society entity rather than a raw string, and an unmatched name mints one
   inline, so the listing funnel doubles as society acquisition. `mintOrigin` tells ops it came from a seller. */
const norm = (s) => String(s || '').trim().toLowerCase();

export default function SocietySelect({
  value, name, onChange,
  localityLabel = '', lat = null, lng = null,
  placeholder, invalid = false, dataErr = 'society',
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(name || '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [meta, setMeta] = useState(null); // { verified, community } of the bound society
  // The mint is a round trip now, so the create row can be pressed twice — once by the mouse and
  // once by an Enter that lands before the first answer — and each press is a society.
  const [minting, setMinting] = useState(false);
  const [mintFailed, setMintFailed] = useState(false);
  const rootRef = useRef(null);
  const focusedRef = useRef(false);
  const listId = useId();

  // Keep the visible text in sync when the form is reset/prefilled externally
  // (edit flow), but never fight the user while they're typing.
  useEffect(() => {
    if (!focusedRef.current) setQuery(name || '');
  }, [name]);

  // Dedup is only as good as the catalogue searched, so the create row waits on the server: a
  // society somebody else added is invisible to a local catalogue, and "Add" would mint a duplicate.
  const { rows: results, loading } = useSocietySearch(query, localityLabel, open);
  const searched = !loading;
  const exact = useMemo(() => results.find((r) => norm(r.name) === norm(query)) || null, [results, query]);
  // `!exact` is only trustworthy once a search has answered: until then every name looks unknown
  // and a fast typist would accept a mint of a society that already exists.
  const canCreate = searched && query.trim().length >= 2 && !exact;
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

  const createSociety = async () => {
    // Belt and braces with `canCreate`: Enter commits `items[active]`, and a list that shrinks as a
    // newer search lands can leave `active` pointing where the create row sat.
    if (!searched || minting) return;
    setMinting(true);
    setMintFailed(false);
    let out;
    try {
      out = await mintSociety({
        name: query.trim(),
        localityLabel: localityLabel || undefined,
        lat: lat ?? undefined,
        lng: lng ?? undefined,
        mintOrigin: 'listing',
      });
    } catch {
      /* Say so rather than close the menu on a society that does not exist: the failure is now a network
         the owner can retry, not the unsluggable name the old synchronous write could only fail on. */
      setMinting(false);
      setMintFailed(true);
      return;
    }
    setMinting(false);
    const rec = out?.society;
    if (!rec) { setMintFailed(true); return; }
    setQuery(rec.name);
    // The server answers the canonical row — 200 when the name already matched one, 201 when it
    // minted — so trust the record rather than assuming what we asked for was created.
    const community = rec.source === 'community';
    setMeta({ verified: !community && !!(rec.registration && rec.conveyance), community });
    onChange({ id: rec.id, name: rec.name });
    setOpen(false);
  };

  const commit = (item) => (item.create ? createSociety() : pickSociety(item));

  const onType = (raw) => {
    const v = cleanText(raw);
    setQuery(v);
    setOpen(true);
    setActive(0);
    setMintFailed(false);
    // Auto-bind on an exact name match, otherwise keep the name but drop the id so we never claim
    // a listing belongs to a society the user didn't pick. The effect below repairs a late match.
    const hit = results.find((r) => norm(r.name) === norm(v));
    onChange({ id: hit ? hit.id : '', name: v });
  };

  /* Re-attempt the bind once a search settles: typing an exact name before the read lands leaves
     `value` empty and nothing else re-derives it, so the listing would persist with no societyId. */
  useEffect(() => {
    if (!searched || value || !query.trim()) return;
    const hit = results.find((r) => norm(r.name) === norm(query));
    // Repair the binding only: `norm` ignores case and spacing, so `hit.name` can differ
    // cosmetically from text the owner never asked to have respelled.
    if (hit) onChange({ id: hit.id, name: query });
    // `onChange` is the parent's unmemoised setter; including it re-runs this every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, results, query, value]);

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
    <div ref={rootRef} className={`dz-dropdown ${open ? 'is-open' : ''}`} style={{ position: 'relative' }}>
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
        className={`${fld} ${invalid ? 'dz-invalid' : ''}`}
      />

      {open && (
        <div className="dz-dropdown__menu" role="listbox" id={listId} aria-label={t('listProperty.society.groupHeading')}>
          {results.length > 0 && <div className="dz-dropdown__group">{t('listProperty.society.groupHeading')}</div>}
          {results.map((s, i) => (
            <button
              type="button"
              key={s.id}
              role="option"
              aria-selected={s.id === value}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(s)}
              className={`dz-dropdown__option ${i === active ? 'is-active' : ''}`}
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
              disabled={minting}
              data-testid="society-add-option"
              className={`dz-dropdown__option ${active === results.length ? 'is-active' : ''}`}
            >
              <Plus className="opt-icon" />
              <span className="opt-label">
                {minting
                  ? t('listProperty.society.adding')
                  : t('listProperty.society.addOption', { name: query.trim() })}
              </span>
            </button>
          )}

          {mintFailed && (
            <div className="dz-dropdown__empty" role="alert" data-testid="society-add-failed">
              {t('listProperty.society.addFailed')}
            </div>
          )}

          {results.length === 0 && !canCreate && <div className="dz-dropdown__empty">{t('listProperty.society.empty')}</div>}
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
