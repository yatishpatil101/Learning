import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Check, Clock, Info, Pencil, Plus, RotateCcw, ShieldCheck, UsersRound } from 'lucide-react';
/* Team members come through the services seam, so this console talks to the real API when the
   `team` domain is switched on and to a mock that enforces the same refusals when it is not
   (D205). Permissions do not go through the seam at all — see `services/permissionsService.js`
   for why a domain whose only previous implementation contradicted the server has no mock. */
import {
  listTeamMembers, saveTeamMember, setTeamMemberStatus,
  listPendingApprovals, approveTeamMember,
} from '../../services/teamService.js';
import {
  getPermissionCatalogue, getMemberPermissions, saveMemberPermissions,
} from '../../services/permissionsService.js';
import { logAudit } from '../../lib/mockApi.js';
import { OPS_TEAMS, permissionLabel } from '../../lib/adminModules.js';
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

/* Set inequality, not array inequality — the permission grid renders in the catalogue's order but
   the loaded document is in whatever order it was stored, so comparing positionally would report a
   change on every open. */
const changedFrom = (before, after) => {
  const a = new Set(before || []);
  const b = new Set(after || []);
  return a.size !== b.size || [...b].some((x) => !a.has(x));
};

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

/* Shared checkbox grid used for the ops-team picker and the permission grid. */
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
  /* The atoms an administrator may hand out, in the server's own order. Loaded once: it is a
     compile-time constant of the server, not a per-caller answer, and re-fetching it per modal
     open would make opening a member's record two round trips instead of one. */
  const [catalogue, setCatalogue] = useState([]);
  const [memberModal, setMemberModal] = useState(null); // form object or null
  const [pendingError, setPendingError] = useState(null);

  /* Every mutation on this page can now be refused by the server, and a refusal an operator never
     sees is indistinguishable from the console's old confident wrong answer. `role_change_unsupported`
     is the one failure this client raises itself, so it is the one with a translated message; the
     rest carry the server's own wording, which names the fix and must not be reworded here. */
  const failed = (err) => toast(
    err?.code === 'role_change_unsupported' ? t('team.errors.roleChangeUnsupported') : (err?.message || t('team.errors.generic')),
    'error',
  );

  const reload = () => listTeamMembers()
    .then(setMembers)
    .catch(failed);

  /* Admin-only live, unlike the directory read beside it — a scoped manager who can open this page
     can still be refused here. Report that in place rather than showing an empty queue, which would
     read as "nobody is waiting". */
  const reloadPending = () => listPendingApprovals()
    .then((p) => { setPending(p); setPendingError(null); })
    .catch((err) => { setPending([]); setPendingError(err?.message || t('team.errors.generic')); });

  useEffect(() => { reload(); reloadPending(); }, []);

  /* A catalogue that fails to load leaves the grid empty rather than falling back to a hard-coded
     list. A hard-coded list is exactly what this page used to hold, and the failure it caused was
     silent: it offered names the server did not enforce. An empty grid is visibly broken. */
  useEffect(() => {
    let alive = true;
    getPermissionCatalogue()
      .then((c) => { if (alive) setCatalogue(Array.isArray(c) ? c : []); })
      .catch(failed);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeAdmins = useMemo(() => (members || []).filter((m) => m.role === 'admin' && m.status === 'active'), [members]);

  /* What the table can say about someone's access without a request per row.

     It used to say more, by recomputing the effective module set in the browser. It cannot any
     more, and that is the improvement: the effective set is the server's, it is not on the
     directory row, and inventing a second answer here is what this whole change removes. The real
     document is one click away, in the member's own record, where it is read from the server. */
  const accessSummary = (m) => {
    if (m.role === 'admin') return 'Every module';
    if (m.role === 'staff') return m.teams?.length ? m.teams.map(teamLabel).join(', ') : 'No teams assigned';
    return 'Open the record to see';
  };

  // ---- Member CRUD ----
  /* New accounts default to Ops staff, not Manager: `manager` is an admin-console permission label
     and not one of the contract's roles (`Role = buyer|owner|staff|admin`), so a live create with it
     is refused. Defaulting to a role that cannot be created would make the primary action fail. */
  const openNewMember = () => setMemberModal({ id: null, name: '', mobile: '', email: '', role: 'staff', teams: [], status: 'active', permissions: null, loadedPermissions: null, effective: [], scoped: false, permissionsError: null });

  /* Opening a record fetches that person's permission document. It is deliberately *not* on the
     directory row: the row is a masked projection of a user, and an access-control document is not
     something to ship in a list of eighty people to render a one-line summary nobody has asked to
     see yet.

     `permissions` is what an administrator scoped them to, `effective` is what that resolves to
     against their role's baseline. Both are shown, because they differ in the case that matters: a
     document may only *narrow*, so an atom ticked here that the role never had stays off in
     `effective`, and an operator who is not shown that will believe they granted it. */
  const openEditMember = (m) => {
    setMemberModal({
      id: m.id, name: m.name || '', mobile: m.mobile || '', email: m.email || '',
      role: m.role || 'staff', teams: [...(m.teams || [])], status: m.status || 'active',
      permissions: null, loadedPermissions: null, effective: [], scoped: false, permissionsError: null,
    });
    getMemberPermissions(m.id)
      .then((doc) => setMemberModal((prev) => (prev && prev.id === m.id
        ? {
          ...prev,
          permissions: doc.scoped ? [...(doc.permissions || [])] : [...(doc.effective || [])],
          effective: doc.effective || [],
          scoped: !!doc.scoped,
          // What was on screen when it loaded, so an untouched grid can be left alone on save.
          loadedPermissions: doc.scoped ? [...(doc.permissions || [])] : [...(doc.effective || [])],
        }
        : prev)))
      .catch((err) => setMemberModal((prev) => (prev && prev.id === m.id
        ? { ...prev, permissionsError: err?.message || t('team.errors.generic') }
        : prev)));
  };

  /* Which atoms this account could ever hold. An operations account cannot be granted an
     administrator-only atom — the server's baseline excludes it and the PUT would be refused with
     422 — so the row is hidden rather than offered and then rejected. */
  const grantable = useMemo(
    () => catalogue.filter((p) => !p.adminOnly || memberModal?.role === 'admin'),
    [catalogue, memberModal?.role],
  );

  const saveMember = async () => {
    const f = memberModal;
    const name = f.name.trim();
    const mobile = digits10(f.mobile);
    if (!name) return toast('Name is required', 'error');
    /* Only a new account carries a mobile. An existing one shows the masked directory value
       (`97XXXXX115`), which is five digits and would fail this check forever; and `PATCH /users/{id}`
       does not accept the field anyway, so there is nothing to validate. */
    if (!f.id) {
      if (mobile.length !== 10) return toast('Enter a valid 10-digit mobile number', 'error');
      /* A courtesy, not the rule: the directory returns masked mobiles, so this catches only the
         obvious case and the server's own 409 is what actually refuses a duplicate. */
      if (members.some((m) => digits10(m.mobile) === mobile)) return toast('Another member already uses this mobile', 'error');
    }
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
      // Never on an edit: it is not a field the update route accepts, and the value on screen is
      // the mask, so sending it would put a redaction on the wire as if it were a number.
      mobile: f.id ? undefined : mobile,
      email: f.email.trim(),
      role: f.role,
      teams: f.role === 'staff' ? f.teams : [],
      status: f.status || 'active',
    };
    const rec = await saveTeamMember(payload, current || null).catch((err) => { failed(err); return null; });
    if (!rec) return;
    /* The permission document is a second request, and it is second on purpose: it is a different
       resource with a different guard (`users:write`, administrator-only) and different refusals
       (403 on editing your own, 422 on an unknown atom or a consumer account). Folding it into the
       profile save would mean a rejected permission edit also discarded a corrected email.

       Only sent when the record was open long enough for the document to arrive — `permissions` is
       null until then, and PUTting null would replace the document with nothing.

       And only when the grid actually changed. An unscoped account is shown its baseline ticked, so
       saving an unrelated email correction would otherwise write a document where none existed and
       silently move the account from "follows the role" to "pinned to whatever the role allowed on
       the day someone fixed a typo". There is no route that removes a document once written. */
    if (f.id && Array.isArray(f.permissions) && changedFrom(f.loadedPermissions, f.permissions)) {
      try {
        await saveMemberPermissions(f.id, f.permissions);
      } catch (err) {
        failed(err);
      }
    }
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

  // ---- Custom roles: retired ----
  /* There used to be a third tab here that built named module bundles, and a `roleId` on every
     member that pointed at one. Both are gone. The server has no route for either and refuses the
     settings key outright with 422 (D67/V61), so the whole feature resolved entirely in the
     browser — the page itself carried a banner saying so. A named bundle that grants nothing is
     worse than no feature: it is an access-control vocabulary an operator believes in. The
     equivalent is now ticking the same atoms on each account, against a catalogue the server
     publishes and enforces. */

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
          : <button onClick={openNewMember} className="pn-btn pn-btn-primary"><Plus className="h-4 w-4" /> Add member</button>}
      />

      <HScroll role="tablist" wrapClassName="mb-4" fadeColor="var(--brand-card, #1a1730)" className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
        {[['members', 'Team members', UsersRound], ['approvals', t('team.tabs.approvals', { count: pending.length }), ShieldCheck]].map(([key, label, Icon]) => (
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
      ) : (
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
                <span className="mb-1.5 block text-xs font-semibold text-gray-300">Mobile{memberModal.id ? null : <span className="text-rose-400"> *</span>}</span>
                {/* Read-only on an existing record, for two reasons that happen to agree. There is
                    no route that changes a back-office account's mobile — it is the sign-in
                    credential — and the directory only ever publishes it masked (`97XXXXX115`), so
                    an editable box would be offering to overwrite a real number with a redaction. */}
                <input
                  value={memberModal.mobile}
                  onChange={(e) => setMemberModal({ ...memberModal, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                  readOnly={!!memberModal.id}
                  inputMode="numeric"
                  className={`pn-input w-full${memberModal.id ? ' cursor-not-allowed opacity-60' : ''}`}
                  placeholder="10-digit number"
                />
                {memberModal.id ? (
                  <span className="mt-1 block text-[11px] text-gray-500">Partly hidden, and fixed for the life of the account — it is how they sign in.</span>
                ) : null}
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

            {memberModal.id ? (
              <div>
                <span className="mb-1.5 block text-xs font-semibold text-gray-300">Back-office permissions</span>
                {memberModal.permissionsError ? (
                  <p className="flex items-start gap-2.5 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm leading-relaxed text-red-200">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{memberModal.permissionsError}</span>
                  </p>
                ) : memberModal.permissions === null ? (
                  <p className="text-sm text-gray-500">Loading this member’s permissions…</p>
                ) : (
                  <>
                    <CheckGrid
                      items={grantable.map((p) => ({ key: p.name, label: permissionLabel(p) }))}
                      isOn={(name) => memberModal.permissions.includes(name)}
                      onToggle={(name) => setMemberModal({
                        ...memberModal,
                        permissions: memberModal.permissions.includes(name)
                          ? memberModal.permissions.filter((x) => x !== name)
                          : [...memberModal.permissions, name],
                      })}
                    />
                    {/* Named, not counted. An operator who ticks an atom this account's role never
                        had needs to see that it did not take effect, and "23 of 27" does not say
                        which one. Empty here is the ordinary case: an unscoped account holds its
                        role's whole baseline. */}
                    {memberModal.permissions.filter((p) => !memberModal.effective.includes(p)).length ? (
                      <p className="mt-2 flex items-start gap-2.5 rounded-lg bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-200">
                        <Info className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          Ticked but not in effect:{' '}
                          {memberModal.permissions.filter((p) => !memberModal.effective.includes(p)).join(', ')}.
                          A permission document can only narrow what the role already allows, never widen it.
                        </span>
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-gray-500">
                      {memberModal.scoped
                        ? 'This account is scoped: it holds exactly what is ticked here.'
                        : 'This account is not scoped yet — it holds its role’s full baseline, shown ticked. Unticking anything and saving starts scoping it.'}
                      {' '}Scoping cannot be undone from here; an account with nothing ticked holds nothing.
                    </p>
                  </>
                )}
              </div>
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
    </div>
  );
}
