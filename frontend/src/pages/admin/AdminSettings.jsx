import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router';
import { Save, Download, Trash2, History, AlertTriangle } from 'lucide-react';
import { getSettings, updateSettings, logAudit, listAudit, clearAudit } from '../../lib/mockApi.js';
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

export default function AdminSettings() {
  const { toast } = useToast();
  const { adminFlags, setFlag } = useAdminFlags();
  const [settings, setSettings] = useState(null);
  const [tab, setTab] = useTabParam(['general', 'fees', 'maps', 'flags', 'audit'], 'general');
  const [flagSubTab, setFlagSubTab] = useState('application');
  const [audit, setAudit] = useState([]);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    let alive = true;
    getSettings().then((s) => alive && setSettings(s));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (tab === 'audit') setAudit(listAudit());
  }, [tab]);

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
        setFlag(section, key, value);
        toast(`${label} ${value ? 'enabled' : 'disabled'}`, 'toggle');
      },
    });
  }, [setFlag, toast]);

  if (!settings) return <Loading />;

  const setSite = (k, v) => setSettings((s) => ({ ...s, site: { ...s.site, [k]: v } }));
  const setFee = (k, v) => setSettings((s) => ({ ...s, fees: { ...s.fees, [k]: Number(v) || 0 } }));

  const saveSite = async () => {
    await updateSettings({ site: settings.site });
    logAudit('Site settings', 'Updated branding / contact / legal details');
    toast('Site details saved', 'success');
  };
  const saveFees = async () => {
    await updateSettings({ fees: settings.fees });
    logAudit('Platform charges', 'Updated platform charges & fee schedule');
    toast('Fee schedule saved', 'success');
  };

  // Move-in Pack: admin-owned prices + launch toggle (consumer /services reads settings.movePack).
  const movePack = settings.movePack || { enabled: false, items: {} };
  const setMovePackItem = (k, v) => setSettings((s) => ({ ...s, movePack: { ...movePack, items: { ...movePack.items, [k]: Number(v) || 0 } } }));
  const setMovePackEnabled = (v) => setSettings((s) => ({ ...s, movePack: { ...movePack, enabled: v } }));
  const saveMovePack = async () => {
    await updateSettings({ movePack: settings.movePack });
    logAudit('Move-in Pack', `Saved prices; status: ${movePack.enabled ? 'Live' : 'Coming soon'}`);
    toast('Move-in Pack saved', 'success');
  };

  // Google Places geo policy (city limit + blacklist) — persisted to settings.geo
  // and read live by lib/geoConfig.js across every locality search in the app.
  const saveGeo = (nextGeo, detail) => {
    setSettings((s) => ({ ...s, geo: nextGeo }));
    updateSettings({ geo: nextGeo });
    logAudit('Maps & Places', detail || 'Updated geo policy');
    toast(detail || 'Maps settings saved', 'success');
  };

  // Confirmation-gated app flag toggle
  const requestAppFlagToggle = (k) => {
    const nextVal = !settings.flags[k];
    setConfirm({
      title: `${nextVal ? 'Enable' : 'Disable'} ${humanize(k)}?`,
      message: `This will ${nextVal ? 'enable' : 'disable'} "${humanize(k)}" across the platform.`,
      danger: !nextVal,
      confirmLabel: nextVal ? 'Enable' : 'Disable',
      action: () => {
        const flags = { ...settings.flags, [k]: nextVal };
        setSettings((s) => ({ ...s, flags }));
        updateSettings({ flags });
        logAudit('App flag', `${humanize(k)} ${nextVal ? 'enabled' : 'disabled'}`);
        toast(`${humanize(k)} ${nextVal ? 'enabled' : 'disabled'}`, 'toggle');
      },
    });
  };

  const handleConfirm = () => { confirm?.action(); setConfirm(null); if (tab === 'audit') setAudit(listAudit()); };
  const handleCancel = () => setConfirm(null);

  const exportAudit = () => {
    const log = listAudit();
    if (!log.length) { toast('Nothing to export'); return; }
    exportCsv('punenest-audit-log.csv', ['When', 'User', 'Action', 'Detail'], log.map((a) => [a.at, a.who, a.action, a.detail]));
    toast('Audit log exported');
  };
  const wipeAudit = () => {
    if (!listAudit().length) { toast('Audit log is already empty'); return; }
    clearAudit();
    setAudit([]);
    toast('Audit log cleared');
  };

  const auditCols = [
    { key: 'at', header: 'When', className: 'whitespace-nowrap text-gray-400', render: (a) => new Date(a.at).toLocaleString('en-IN') },
    { key: 'who', header: 'User', render: (a) => <span className="font-semibold text-gray-200">{a.who}</span> },
    {
      key: 'action',
      header: 'Action',
      render: (a) => (
        <span className="inline-block rounded-md border border-indigo-400/25 bg-indigo-500/15 px-2 py-0.5 text-[0.68rem] font-bold uppercase tracking-wide text-indigo-300">
          {a.action}
        </span>
      ),
    },
    { key: 'detail', header: 'Detail', className: 'text-gray-300' },
  ];

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
        <div className="pn-card max-w-2xl p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {SITE_FIELDS.map(([k, label]) => (
              <label key={k} className="text-sm">
                <span className="mb-1 block text-gray-400">{label}</span>
                <input value={settings.site[k] ?? ''} onChange={(e) => setSite(k, e.target.value)} className="pn-input" />
              </label>
            ))}
          </div>
          <button onClick={saveSite} className="pn-btn pn-btn-primary mt-5">
            <Save className="h-4 w-4" /> Save details
          </button>
        </div>
      )}

      {/* Fees */}
      {tab === 'fees' && (
        <div className="max-w-xl space-y-5">
          <div className="pn-card p-5">
            <div className="space-y-3">
              {Object.entries(settings.fees).map(([k, v]) => (
                <label key={k} className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-gray-300">{humanize(k)}</span>
                  <div className="flex items-center gap-1">
                    {!k.toLowerCase().includes('percent') && <span className="text-gray-500">&#8377;</span>}
                    <input type="number" value={v} onChange={(e) => setFee(k, e.target.value)} className="pn-input w-32 text-right" />
                    {k.toLowerCase().includes('percent') && <span className="text-gray-500">%</span>}
                  </div>
                </label>
              ))}
            </div>
            <button onClick={saveFees} className="pn-btn pn-btn-primary mt-5">
              <Save className="h-4 w-4" /> Save fees
            </button>
          </div>

          {/* Move-in Pack — prices + launch toggle for the consumer /services bundle */}
          <div className="pn-card p-5">
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
                    <input type="number" value={movePack.items?.[k] ?? 0} onChange={(e) => setMovePackItem(k, e.target.value)} className="pn-input w-32 text-right" />
                  </div>
                </label>
              ))}
            </div>
            <button onClick={saveMovePack} className="pn-btn pn-btn-primary mt-5">
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
          <MapsGeoPanel geo={settings.geo || {}} onSave={saveGeo} />
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
              <p className="text-xs text-gray-400">Recent admin actions (verification, settings, flags &amp; data).</p>
            </div>
            <div className="flex gap-2">
              <button onClick={exportAudit} className="pn-btn pn-btn-ghost">
                <Download className="h-4 w-4" /> Export CSV
              </button>
              <button onClick={wipeAudit} className="pn-btn pn-btn-ghost text-red-300">
                <Trash2 className="h-4 w-4" /> Clear
              </button>
            </div>
          </div>
          <Table
            columns={auditCols}
            rows={audit}
            rowKey={(a) => a.id}
            pageSize={12}
            label="entries"
            empty={
              <span className="inline-flex items-center gap-2 text-gray-500">
                <History className="h-4 w-4" /> No changes logged yet.
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
