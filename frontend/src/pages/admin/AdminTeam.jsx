import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Check, Clock, Info, Pencil, Plus, RotateCcw, ShieldCheck, Trash2, UserCog, UsersRound } from 'lucide-react';
/* Team members come through the services seam, so this console talks to the real API when the
   `team` domain is switched on and to a mock that enforces the same refusals when it is not
   (D205). Custom roles and the audit log stay on the mock barrel deliberately: the server has no
   route for either — it refuses `settings.customRoles` outright with 422 (D67) — so there is
   nothing for an http provider to call and pretending otherwise would be the same lie again. */
import {
  listTeamMembers, saveTeamMember, setTeamMemberStatus,
  listPendingApprovals, approveTeamMember,
} from '../../services/teamService.js';
import { listCustomRoles, saveCustomRole, deleteCustomRole, logAudit } from '../../lib/mockApi.js';
import { GRANTABLE_PERMISSIONS, OPS_TEAMS, moduleLabel } from '../../lib/adminModules.js';
import { effectiveModuleKeys } from '../../lib/permissions.js';
import { roleLabel } from '../../lib/auth.js';
import { classNames, isoToDisplay } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Table from '../../components/ui/Table.jsx';
import Select from '../../components/ui/Select.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Loading from '../../components/ui/Loading.jsx';
import HScroll from '../../components/ui/HScroll.jsx';

const ROLE_OPTS = [
  { value: 'manager', label: 'Manager — scoped admin access' },
  { value: 'admin', label: 'Administrator — full access' },
  { value: 'staff', label: 'Ops staff — service portal' },
];

const ROLE_TONE = {
  admin: 'bg-indigo-500/15 text-indigo-300 border-indigo-400/30',
  manager: 'bg-teal-500/15 text-teal-300 border-teal-400/30',
  staff: 'bg-sky-500/15 text-sky-300 border-sky-400/30',
};

const teamLabel = (t) => OPS_TEAMS.find((o) => o.value === t)?.label || t;
const digits10 = (m) => String(m || '').replace(/\D/g, '').slice(-10);

const RolePill = ({ role }) => (
  <span className={classNames('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', ROLE_TONE[role] || 'bg-white/5 text-gray-300 border-white/10')}>
    {roleLabel(role)}
  </span>
);

const StatusPill = ({ status }) => (
  <span className={classNames('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize',
    status === 'active' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30' : 'bg-red-500/15 text-red-300 border-red-400/30')}>
    {status}
  </span>
);

/* Shared checkbox grid used for both per-user module access and custom-role bundles. */
function CheckGrid({ items, isOn, onToggle }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map((m) => {
        const on = isOn(m.value ?? m.key);
        const Icon = m.icon;
        return (
          <label
            key={m.value ?? m.key}
            className={classNames(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition',
              on ? 'border-brand-teal/50 bg-brand-teal/10 text-white' : 'border-white/10 bg-white/[0.03] text-gray-300 hover:bg-white/5',
            )}
          >
            <input type="checkbox" checked={on} onChange={() => onToggle(m.value ?? m.key)} className="h-4 w-4 accent-brand-teal" />
            {Icon ? <Icon className="h-4 w-4 opacity-80" /> : null}
            <span className="truncate">{m.label}</span>
          </label>
        );
      })}
    </div>
  );
}

export default function AdminTeam() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [tab, setTab] = useState('members');
  const [members, setMembers] = useState(null);
  const [pending, setPending] = useState([]);
  const [approving, setApproving] = useState(null);
  const [customRoles, setCustomRoles] = useState([]);
  const [memberModal, setMemberModal] = useState(null); // form object or null
  const [roleModal, setRoleModal] = useState(null);
  const [pendingError, setPendingError] = useState(null);

  /* Every mutation on this page can now be refused by the server, and a refusal an operator never
     sees is indistinguishable from the console's old confident wrong answer. `role_change_unsupported`
     is the one failure this client raises itself, so it is the one with a translated message; the
     rest carry the server's own wording, which names the fix and must not be reworded here. */
  const failed = (err) => toast(
    err?.code === 'role_change_unsupported' ? t('team.errors.roleChangeUnsupported') : (err?.message || t('team.errors.generic')),
    'error',
  );

  const reload = () => Promise.all([listTeamMembers(), listCustomRoles()])
    .then(([m, r]) => { setMembers(m); setCustomRoles(r); })
    .catch(failed);

  /* Admin-only live, unlike the directory read beside it — a scoped manager who can open this page
     can still be refused here. Report that in place rather than showing an empty queue, which would
     read as "nobody is waiting". */
  const reloadPending = () => listPendingApprovals()
    .then((p) => { setPending(p); setPendingError(null); })
    .catch((err) => { setPending([]); setPendingError(err?.message || t('team.errors.generic')); });

  useEffect(() => { reload(); reloadPending(); }, []);

  const roleOptionsForSelect = useMemo(
    () => [{ value: '', label: '— No preset role —' }, ...customRoles.map((r) => ({ value: r.id, label: r.name }))],
    [customRoles],
  );

  const activeAdmins = useMemo(() => (members || []).filter((m) => m.role === 'admin' && m.status === 'active'), [members]);

  const accessSummary = (m) => {
    if (m.role === 'admin') return 'Full access';
    if (m.role === 'staff') return m.teams?.length ? m.teams.map(teamLabel).join(', ') : 'No teams assigned';
    const keys = [...effectiveModuleKeys(m, customRoles)].filter((k) => k !== 'dashboard');
    const roleName = customRoles.find((r) => r.id === m.roleId)?.name;
    const count = keys.length ? `${keys.length} module${keys.length > 1 ? 's' : ''}` : 'Dashboard only';
    return roleName ? `${roleName} · ${count}` : count;
  };

  // ---- Member CRUD ----
  /* New accounts default to Ops staff, not Manager: `manager` is an admin-console permission label
     and not one of the contract's roles (`Role = buyer|owner|staff|admin`), so a live create with it
     is refused. Defaulting to a role that cannot be created would make the primary action fail. */
  const openNewMember = () => setMemberModal({ id: null, name: '', mobile: '', email: '', role: 'staff', roleId: '', moduleAccess: [], teams: [], status: 'active' });
  const openEditMember = (m) => setMemberModal({ id: m.id, name: m.name || '', mobile: m.mobile || '', email: m.email || '', role: m.role || 'manager', roleId: m.roleId || '', moduleAccess: [...(m.moduleAccess || [])], teams: [...(m.teams || [])], status: m.status || 'active' });

  const saveMember = async () => {
    const f = memberModal;
    const name = f.name.trim();
    const mobile = digits10(f.mobile);
    if (!name) return toast('Name is required', 'error');
    if (mobile.length !== 10) return toast('Enter a valid 10-digit mobile number', 'error');
    /* The duplicate-mobile check is a courtesy, not the rule: live, the directory returns masked
       mobiles (`98XXXXX210`), so this can never match and the server's own 409 is what refuses. */
    if (members.some((m) => m.id !== f.id && digits10(m.mobile) === mobile)) return toast('Another member already uses this mobile', 'error');
    const current = f.id ? members.find((m) => m.id === f.id) : null;
    // Guardrail on the edit form: the contract has no role-change route at all, so demoting the
    // final active administrator is a console-only path and has to be stopped in the console.
    if (current) {
      const wasLastAdmin = current.role === 'admin' && current.status === 'active' && activeAdmins.length <= 1;
      const staysActiveAdmin = f.role === 'admin' && (f.status || 'active') === 'active';
      if (wasLastAdmin && !staysActiveAdmin) return toast('Cannot demote or suspend the last active administrator', 'error');
    }
    const payload = {
      id: f.id,
      name,
      mobile,
      email: f.email.trim(),
      role: f.role,
      roleId: f.role === 'manager' ? (f.roleId || null) : null,
      moduleAccess: f.role === 'manager' ? f.moduleAccess : [],
      teams: f.role === 'staff' ? f.teams : [],
      status: f.status || 'active',
    };
    const rec = await saveTeamMember(payload, current || null).catch((err) => { failed(err); return null; });
    if (!rec) return;
    logAudit('Team & Access', `${f.id ? 'Updated' : 'Created'} ${roleLabel(rec.role)} "${rec.name}"`);
    toast(rec.approval && !rec.approval.approvedAt
      ? t('team.toast.awaitingApproval', { name: rec.name })
      : `Member ${f.id ? 'updated' : 'created'}`, 'success');
    setMemberModal(null);
    reload();
    reloadPending();
  };

  /* No client-side pre-check on the last administrator any more. That guard was the console's own
     invention and it answered from a list this page happened to be holding; the platform's floor
     lives in `AdministratorGuard`, counts administrators who can still manage back-office access,
     and holds an advisory lock while it counts. Letting the refusal come back from the provider is
     the entire point of D205 \u2014 the console now reports what actually happened. */
  const toggleMemberStatus = async (m) => {
    const next = m.status === 'active' ? 'suspended' : 'active';
    try {
      await setTeamMemberStatus(m.id, next);
    } catch (err) {
      return failed(err);
    }
    logAudit('Team & Access', `${next === 'active' ? 'Reactivated' : 'Suspended'} "${m.name}"`);
    toast(`${m.name} ${next === 'active' ? 'reactivated' : 'suspended'}`, next === 'active' ? 'success' : undefined);
    reload();
  };

  const approveMember = async (m) => {
    setApproving(m.id);
    try {
      await approveTeamMember(m.id);
      logAudit('Team & Access', `Approved back-office account "${m.name}"`);
      toast(t('team.toast.approved', { name: m.name }), 'success');
    } catch (err) {
      failed(err);
    } finally {
      setApproving(null);
    }
    reload();
    reloadPending();
  };

  // ---- Custom role CRUD ----
  const openNewRole = () => setRoleModal({ id: null, name: '', modules: [], teams: [] });
  const openEditRole = (r) => setRoleModal({ id: r.id, name: r.name || '', modules: [...(r.modules || [])], teams: [...(r.teams || [])] });

  const saveRole = async () => {
    const f = roleModal;
    const name = f.name.trim();
    if (!name) return toast('Role name is required', 'error');
    const rec = await saveCustomRole({ id: f.id, name, modules: f.modules, teams: f.teams });
    logAudit('Team & Access', `${f.id ? 'Updated' : 'Created'} role "${rec.name}"`);
    toast(`Role ${f.id ? 'updated' : 'created'}`, 'success');
    setRoleModal(null);
    reload();
  };

  const removeRole = async (r) => {
    const inUse = (members || []).filter((m) => m.roleId === r.id);
    const msg = inUse.length
      ? `Delete role "${r.name}"? ${inUse.length} member(s) use it and will fall back to their manual tab access.`
      : `Delete role "${r.name}"?`;
    if (!window.confirm(msg)) return;
    await deleteCustomRole(r.id);
    logAudit('Team & Access', `Deleted role "${r.name}"`);
    toast(`Role "${r.name}" deleted`);
    reload();
  };

  if (!members) return <Loading />;

  const memberColumns = [
    { key: 'name', header: 'Member', render: (m) => (
      <div>
        <div className="font-semibold text-white">{m.name}</div>
        {m.email ? <div className="text-xs text-gray-500">{m.email}</div> : null}
      </div>
    ) },
    { key: 'mobile', header: 'Mobile', render: (m) => <span className="text-gray-300">+91 {m.mobile}</span> },
    { key: 'role', header: 'Role', render: (m) => <RolePill role={m.role} /> },
    { key: 'access', header: 'Access', render: (m) => <span className="text-gray-300">{accessSummary(m)}</span> },
    { key: 'status', header: 'Status', render: (m) => <StatusPill status={m.status} /> },
    /* No Remove action. There is no `DELETE /users/{id}` in the contract and there never was — this
       platform is soft-delete only, so Suspend *is* the removal (it archives the account). The
       button used to drop the row from the mock store and would have had nothing to call live. */
    { key: 'actions', header: '', className: 'text-right', render: (m) => (
      <div className="flex items-center justify-end gap-1.5">
        <button onClick={() => openEditMember(m)} title="Edit" className="rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-white transition"><Pencil className="h-4 w-4" /></button>
        <button onClick={() => toggleMemberStatus(m)} title={m.status === 'active' ? 'Suspend' : 'Reactivate'} className="rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-white transition">
          {m.status === 'active' ? <Ban className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
        </button>
      </div>
    ) },
  ];

  /* Stacked-card fallback below `sm` (see Table.jsx). Edit / suspend are 44px here — at 28px in
     the table they were the smallest targets on the page. */
  const memberCard = (m) => (
    <div className="pn-card p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-white">{m.name}</div>
          <div className="mt-0.5 text-xs text-gray-400">+91 {m.mobile}{m.email ? ` · ${m.email}` : ''}</div>
        </div>
        <div className="shrink-0"><StatusPill status={m.status} /></div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-gray-400">
        <RolePill role={m.role} />
        <span>{accessSummary(m)}</span>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-white/5 pt-3">
        <button onClick={() => openEditMember(m)} aria-label={`Edit ${m.name}`} className="tap-target rounded-lg text-gray-300"><Pencil className="h-4 w-4" /></button>
        <button onClick={() => toggleMemberStatus(m)} aria-label={`${m.status === 'active' ? 'Suspend' : 'Reactivate'} ${m.name}`} className="tap-target rounded-lg text-gray-300">
          {m.status === 'active' ? <Ban className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );

  const waitingSince = (m) => isoToDisplay(String(m.approval?.createdAt || m.createdAt || '').slice(0, 10)) || '—';

  /* Pending approvals reuse the members table wholesale — same columns in the same order, same
     pills, same stacked card below `sm` — because it is the same population of people in a
     different state, and giving it its own visual language would imply it was a different subject.
     The columns that differ are the two an operator triages on: who raised the account and how
     long it has been waiting. */
  const approvalColumns = [
    { key: 'name', header: t('team.approvals.columns.member'), render: (m) => (
      <div>
        <div className="font-semibold text-white">{m.name}</div>
        {m.email ? <div className="text-xs text-gray-500">{m.email}</div> : null}
      </div>
    ) },
    { key: 'mobile', header: t('team.approvals.columns.mobile'), render: (m) => <span className="text-gray-300">+91 {m.mobile}</span> },
    { key: 'role', header: t('team.approvals.columns.role'), render: (m) => <RolePill role={m.role} /> },
    { key: 'createdBy', header: t('team.approvals.columns.createdBy'), render: (m) => (
      m.approval?.createdByName
        ? <span className="text-gray-300">{m.approval.createdByName}</span>
        : <span className="text-gray-500">{t('team.approvals.creatorUnknown')}</span>
    ) },
    { key: 'waiting', header: t('team.approvals.columns.waitingSince'), render: (m) => <span className="text-gray-300">{waitingSince(m)}</span> },
    { key: 'actions', header: '', className: 'text-right', render: (m) => (
      <button onClick={() => approveMember(m)} disabled={approving === m.id} className="pn-btn pn-btn-primary">
        <Check className="h-4 w-4" /> {t('team.approvals.approve')}
      </button>
    ) },
  ];

  const approvalCard = (m) => (
    <div className="pn-card p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-white">{m.name}</div>
          <div className="mt-0.5 text-xs text-gray-400">+91 {m.mobile}{m.email ? ` · ${m.email}` : ''}</div>
        </div>
        <div className="shrink-0"><RolePill role={m.role} /></div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-gray-400">
        <Clock className="h-3.5 w-3.5" />
        <span>{t('team.approvals.columns.waitingSince')}: {waitingSince(m)}</span>
      </div>
      <div className="mt-3 border-t border-white/5 pt-3">
        <button onClick={() => approveMember(m)} disabled={approving === m.id} className="pn-btn pn-btn-primary w-full">
          <Check className="h-4 w-4" /> {t('team.approvals.approve')}
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Team & Access"
        subtitle="Create internal accounts and control which admin modules each person can open"
        actions={tab === 'approvals'
          ? null
          : tab === 'members'
            ? <button onClick={openNewMember} className="pn-btn pn-btn-primary"><Plus className="h-4 w-4" /> Add member</button>
            : <button onClick={openNewRole} className="pn-btn pn-btn-primary"><Plus className="h-4 w-4" /> New role</button>}
      />

      <HScroll role="tablist" wrapClassName="mb-4" fadeColor="var(--brand-card, #1a1730)" className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
        {[['members', 'Team members', UsersRound], ['approvals', t('team.tabs.approvals', { count: pending.length }), ShieldCheck], ['roles', 'Custom roles', UserCog]].map(([key, label, Icon]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={classNames('flex flex-1 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition', tab === key ? 'bg-brand-teal text-ink' : 'text-gray-300 hover:text-white')}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </HScroll>

      {tab === 'members' ? (
        <Table
          columns={memberColumns}
          rows={members}
          empty="No team members yet — add your first internal account."
          pageSize={12}
          label="members"
          mobileCard={memberCard}
        />
      ) : tab === 'approvals' ? (
        <>
          {/* Maker-checker is a server rule, not a console one: a back-office account created by
              one administrator does not exist until a *different* one approves it. This tab is the
              only place that second signature can be given, which is the gap D205 closes. */}
          <div className="pn-card mb-3 flex items-start gap-2.5 p-3.5 text-xs leading-relaxed text-gray-400">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-teal" />
            <span>{t('team.approvals.explainer')}</span>
          </div>
          {pendingError ? (
            <div className="pn-card mb-3 flex items-start gap-2.5 p-3.5 text-xs leading-relaxed text-red-300">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{pendingError}</span>
            </div>
          ) : null}
          <Table
            columns={approvalColumns}
            rows={pending}
            empty={t('team.approvals.empty')}
            pageSize={12}
            label={t('team.approvals.label')}
            mobileCard={approvalCard}
          />
        </>
      ) : (
        <>
          {/* Custom roles are not a security boundary and must not read like one. The server has no
              concept of them: it refuses `settings.customRoles` outright (422, D67) because this
              screen composes BASE ∪ role-bundle ∪ moduleAccess — a widening union — while the
              server's permission map may only narrow. An operator who ticks three modules here and
              believes they have restricted someone has been misled, so say what it does do. */}
          <div className="pn-card mb-3 flex items-start gap-2.5 p-3.5 text-xs leading-relaxed text-gray-400">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <span>
              <span className="font-semibold text-amber-300">Console-only — not enforced by the server.</span>{' '}
              Custom roles decide which modules this admin console shows a member. Server-side access
              still comes from their role and team alone, so treat these as navigation tidying rather
              than as a restriction on what someone can reach.
            </span>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))' }}>
          {customRoles.length === 0 ? (
            <div className="pn-card p-8 text-center text-gray-500">No custom roles yet. Create reusable module bundles like “Requests Desk”.</div>
          ) : customRoles.map((r) => (
            <div key={r.id} className="pn-card p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-teal/15 text-brand-teal"><ShieldCheck className="h-4 w-4" /></span>
                  <div className="font-semibold text-white">{r.name}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEditRole(r)} title="Edit" className="rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-white transition"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => removeRole(r)} title="Delete" className="rounded-lg p-1.5 text-gray-400 hover:bg-red-500/15 hover:text-red-300 transition"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(r.modules || []).length === 0 ? <span className="text-xs text-gray-500">No modules</span>
                  : r.modules.map((k) => <span key={k} className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-gray-300">{moduleLabel(k)}</span>)}
              </div>
              {(r.teams || []).length ? (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t border-white/5 pt-2">
                  {r.teams.map((t) => <span key={t} className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-300">{teamLabel(t)}</span>)}
                </div>
              ) : null}
            </div>
          ))}
          </div>
        </>
      )}

      {/* Member modal */}
      <Modal
        open={!!memberModal}
        onClose={() => setMemberModal(null)}
        title={memberModal?.id ? 'Edit member' : 'Add team member'}
        size="lg"
        footer={memberModal ? (
          <>
            <button onClick={() => setMemberModal(null)} className="pn-btn pn-btn-ghost">Cancel</button>
            <button onClick={saveMember} className="pn-btn pn-btn-primary"><Check className="h-4 w-4" /> {memberModal.id ? 'Save changes' : 'Create member'}</button>
          </>
        ) : null}
      >
        {memberModal ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-gray-300">Full name <span className="text-rose-400">*</span></span>
                <input value={memberModal.name} onChange={(e) => setMemberModal({ ...memberModal, name: e.target.value })} className="pn-input w-full" placeholder="e.g. Rohan Kulkarni" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-gray-300">Mobile <span className="text-rose-400">*</span></span>
                <input value={memberModal.mobile} onChange={(e) => setMemberModal({ ...memberModal, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })} inputMode="numeric" className="pn-input w-full" placeholder="10-digit number" />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-xs font-semibold text-gray-300">Email (optional)</span>
                <input value={memberModal.email} onChange={(e) => setMemberModal({ ...memberModal, email: e.target.value })} className="pn-input w-full" placeholder="name@punenest.com" />
              </label>
            </div>

            <div>
              <span className="mb-1.5 block text-xs font-semibold text-gray-300">Role</span>
              <Select value={memberModal.role} onChange={(v) => setMemberModal({ ...memberModal, role: v })} options={ROLE_OPTS} />
            </div>

            {memberModal.role === 'admin' ? (
              <p className="rounded-lg bg-indigo-500/10 px-3 py-2.5 text-sm text-indigo-200">Administrators have full access to every module, including Team &amp; Access and Settings.</p>
            ) : null}

            {memberModal.role === 'manager' && !memberModal.id ? (
              /* Said before the save, not after it. `manager` is an admin-console permission label,
                 not one of the contract's roles, so this create is refused — by the server live,
                 and by the mock too, which now refuses it in the server's words. */
              <p className="flex items-start gap-2.5 rounded-lg bg-amber-500/10 px-3 py-2.5 text-sm leading-relaxed text-amber-200">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t('team.managerNotCreatable')}</span>
              </p>
            ) : null}

            {memberModal.role === 'manager' ? (
              <>
                <div>
                  <span className="mb-1.5 block text-xs font-semibold text-gray-300">Preset role (optional)</span>
                  <Select value={memberModal.roleId} onChange={(v) => setMemberModal({ ...memberModal, roleId: v })} options={roleOptionsForSelect} placeholder="— No preset role —" />
                  <p className="mt-1.5 text-xs text-gray-500">A preset grants its bundle of modules; the tabs ticked below are added on top.</p>
                </div>
                <div>
                  <span className="mb-1.5 block text-xs font-semibold text-gray-300">Admin tab access</span>
                  <CheckGrid
                    items={GRANTABLE_PERMISSIONS}
                    isOn={(k) => memberModal.moduleAccess.includes(k)}
                    onToggle={(k) => setMemberModal({ ...memberModal, moduleAccess: memberModal.moduleAccess.includes(k) ? memberModal.moduleAccess.filter((x) => x !== k) : [...memberModal.moduleAccess, k] })}
                  />
                  <p className="mt-2 text-xs text-gray-500">Dashboard is always available. Team &amp; Access and Settings stay admin-only.</p>
                </div>
              </>
            ) : null}

            {memberModal.role === 'staff' ? (
              <div>
                <span className="mb-1.5 block text-xs font-semibold text-gray-300">Ops service teams</span>
                <CheckGrid
                  items={OPS_TEAMS}
                  isOn={(t) => memberModal.teams.includes(t)}
                  onToggle={(t) => setMemberModal({ ...memberModal, teams: memberModal.teams.includes(t) ? memberModal.teams.filter((x) => x !== t) : [...memberModal.teams, t] })}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* Custom role modal */}
      <Modal
        open={!!roleModal}
        onClose={() => setRoleModal(null)}
        title={roleModal?.id ? 'Edit role' : 'New custom role'}
        size="lg"
        footer={roleModal ? (
          <>
            <button onClick={() => setRoleModal(null)} className="pn-btn pn-btn-ghost">Cancel</button>
            <button onClick={saveRole} className="pn-btn pn-btn-primary"><Check className="h-4 w-4" /> {roleModal.id ? 'Save changes' : 'Create role'}</button>
          </>
        ) : null}
      >
        {roleModal ? (
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-gray-300">Role name <span className="text-rose-400">*</span></span>
              <input value={roleModal.name} onChange={(e) => setRoleModal({ ...roleModal, name: e.target.value })} className="pn-input w-full" placeholder="e.g. Requests Desk" />
            </label>
            <div>
              <span className="mb-1.5 block text-xs font-semibold text-gray-300">Modules in this role</span>
              <CheckGrid
                items={GRANTABLE_PERMISSIONS}
                isOn={(k) => roleModal.modules.includes(k)}
                onToggle={(k) => setRoleModal({ ...roleModal, modules: roleModal.modules.includes(k) ? roleModal.modules.filter((x) => x !== k) : [...roleModal.modules, k] })}
              />
            </div>
            <div>
              <span className="mb-1.5 block text-xs font-semibold text-gray-300">Ops service teams (optional)</span>
              <CheckGrid
                items={OPS_TEAMS}
                isOn={(t) => roleModal.teams.includes(t)}
                onToggle={(t) => setRoleModal({ ...roleModal, teams: roleModal.teams.includes(t) ? roleModal.teams.filter((x) => x !== t) : [...roleModal.teams, t] })}
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
