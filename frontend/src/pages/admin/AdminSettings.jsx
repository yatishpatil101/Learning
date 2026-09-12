import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router';
import { Save, Download, History, AlertTriangle } from 'lucide-react';
import { listCities, updateCityLive } from '../../services/cityService.js';
import { onGeoChange } from '../../lib/geoConfig.js';
import { getSettings, updateSettings } from '../../services/settingsService.js';
import { listAuditLog } from '../../services/auditService.js';
import { classNames } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useTabParam } from '../../lib/useTabParam.js';
import Switch from '../../components/ui/Switch.jsx';
import Table from '../../components/ui/Table.jsx';
import Loading from '../../components/ui/Loading.jsx';
import AdminFlagsPanel from './settings/AdminFlagsPanel.jsx';
import AppFlagsPanel from './settings/AppFlagsPanel.jsx';
import MapsGeoPanel from './settings/MapsGeoPanel.jsx';

/* ─── Confirmation Dialog ─── */
function ConfirmDialog({ open, title, message, onConfirm, onCancel, confirmLabel = 'Confirm', danger }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-ink-2 p-6 shadow-2xl animate-slideIn">
        <div className="flex items-start gap-3 mb-4">
          <span className={classNames('mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl', danger ? 'bg-rose-500/15' : 'bg-amber-500/15')}>
            <AlertTriangle className={classNames('h-4.5 w-4.5', danger ? 'text-rose-400' : 'text-amber-400')} />
          </span>
          <div>
            <h3 className="text-sm font-bold text-white">{title}</h3>
            <p className="text-sm text-gray-400 mt-1 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-xl px-4 py-2 text-sm font-medium text-gray-300 hover:bg-white/5 transition-colors">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={classNames('rounded-xl px-4 py-2 text-sm font-semibold transition-colors', danger ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30' : 'bg-brand-teal/20 text-brand-teal hover:bg-brand-teal/30')}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const TABS = [['general', 'General'], ['fees', 'Fees'], ['maps', 'Maps'], ['flags', 'Feature flags'], ['audit', 'Audit log']];

/**
 * First segment of a UUID, for a column that must show an identifier. Nothing is lost: the full
 * value is on the element's `title` and in the CSV export.
 */
const shortId = (id) => {
  const s = String(id || '');
  return s.length > 8 ? `${s.slice(0, 8)}…` : s;
};

/**
 * The audit row's `metadata` rendered as one line — what the server sent, not a sentence about it.
 * `from`/`to` lead because that is the pair a reader is looking for.
 */
const describe = (metadata) => {
  if (!metadata || typeof metadata !== 'object') return '';
  const parts = [];
  if (metadata.from !== undefined || metadata.to !== undefined) {
    parts.push(`${metadata.from ?? '—'} → ${metadata.to ?? '—'}`);
  }
  for (const [k, v] of Object.entries(metadata)) {
    if (k === 'from' || k === 'to') continue;
    if (v === null || v === undefined || v === '') continue;
    parts.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
  return parts.join(', ');
};

const SITE_FIELDS = [
  ['name', 'Site name'],
  ['legalName', 'Legal name'],
  ['tagline', 'Tagline'],
  ['supportEmail', 'Support email'],
  ['supportPhone', 'Support phone'],
  ['whatsapp', 'WhatsApp'],
  ['supportHours', 'Support hours'],
  ['address', 'Address'],
  ['gst', 'GST number'],
];

const MOVE_PACK_LABELS = {
  movers: 'Packers & Movers',
  clean: 'Deep Cleaning',
  agreement: 'Rent Agreement (registered)',
  paint: 'Painting touch-up',
  verify: 'Tenant/Owner Verification',
  internet: 'Wi-Fi & utilities setup',
};

const humanize = (k) =>
  k
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace('S a a S', 'SaaS')
    .replace('Sms', 'SMS')
    .replace('Emi', 'EMI');

/**
 * Alphabetical, not live-first the way `GET /cities` serves it: re-sorting on `live` would move a
 * pill out from under the operator's cursor the instant they toggled it (WCAG 3.2.2).
 */
const sortCities = (rows = []) => [...rows].sort(
  (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
);

function stripGeoLive(geo = {}) {
  const { cities: _oldCities, ...restGeo } = geo;
  const cities = geo.cities && typeof geo.cities === 'object'
    ? Object.fromEntries(
      Object.entries(geo.cities)
        .filter(([, value]) => value && typeof value === 'object')
        .map(([name, value]) => {
          const { live: _live, ...rest } = value;
          return [name, rest];
        })
        .filter(([, value]) => Object.keys(value).length),
    )
    : undefined;
  return {
    ...restGeo,
    ...(cities ? { cities } : {}),
  };
}

export default function AdminSettings() {
  const { toast } = useToast();
  const { adminFlags, setFlag } = useAdminFlags();
  const [settings, setSettings] = useState(null);
  const [cityRoster, setCityRoster] = useState([]);
  const [cityRosterError, setCityRosterError] = useState(false);
  const [pendingCity, setPendingCity] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useTabParam(['general', 'fees', 'maps', 'flags', 'audit'], 'general');
  const [flagSubTab, setFlagSubTab] = useState('application');
  const [audit, setAudit] = useState([]);
  const [auditError, setAuditError] = useState('');
  /** Bumped to re-ask the server for the trail; see the loader effect. */
  const [reloadAudit, setReloadAudit] = useState(0);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    let alive = true;
    // Without the catch the page sits on `<Loading />` for ever, which reads as a slow server
    // rather than a failed request — on the screen an operator opens when something is wrong.
    getSettings()
      .then((s) => { if (alive) setSettings(s); })
      .catch(() => { if (alive) setLoadError(true); });
    return () => { alive = false; };
  }, []);

  /**
   * `listCities()` and not the cached `geoConfig.getCities()`: that cache falls back to the built-in
   * roster, and a launch toggle built on a guessed `slug` would appear to work.
   */
  const loadCityRoster = useCallback(async () => {
    try {
      const rows = await listCities();
      setCityRoster(sortCities(Array.isArray(rows) ? rows : []));
      setCityRosterError(false);
    } catch {
      setCityRoster([]);
      setCityRosterError(true);
    }
  }, []);

  useEffect(() => { loadCityRoster(); }, [loadCityRoster]);

  /**
   * Re-read on every shared geo-cache refresh: otherwise this component's state is a third copy of
   * the truth that never reconciles with the other two.
   */
  useEffect(() => onGeoChange(loadCityRoster), [loadCityRoster]);

  /**
   * A stable identity for the Maps panel's `geo` prop: an inline `settings.geo || {}` is a new
   * object each render, and the panel re-syncs its form — losing a half-typed bounding box.
   */
  const geo = useMemo(() => settings?.geo || {}, [settings?.geo]);

  /**
   * `reloadAudit` is a counter, so re-confirming an action can ask for a fresh read. A failed fetch
   * must say so: an empty table under "Audit log" reads as "nothing has happened".
   */
  useEffect(() => {
    if (tab !== 'audit') return undefined;
    let live = true;
    setAuditError('');
    listAuditLog({ size: 100 })
      .then((res) => { if (live) setAudit(res.items || []); })
      .catch(() => {
        if (!live) return;
        setAudit([]);
        setAuditError('The audit log could not be loaded. This is not an empty log — reload to try again.');
      });
    return () => { live = false; };
  }, [tab, reloadAudit]);

  // Confirmation-gated admin flag toggle (must be before early return to satisfy Rules of Hooks)
  const requestAdminFlagToggle = useCallback((section, key, value, moduleTitle) => {
    const label = moduleTitle || humanize(key);
    setConfirm({
      title: `${value ? 'Enable' : 'Disable'} ${label}?`,
      message: moduleTitle
        ? `This will ${value ? 'enable' : 'disable'} the entire "${label}" module.`
        : `This will ${value ? 'enable' : 'disable'} "${label}" within this module.`,
      danger: !value,
      confirmLabel: value ? 'Enable' : 'Disable',
      action: () => {
        // The toast waits for the write: reporting a module as disabled when the PUT was rejected
        // is the failure an operator is least likely to check.
        setFlag(section, key, value)
          .then(() => toast(`${label} ${value ? 'enabled' : 'disabled'}`, 'toggle'))
          .catch(() => toast('That change was not saved. Please try again.', 'error'));
      },
    });
  }, [setFlag, toast]);

  if (loadError) {
    return (
      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-6 text-sm text-gray-300">
        <p className="font-semibold text-white">Settings could not be loaded.</p>
        <p className="mt-1 text-gray-400">
          Nothing has been changed. Reload to try again — editing from a document we could not read
          would overwrite the real one.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/15"
        >
          Reload
        </button>
      </div>
    );
  }
  if (!settings) return <Loading />;

  const setSite = (k, v) => setSettings((s) => ({ ...s, site: { ...s.site, [k]: v } }));
  const setFee = (k, v) => setSettings((s) => ({ ...s, fees: { ...s.fees, [k]: Number(v) || 0 } }));

  /* Reports what actually happened, never an unconditional success — the caller applied the value
     optimistically, so the returned boolean is its cue to roll back. Auditing is the server's. */
  const persist = async (patch, okMessage, okKind = 'success') => {
    try {
      await updateSettings(patch);
    } catch {
      toast('That change was not saved. Please try again.', 'error');
      return false;
    }
    toast(okMessage, okKind);
    return true;
  };

  const saveSite = () => persist({ site: settings.site }, 'Site details saved');
  const saveFees = () => persist({ fees: settings.fees }, 'Fee schedule saved');

  // Move-in Pack: admin-owned prices + launch toggle (consumer /services reads settings.movePack).
  const movePack = settings.movePack || { enabled: false, items: {} };
  const setMovePackItem = (k, v) => setSettings((s) => ({ ...s, movePack: { ...movePack, items: { ...movePack.items, [k]: Number(v) || 0 } } }));
  const setMovePackEnabled = (v) => setSettings((s) => ({ ...s, movePack: { ...movePack, enabled: v } }));
  const saveMovePack = () => persist(
    { movePack: settings.movePack },
    'Move-in Pack saved',
  );

  // Google Places geo policy (city limit + blacklist) — persisted to settings.geo
  // and read live by lib/geoConfig.js across every locality search in the app.
  const saveGeo = (nextGeo, detail) => {
    const sanitized = stripGeoLive(nextGeo);
    setSettings((s) => ({ ...s, geo: sanitized }));
    persist(
      { geo: sanitized },
      detail || 'Maps settings saved',
    );
  };

  /**
   * Optimistic, rolling back **only the failed row** — a whole-roster snapshot would clobber a
   * concurrent launch. `pendingCity` keeps a second click out while the first is in flight.
   */
  const saveCityLaunchState = async (city, live) => {
    if (pendingCity) return false;
    setPendingCity(city.slug);
    setCityRoster((rows) => sortCities(rows.map((row) => (
      row.slug === city.slug ? { ...row, live } : row
    ))));
    try {
      await updateCityLive(city.slug, live);
    } catch {
      setCityRoster((rows) => sortCities(rows.map((row) => (
        row.slug === city.slug ? { ...row, live: !live } : row
      ))));
      toast('That change was not saved. Please try again.', 'error');
      return false;
    } finally {
      setPendingCity(null);
    }
    // No `logAudit` here either: `CityAdminService` records `city.update` against the
    // authenticated operator as part of the same write.
    toast(`${city.name} marked ${live ? 'live' : 'coming soon'}`);
    return true;
  };

  // Confirmation-gated app flag toggle
  const requestAppFlagToggle = (k) => {
    const nextVal = !settings.flags[k];
    setConfirm({
      title: `${nextVal ? 'Enable' : 'Disable'} ${humanize(k)}?`,
      message: `This will ${nextVal ? 'enable' : 'disable'} "${humanize(k)}" across the platform.`,
      danger: !nextVal,
      confirmLabel: nextVal ? 'Enable' : 'Disable',
      action: async () => {
        setSettings((s) => ({ ...s, flags: { ...s.flags, [k]: nextVal } }));
        // Only the flag that changed, for the reason `AdminFlagsContext.setFlag` gives: a whole
        // block re-asserts values this handler never read.
        const saved = await persist(
          { flags: { [k]: nextVal } },
          `${humanize(k)} ${nextVal ? 'enabled' : 'disabled'}`,
          'toggle',
        );
        // Put the switch back one key at a time, for the reason `saveCityLaunchState` gives. These
        // flags are kill switches, so a stale position tells an operator the platform is closed.
        if (!saved) setSettings((s) => ({ ...s, flags: { ...s.flags, [k]: !nextVal } }));
      },
    });
  };

  const handleConfirm = () => {
    confirm?.action();
    setConfirm(null);
    // The confirmed action writes through the API, which writes the audit row; re-ask for the
    // trail rather than appending a guess at what the server recorded.
    if (tab === 'audit') setReloadAudit((n) => n + 1);
  };
  const handleCancel = () => setConfirm(null);

  const exportAudit = () => {
    if (!audit.length) { toast('Nothing to export'); return; }
    exportCsv(
      'draazy-audit-log.csv',
      ['When', 'Actor', 'Role', 'Action', 'Entity', 'Entity ID', 'Details'],
      audit.map((a) => [a.at, a.actor, a.actorRole, a.action, a.entity, a.entityId || '', describe(a.metadata)]),
    );
    toast('Audit log exported');
  };

  /* No "Clear" button: the trail is append-only by construction, so a client-side clear could only
     mislead about whether a compliance record is gone or erasable. */

  const auditCols = [
    { key: 'at', header: 'When', className: 'whitespace-nowrap text-gray-400', render: (a) => new Date(a.at).toLocaleString('en-IN') },
    {
      key: 'actor',
      header: 'Actor',
      /* The id, not a name: `/admin/audit-log` carries `actor` as a UUID only, and a browser-read
         display name would be this session's, not the actor's. See tasks/DECISIONS-NEEDED.md. */
      render: (a) => (
        <span className="block">
          <span className="font-mono text-xs text-gray-300" title={a.actor}>{shortId(a.actor)}</span>
          {a.actorRole ? <span className="ml-2 text-[0.68rem] uppercase tracking-wide text-gray-500">{a.actorRole}</span> : null}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (a) => (
        <span className="inline-block rounded-md border border-indigo-400/25 bg-indigo-500/15 px-2 py-0.5 text-[0.68rem] font-bold uppercase tracking-wide text-indigo-300">
          {a.action}
        </span>
      ),
    },
    {
      key: 'entity',
      header: 'Record',
      className: 'text-gray-300',
      render: (a) => (
        <span className="block">
          <span>{a.entity}</span>
          {a.entityId ? <span className="ml-2 font-mono text-xs text-gray-500" title={a.entityId}>{shortId(a.entityId)}</span> : null}
        </span>
      ),
    },
    { key: 'metadata', header: 'Details', className: 'text-gray-300', render: (a) => describe(a.metadata) },
  ];

  /* Stacked-card fallback below `sm` (see Table.jsx). Read-only log, so the card is
     purely informational — no actions to size up. */
  const auditCard = (a) => (
    <div className="dz-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-xs font-semibold text-gray-200" title={a.actor}>{shortId(a.actor)}</span>
        <span className="shrink-0 rounded-md border border-indigo-400/25 bg-indigo-500/15 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-indigo-300">{a.action}</span>
      </div>
      {a.entity ? (
        <div className="mt-2 text-sm text-gray-300">
          {a.entity}
          {a.entityId ? <span className="ml-2 font-mono text-xs text-gray-500">{shortId(a.entityId)}</span> : null}
        </div>
      ) : null}
      {describe(a.metadata) ? <div className="mt-1 text-sm text-gray-300">{describe(a.metadata)}</div> : null}
      <div className="mt-2 text-xs text-gray-400">{new Date(a.at).toLocaleString('en-IN')}</div>
    </div>
  );

  return (
    <div>
      <PageHeader title="Settings" subtitle="Site details, the fee schedule and feature flags." />

      <div className="mb-5 flex gap-1 overflow-x-auto no-scrollbar rounded-xl border border-white/10 bg-white/5 p-1 sm:overflow-visible">
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={classNames('flex-none whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition sm:flex-1', tab === id ? 'bg-brand-teal text-ink' : 'text-gray-300 hover:text-white')}>
            {label}
          </button>
        ))}
      </div>

      {/* General */}
      {tab === 'general' && (
        <div className="dz-card max-w-2xl p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {SITE_FIELDS.map(([k, label]) => (
              <label key={k} className="text-sm">
                <span className="mb-1 block text-gray-400">{label}</span>
                <input value={settings.site[k] ?? ''} onChange={(e) => setSite(k, e.target.value)} className="dz-input" />
              </label>
            ))}
          </div>
          <button onClick={saveSite} className="dz-btn dz-btn-primary mt-5">
            <Save className="h-4 w-4" /> Save details
          </button>
        </div>
      )}

      {/* Fees */}
      {tab === 'fees' && (
        <div className="max-w-xl space-y-5">
          <div className="dz-card p-5">
            <div className="space-y-3">
              {Object.entries(settings.fees).map(([k, v]) => (
                <label key={k} className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-gray-300">{humanize(k)}</span>
                  <div className="flex items-center gap-1">
                    {!k.toLowerCase().includes('percent') && <span className="text-gray-500">&#8377;</span>}
                    <input type="number" value={v} onChange={(e) => setFee(k, e.target.value)} className="dz-input w-32 text-right" />
                    {k.toLowerCase().includes('percent') && <span className="text-gray-500">%</span>}
                  </div>
                </label>
              ))}
            </div>
            <button onClick={saveFees} className="dz-btn dz-btn-primary mt-5">
              <Save className="h-4 w-4" /> Save fees
            </button>
          </div>

          {/* Move-in Pack — prices + launch toggle for the consumer /services bundle */}
          <div className="dz-card p-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-100">Move-in Pack</h3>
                <p className="text-xs text-gray-400 mt-0.5">Per-service prices for the bundle on the Services page. Keep it &ldquo;Coming soon&rdquo; to hide prices from customers and collect a waitlist, or set it live.</p>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-gray-300">
                <span className={movePack.enabled ? 'text-emerald-400' : 'text-amber-400'}>{movePack.enabled ? 'Live' : 'Coming soon'}</span>
                <Switch checked={!!movePack.enabled} onChange={(v) => setMovePackEnabled(v)} />
              </label>
            </div>
            <div className="space-y-3">
              {Object.keys(MOVE_PACK_LABELS).map((k) => (
                <label key={k} className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-gray-300">{MOVE_PACK_LABELS[k]}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-500">&#8377;</span>
                    <input type="number" value={movePack.items?.[k] ?? 0} onChange={(e) => setMovePackItem(k, e.target.value)} className="dz-input w-32 text-right" />
                  </div>
                </label>
              ))}
            </div>
            <button onClick={saveMovePack} className="dz-btn dz-btn-primary mt-5">
              <Save className="h-4 w-4" /> Save Move-in Pack
            </button>
          </div>
        </div>
      )}

      {/* Maps & Places — Google geo policy: city limit + blacklist */}
      {tab === 'maps' && (
        <div>
          <p className="mb-4 text-sm text-gray-400">
            Control the Google Places API: limit suggestions to the shopper&rsquo;s selected city and
            blacklist localities or societies. Applies to every locality / area search across the app.
          </p>
          <MapsGeoPanel
            geo={geo}
            cities={cityRoster}
            citiesUnavailable={cityRosterError}
            pendingCity={pendingCity}
            onSave={saveGeo}
            onToggleCityLive={saveCityLaunchState}
          />
        </div>
      )}

      {/* Feature Flags — contains sub-tabs for Application and Admin Modules */}
      {tab === 'flags' && (
        <div>
          {/* Sub-tab bar */}
          <div className="mb-4 flex gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1 w-max">
            <button
              onClick={() => setFlagSubTab('application')}
              className={classNames('rounded-md px-3.5 py-1.5 text-sm font-medium transition', flagSubTab === 'application' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-200')}
            >
              Application
            </button>
            <button
              onClick={() => setFlagSubTab('admin')}
              className={classNames('rounded-md px-3.5 py-1.5 text-sm font-medium transition', flagSubTab === 'admin' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-200')}
            >
              Admin Modules
            </button>
          </div>

          {/* Application flags — grouped two-column layout */}
          {flagSubTab === 'application' && (
            <div>
              <p className="mb-4 text-sm text-gray-400">Platform-wide feature toggles that control consumer and app behavior.</p>
              <AppFlagsPanel flags={settings.flags} onToggle={requestAppFlagToggle} />
            </div>
          )}

          {/* Admin Module flags — two-column layout */}
          {flagSubTab === 'admin' && (
            <div>
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-400">
                  Control admin panel features. Disabled modules reduce API cost and simplify the interface.
                </p>
                <div className="flex items-center gap-4 text-[11px] text-gray-500 shrink-0 sm:ml-4">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> Low
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> Med
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-rose-500" /> High
                  </span>
                </div>
              </div>
              <AdminFlagsPanel adminFlags={adminFlags} onToggle={requestAdminFlagToggle} />
            </div>
          )}
        </div>
      )}

      {/* Audit Log */}
      {tab === 'audit' && (
        <div>
          <div className="mb-3 rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-sm text-gray-400">
              Looking for staff operational activity?{' '}
              <Link to="/admin/staff-activity" className="text-brand-teal hover:underline font-medium">
                &rarr; View Staff Activity
              </Link>
            </p>
          </div>
          <div className="mb-3 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h3 className="text-sm font-semibold text-gray-200">Audit log</h3>
              <p className="text-xs text-gray-400">
                The server&rsquo;s append-only record of privileged actions. Read-only &mdash; entries cannot be edited or removed.
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={exportAudit} className="dz-btn dz-btn-ghost">
                <Download className="h-4 w-4" /> Export CSV
              </button>
            </div>
          </div>
          {auditError ? (
            <div className="mb-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-200">
              {auditError}
            </div>
          ) : null}
          <Table
            columns={auditCols}
            rows={audit}
            rowKey={(a) => a.id}
            pageSize={12}
            label="entries"
            mobileCard={auditCard}
            empty={
              <span className="inline-flex items-center gap-2 text-gray-500">
                <History className="h-4 w-4" /> No audited actions recorded yet.
              </span>
            }
          />
        </div>
      )}

      {/* Confirmation dialog for flag changes */}
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        danger={confirm?.danger}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </div>
  );
}
