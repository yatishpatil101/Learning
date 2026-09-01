import { useState, useEffect, useRef, useId } from 'react';
import { Globe, MapPin, Ban, Plus, Trash2, RotateCcw, Save, Search, Loader2 } from 'lucide-react';
import { classNames } from '../../../lib/format.js';
import { CITY_GEO, DEFAULT_CITY, cityLiveFrom } from '../../../lib/geoConfig.js';
import { fetchAdminSuggestions, newAutocompleteSession } from '../../../lib/places.js';
import Switch from '../../../components/ui/Switch.jsx';
import MapBoundaryEditor from './MapBoundaryEditor.jsx';

/* Admin control for the Google Places geo policy (persisted to settings.geo) plus the curated
   city roster's launch state (persisted through the city catalogue). Mirrors lib/geoConfig.js:
   an app-wide "city limit" toggle, per-city map centre + bounding box overrides, and a blacklist
   of localities/societies to hide from every Places suggestion box across the app. Consumer
   autocomplete reads this live. */

const num = (v) => (v === '' || v == null ? '' : String(v));
const toNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// Effective values for a city = admin override merged over the built-in default.
function cityValues(geo, city) {
  const base = CITY_GEO[city] || CITY_GEO[DEFAULT_CITY];
  const ov = (geo.cities && geo.cities[city]) || {};
  return { center: ov.center || base.center, bounds: ov.bounds || base.bounds };
}

const BOUND_FIELDS = [['north', 'North'], ['south', 'South'], ['east', 'East'], ['west', 'West']];

/* Exact-place blacklist search. Reuses the admin (unrestricted, un-fenced) Places search
   so an operator can pick a SPECIFIC place — the entry stores its placeId, which
   isBlacklisted matches exactly, avoiding the false positives a short free-text term causes. */
function BlacklistPlaceSearch({ onPick }) {
  const [q, setQ] = useState('');
  const [suggs, setSuggs] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const listId = useId();
  const tokenRef = useRef(null);
  const boxRef = useRef(null);
  const reqRef = useRef(0);

  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setSuggs([]); setOpen(false); setLoading(false); return undefined; }
    setLoading(true);
    const id = ++reqRef.current;
    const t = setTimeout(async () => {
      if (!tokenRef.current) tokenRef.current = newAutocompleteSession();
      const list = await fetchAdminSuggestions(s, tokenRef.current);
      if (id !== reqRef.current) return;
      setSuggs(list);
      setOpen(list.length > 0);
      setLoading(false);
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const pick = (s) => {
    onPick({ placeId: s.placeId, term: s.mainText, note: s.secondaryText || '' });
    tokenRef.current = null;
    setQ(''); setSuggs([]); setOpen(false);
  };

  return (
    <div className="relative" ref={boxRef}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => { if (suggs.length) setOpen(true); }}
          placeholder="Search an exact place to blacklist (any city)…"
          className="pn-input pl-9"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          autoComplete="off"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-brand-teal" />}
      </div>
      {open && suggs.length > 0 && (
        <ul className="pn-ac-list" role="listbox" id={listId}>
          {suggs.map((s) => (
            <li
              key={s.placeId}
              role="option"
              aria-selected={false}
              className="pn-ac-item"
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
            >
              <MapPin className="pn-ac-pin" />
              <span className="pn-ac-text">
                <span className="pn-ac-main">{s.mainText}</span>
                {s.secondaryText && <span className="pn-ac-sub">{s.secondaryText}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MapsGeoPanel({
  geo = {}, cities = [], citiesUnavailable = false, pendingCity = null, onSave, onToggleCityLive,
}) {
  const [city, setCity] = useState(DEFAULT_CITY);
  const [center, setCenter] = useState({ lat: '', lng: '' });
  const [bounds, setBounds] = useState({ north: '', south: '', east: '', west: '' });
  const [term, setTerm] = useState('');
  const [note, setNote] = useState('');

  // No client-side stand-in for the roster. The server owns it, and `slug` — which the write path
  // uses as the key — cannot be derived from a display name without guessing. An empty list renders
  // the "roster unavailable" notice below instead of a row of pills whose toggles would silently
  // do nothing.
  const cityRows = cities;
  const enforce = geo.enforceCityLimit !== false;
  const blacklist = Array.isArray(geo.blacklist) ? geo.blacklist : [];
  const cityOverride = (geo.cities && geo.cities[city]) || {};
  const { live: _staleLive, ...mapOverride } = cityOverride;
  const hasOverride = !!(mapOverride.center || mapOverride.bounds);
  const cityIsLive = cityLiveFrom(cityRows, city);
  const selectedRow = cityRows.find((row) => row.name === city);
  const togglePending = !!pendingCity;
  const canToggleLive = !!selectedRow && !!onToggleCityLive && !togglePending;

  useEffect(() => {
    if (cityRows.length && !cityRows.some((row) => row.name === city)) {
      setCity(cityRows[0]?.name || DEFAULT_CITY);
    }
  }, [city, cityRows]);

  // Numeric view of the editable form, shared with the visual map editor.
  const centerNum = { lat: toNum(center.lat), lng: toNum(center.lng) };
  const boundsNum = {
    north: toNum(bounds.north), south: toNum(bounds.south),
    east: toNum(bounds.east), west: toNum(bounds.west),
  };

  // Sync the editable form whenever the selected city (or its persisted override) changes.
  useEffect(() => {
    const v = cityValues(geo, city);
    setCenter({ lat: num(v.center.lat), lng: num(v.center.lng) });
    setBounds({
      north: num(v.bounds.north), south: num(v.bounds.south),
      east: num(v.bounds.east), west: num(v.bounds.west),
    });
  }, [city, geo]);

  // The map editor edits the same center/bounds the numeric inputs do.
  const applyGeo = ({ center: c, bounds: b }) => {
    if (c) setCenter({ lat: num(c.lat), lng: num(c.lng) });
    if (b) setBounds({ north: num(b.north), south: num(b.south), east: num(b.east), west: num(b.west) });
  };

  const saveCity = () => {
    const c = { lat: toNum(center.lat), lng: toNum(center.lng) };
    const b = {
      north: toNum(bounds.north), south: toNum(bounds.south),
      east: toNum(bounds.east), west: toNum(bounds.west),
    };
    if (c.lat == null || c.lng == null || Object.values(b).some((x) => x == null)) return;
    onSave({ ...geo, cities: { ...(geo.cities || {}), [city]: { ...mapOverride, center: c, bounds: b } } }, `Updated ${city} map coverage`);
  };

  const resetCity = () => {
    const cur = { ...mapOverride };
    delete cur.center;
    delete cur.bounds;
    const nextCities = { ...(geo.cities || {}) };
    if (Object.keys(cur).length) nextCities[city] = cur;
    else delete nextCities[city];
    onSave({ ...geo, cities: nextCities }, `Reset ${city} map coverage to default`);
  };

  const toggleEnforce = () => onSave({ ...geo, enforceCityLimit: !enforce }, `City limit ${!enforce ? 'enabled' : 'disabled'}`);

  // Per-city launch status. Flipping "live" flows to the navbar dropdown + waitlist chrome.
  // Keyed by the server's `slug`, never by the display name, so this cannot fire against a row the
  // roster does not actually contain.
  const toggleLive = (name) => {
    const target = cityRows.find((row) => row.name === name);
    if (!target || !onToggleCityLive || togglePending) return;
    void onToggleCityLive(target, !target.live);
  };

  const addBlacklist = () => {
    const t = term.trim();
    if (t.length < 2) return;
    const entry = { id: 'bl' + Date.now().toString(36), term: t, note: note.trim(), at: Date.now() };
    onSave({ ...geo, blacklist: [entry, ...blacklist] }, `Blacklisted "${t}"`);
    setTerm('');
    setNote('');
  };

  // Blacklist a specific place picked from Google — stored with its placeId for an exact
  // match (no substring false positives). Skips duplicates by placeId.
  const addBlacklistPlace = ({ placeId, term: placeTerm, note: placeNote }) => {
    if (!placeId || blacklist.some((b) => b.placeId === placeId)) return;
    const entry = { id: 'bl' + Date.now().toString(36), placeId, term: placeTerm, note: placeNote, at: Date.now() };
    onSave({ ...geo, blacklist: [entry, ...blacklist] }, `Blacklisted "${placeTerm}"`);
  };

  const removeBlacklist = (id) => {
    const term = blacklist.find((b) => b.id === id)?.term || id;
    onSave({ ...geo, blacklist: blacklist.filter((b) => b.id !== id) }, `Removed blacklist "${term}"`);
  };

  return (
    <div className="space-y-5">
      {/* City limit toggle */}
      <div className="pn-card p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-brand-teal" />
              <h3 className="text-sm font-bold text-white">Restrict Places to the selected city</h3>
            </div>
            <p className="mt-1 text-xs text-gray-400 leading-relaxed">
              When on, every locality / area / society search box across the app only suggests
              places inside the shopper&rsquo;s selected city bounds. Off = results are merely
              biased toward the city (Google may surface places elsewhere).
            </p>
          </div>
          <Switch checked={enforce} onChange={toggleEnforce} label="Restrict Places to selected city" />
        </div>
      </div>

      {/* Per-city coverage */}
      <div className="pn-card p-5">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-brand-teal" />
          <h3 className="text-sm font-bold text-white">City coverage</h3>
        </div>
        <p className="mt-1 mb-4 text-xs text-gray-400">Map centre and bounding box used to centre maps and bound Places suggestions.</p>

        {/* City selector pills — colour dot shows launch status (green = live), with a text
            equivalent for anyone who cannot see the colour. */}
        <div className="mb-5 flex flex-wrap gap-2">
          {cityRows.map((c) => (
            <button
              key={c.slug || c.name}
              type="button"
              aria-pressed={c.name === city}
              onClick={() => setCity(c.name)}
              className={classNames(
                'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition',
                c.name === city ? 'border-brand-teal/40 bg-brand-teal/10 text-brand-teal' : 'border-white/10 bg-white/5 text-gray-300 hover:text-white',
              )}
            >
              <span
                aria-hidden="true"
                className={classNames('inline-block h-2 w-2 rounded-full', c.live ? 'bg-emerald-400' : 'bg-gray-500')}
              />
              {c.name}
              <span className="sr-only">{c.live ? ' — live' : ' — coming soon'}</span>
            </button>
          ))}
        </div>

        {citiesUnavailable && (
          <p className="mb-5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-200">
            The city roster could not be loaded, so launch status cannot be shown or changed.
            Map coverage and the blacklist below still save normally. Reload to try again.
          </p>
        )}

        {/* Launch status for the selected city */}
        {selectedRow && (
        <div className="mb-5 flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className={classNames('grid h-8 w-8 shrink-0 place-items-center rounded-lg', cityIsLive ? 'bg-emerald-500/15' : 'bg-gray-500/15')}>
              <span className={classNames('h-2.5 w-2.5 rounded-full', cityIsLive ? 'bg-emerald-400' : 'bg-gray-400')} />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">
                {city} is {cityIsLive ? 'live' : 'coming soon'}
              </div>
              <p className="text-xs text-gray-500">
                {cityIsLive
                  ? 'Shoppers can select this city and browse its listings.'
                  : 'Shoppers see a “join the waitlist” prompt instead of listings.'}
              </p>
            </div>
          </div>
          <Switch
            checked={cityIsLive}
            disabled={!canToggleLive}
            onChange={() => toggleLive(city)}
            label={`Set ${city} live`}
          />
        </div>
        )}

        {/* Visual boundary editor — drag/search to set the box; syncs with the fields below. */}
        <div className="mb-5">
          <MapBoundaryEditor center={centerNum} bounds={boundsNum} onChange={applyGeo} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-gray-400">Centre latitude</span>
            <input value={center.lat} onChange={(e) => setCenter((s) => ({ ...s, lat: e.target.value }))} inputMode="decimal" className="pn-input" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-400">Centre longitude</span>
            <input value={center.lng} onChange={(e) => setCenter((s) => ({ ...s, lng: e.target.value }))} inputMode="decimal" className="pn-input" />
          </label>
          {BOUND_FIELDS.map(([k, label]) => (
            <label key={k} className="text-sm">
              <span className="mb-1 block text-gray-400">{label} bound</span>
              <input value={bounds[k]} onChange={(e) => setBounds((s) => ({ ...s, [k]: e.target.value }))} inputMode="decimal" className="pn-input" />
            </label>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button onClick={saveCity} className="pn-btn pn-btn-primary">
            <Save className="h-4 w-4" /> Save {city} coverage
          </button>
          {hasOverride ? (
            <button onClick={resetCity} className="pn-btn pn-btn-ghost">
              <RotateCcw className="h-4 w-4" /> Reset to default
            </button>
          ) : (
            <span className="text-xs text-gray-500">Using built-in default</span>
          )}
        </div>
      </div>

      {/* Blacklist */}
      <div className="pn-card p-5">
        <div className="flex items-center gap-2">
          <Ban className="h-4 w-4 text-rose-400" />
          <h3 className="text-sm font-bold text-white">Blacklisted localities &amp; societies</h3>
        </div>
        <p className="mt-1 mb-4 text-xs text-gray-400">
          Any Places suggestion whose name contains one of these terms is hidden everywhere in the app
          (consumer search, filters, list-property, and society pickers).
        </p>

        {/* Exact-place blacklist (recommended) — pick a specific place so only IT is hidden. */}
        <div className="mb-3">
          <BlacklistPlaceSearch onPick={addBlacklistPlace} />
        </div>

        {/* Free-text term fallback. */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addBlacklist(); }}
            placeholder="…or a name/term to hide (matches any place containing it)"
            className="pn-input flex-1"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addBlacklist(); }}
            placeholder="Reason (optional)"
            className="pn-input flex-1"
          />
          <button onClick={addBlacklist} disabled={term.trim().length < 2} className="pn-btn pn-btn-primary shrink-0 disabled:opacity-50">
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
        <p className="mt-2 text-[11px] text-gray-500">
          Tip: a short term hides <em>every</em> place whose name contains it (e.g. “Camp” also hides
          “Camp Road”). Prefer the exact-place search above when you mean one specific place.
        </p>

        <div className="mt-4 space-y-2">
          {blacklist.length === 0 ? (
            <p className="text-xs text-gray-500">No blacklisted terms yet.</p>
          ) : (
            blacklist.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-gray-200">{b.term}</span>
                  {b.placeId ? (
                    <span className="ml-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-brand-teal" style={{ background: 'rgba(20,184,166,0.12)' }}>
                      <MapPin className="h-3 w-3" /> exact place
                    </span>
                  ) : null}
                  {b.note ? <span className="ml-2 text-xs text-gray-500">— {b.note}</span> : null}
                </div>
                <button onClick={() => removeBlacklist(b.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-gray-400 hover:bg-rose-500/10 hover:text-rose-300 transition" aria-label={`Remove ${b.term}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
