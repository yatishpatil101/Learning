import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Check, Copy, Info, KeyRound, Pencil, Plus, RotateCcw, Smartphone } from 'lucide-react';
/* Team members come through the services seam. Permissions do not go through the seam at
   all — see `services/permissionsService.js` for why. */
import {
  listTeamMembers, saveTeamMember, setTeamMemberStatus,
  resetTeamMemberTwoFactor, reissueTeamMemberInvite,
} from '../../services/teamService.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  getFunctionCatalogue, getMemberPermissions, saveMemberFunctions,
} from '../../services/permissionsService.js';
// No client-side audit write: every write on this page is a server call that records its own audit
// row from the authenticated actor, which the browser cannot read back anyway.
import { roleLabel } from '../../lib/auth.js';
import { classNames } from '../../lib/format.js';
import { useTabParam } from '../../lib/useTabParam.js';
import { useToast } from '../../context/ToastContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Select from '../../components/ui/Select.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Loading from '../../components/ui/Loading.jsx';
import {
  BTN, CHIP, CHIP_TONE, FactRow, IconAction, PageNav, QueuePanel, QueueTabs, RowCard, RowList, SearchBox, useClientPaging,
} from '../../components/admin/WorkQueue.jsx';

const STAFF_ROLE_OPTS = [
  { value: 'staff', label: 'Ops staff — service portal' },
];
const ADMIN_ROLE_OPTS = [
  ...STAFF_ROLE_OPTS,
  { value: 'manager', label: 'Manager — admin console' },
];

const ROLE_TONE = { admin: CHIP_TONE.violet, manager: CHIP_TONE.teal, staff: CHIP_TONE.sky };

const TEAM_TABS = [
  { key: 'all', label: 'All members', match: () => true, note: 'Every back-office account. Suspend is the removal: there is no hard delete.' },
  { key: 'staff', label: 'Ops staff', match: (m) => m.role === 'staff' && m.status === 'active', note: 'Staff open only the functions ticked on their record.' },
  { key: 'managers', label: 'Managers', match: (m) => m.role !== 'staff' && m.status === 'active', note: 'Administrator and managers run the admin console.' },
  { key: 'suspended', label: 'Suspended', match: (m) => m.status !== 'active', note: 'Signed out and refused sign-in until reactivated.' },
];
const PAGE_SIZE = 20;
const Dot = () => <span className="text-gray-600" aria-hidden="true">·</span>;

const FUNCTION_GROUPS = ['Verification', 'Listings', 'Service desks', 'Support', 'Content'];
const digits10 = (m) => String(m || '').replace(/\D/g, '').slice(-10);

const changedFrom = (before, after) => {
  const a = new Set(before || []);
  const b = new Set(after || []);
  return a.size !== b.size || [...b].some((x) => !a.has(x));
};

const RolePill = ({ role }) => (
  <span className={classNames(CHIP, ROLE_TONE[role] || CHIP_TONE.neutral)}>{roleLabel(role)}</span>
);

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

function FunctionChecklist({ functions, selected, onToggle }) {
  return (
    <div className="space-y-3">
      {FUNCTION_GROUPS.map((group) => {
        const items = functions.filter((fn) => fn.group === group);
        if (!items.length) return null;
        return (
          <section key={group}>
            <div className="mb-1.5 text-xs font-semibold text-gray-400">{group}</div>
            <CheckGrid
              items={items.map((fn) => ({ key: fn.name, label: fn.label }))}
              isOn={(name) => selected.includes(name)}
              onToggle={onToggle}
            />
          </section>
        );
      })}
    </div>
  );
}

function FunctionChips({ names, labels, empty = 'Dashboard only' }) {
  if (!names?.length) return <span className="text-xs text-gray-500">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {names.map((name) => (
        <span key={name} className={classNames(CHIP, CHIP_TONE.neutral)}>{labels.get(name) || name}</span>
      ))}
    </span>
  );
}

export default function AdminTeam() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const [members, setMembers] = useState(null);
  const [signingIn, setSigningIn] = useState(null);
  /* A compile-time constant of the server, not per-caller: load
     once so opening a member's record is one round trip. */
  const [catalogue, setCatalogue] = useState([]);

  const [memberModal, setMemberModal] = useState(null); // form object or null
  const [inviteDialog, setInviteDialog] = useState(null);
  const [inviteCopied, setInviteCopied] = useState('');
  const [tab, setTab] = useTabParam(TEAM_TABS.map((x) => x.key), 'all');
  const [query, setQuery] = useState('');
  const isAdmin = me?.role === 'admin';
  const roleOptions = isAdmin ? ADMIN_ROLE_OPTS : STAFF_ROLE_OPTS;
  const functionLabels = useMemo(() => new Map(catalogue.map((fn) => [fn.name, fn.label])), [catalogue]);

  const failed = useCallback((err) => toast(
    err?.code === 'role_change_unsupported' ? t('team.errors.roleChangeUnsupported') : (err?.message || t('team.errors.generic')),
    'error',
  ), [t, toast]);

  const reload = useCallback(() => listTeamMembers()
    .then(setMembers)
    .catch(failed), [failed]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    let alive = true;
    getFunctionCatalogue()
      .then((c) => { if (alive) setCatalogue(Array.isArray(c) ? c : []); })
      .catch(failed);
    return () => { alive = false; };
  }, [failed]);

  const myFunctions = useMemo(
    () => (isAdmin ? [] : members?.find((m) => m.id === me?.id)?.functions ?? []),
    [isAdmin, members, me?.id],
  );

  const accessSummary = (m) => {
    if (m.role === 'admin') return 'Every function';
    if (m.role === 'manager') return 'All functions';
    if (m.role === 'staff') return m.functions?.length ? `${m.functions.length} functions` : 'Dashboard only';
    return 'Open the record to see';
  };

  const openNewMember = () => setMemberModal({ id: null, name: '', mobile: '', email: '', role: 'staff', functions: [], status: 'active', functionsError: null });

  const openEditMember = (m) => {
    setMemberModal({
      id: m.id, name: m.name || '', mobile: m.mobile || '', email: m.email || '',
      role: m.role || 'staff', functions: null, loadedFunctions: null, functionsError: null,
    });
    if (m.role !== 'staff') {
      setMemberModal((prev) => (prev && prev.id === m.id ? { ...prev, functions: [...(m.functions || [])], loadedFunctions: [...(m.functions || [])] } : prev));
      return;
    }
    getMemberPermissions(m.id)
      .then((doc) => setMemberModal((prev) => (prev && prev.id === m.id
        ? {
          ...prev,
          functions: [...(doc.functions || doc.permissions || [])],
          loadedFunctions: [...(doc.functions || doc.permissions || [])],
        }
        : prev)))
      .catch((err) => setMemberModal((prev) => (prev && prev.id === m.id
        ? { ...prev, functionsError: err?.message || t('team.errors.generic') }
        : prev)));
  };

  const grantable = useMemo(
    () => catalogue.filter((fn) => isAdmin || myFunctions.includes(fn.name)
      // A manager may keep or remove what the administrator granted, even if it cannot grant it.
      || memberModal?.loadedFunctions?.includes(fn.name)),
    [catalogue, isAdmin, myFunctions, memberModal?.loadedFunctions],
  );

  const [saving, setSaving] = useState(false);
  const saveMember = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await persistMember();
    } finally {
      setSaving(false);
    }
  };

  const persistMember = async () => {
    const f = memberModal;
    const name = f.name.trim();
    const mobile = digits10(f.mobile);
    const email = f.email.trim();
    if (!name) return toast('Name is required', 'error');
    /* Only a new account carries a mobile. An existing one shows the masked directory value
       (`97XXXXX115`), which is five digits and would fail this check forever; and `PATCH /users/{id}`
       does not accept the field anyway, so there is nothing to validate. */
    if (!f.id) {
      if (mobile.length !== 10) return toast('Enter a valid 10-digit mobile number', 'error');
      if (!email) return toast('Email is required', 'error');
      /* A courtesy, not the rule: the directory returns masked mobiles, so this catches only the
         obvious case and the server's own 409 is what actually refuses a duplicate. */
      if (members.some((m) => digits10(m.mobile) === mobile)) return toast('Another member already uses this mobile', 'error');
    }
    const current = f.id ? members.find((m) => m.id === f.id) : null;
    const payload = {
      id: f.id,
      name,
      // Never on an edit: it is not a field the update route accepts, and the value on screen is
      // the mask, so sending it would put a redaction on the wire as if it were a number.
      mobile: f.id ? undefined : mobile,
      email,
      role: f.role,
      functions: f.role === 'staff' ? f.functions || [] : [],
      status: f.status || 'active',
    };
    const saved = await saveTeamMember(payload, current || null).catch((err) => { failed(err); return null; });
    if (!saved) return;
    if (f.id && f.role === 'staff' && Array.isArray(f.functions) && changedFrom(f.loadedFunctions, f.functions)) {
      try {
        await saveMemberFunctions(f.id, f.functions);
      } catch (err) {
        failed(err);
        return;
      }
    }
    toast(`Member ${f.id ? 'updated' : 'created'}`, 'success');
    setMemberModal(null);
    if (!f.id && saved.inviteUrl) {
      setInviteDialog({ url: saved.inviteUrl, name });
      setInviteCopied('');
    }
    reload();
  };

  const toggleMemberStatus = async (m) => {
    const next = m.status === 'active' ? 'suspended' : 'active';
    try {
      await setTeamMemberStatus(m.id, next);
    } catch (err) {
      return failed(err);
    }
    toast(`${m.name} ${next === 'active' ? 'reactivated' : 'suspended'}`, next === 'active' ? 'success' : undefined);
    reload();
  };

  const SIGN_IN_ACTIONS = {
    reset: { run: resetTeamMemberTwoFactor, ask: 'Reset two-factor for', done: 'must set up a new authenticator' },
    invite: { run: reissueTeamMemberInvite, ask: 'Create a new invite for', done: 'has a fresh invite link' },
  };
  const canManageMember = (m) => (me?.role === 'admin' ? m.role !== 'admin' : m.role === 'staff');
  const signInAction = async (m, kind) => {
    const a = SIGN_IN_ACTIONS[kind];
    if (!window.confirm(`${a.ask} ${m.name}? They will be signed out everywhere.`)) return;
    setSigningIn(m.id);
    try {
      const result = await a.run(m.id);
      if (kind === 'invite' && result?.inviteUrl) {
        setInviteDialog({ url: result.inviteUrl, name: m.name });
        setInviteCopied('');
      }
      toast(`${m.name} ${a.done}`, 'success');
    } catch (err) {
      failed(err);
    } finally {
      setSigningIn(null);
    }
  };
  const closeInviteDialog = () => {
    setInviteDialog(null);
    setInviteCopied('');
  };
  const copyInvite = () => (navigator.clipboard?.writeText
    ? navigator.clipboard.writeText(inviteDialog.url)
      .then(() => setInviteCopied('Copied'), () => setInviteCopied('Copy failed — copy it manually'))
    : setInviteCopied('Copy failed — copy it manually'));
  const signInButtons = (m) => (m.id === me?.id || m.status !== 'active' ? null : (
    <>
      <IconAction label={`Reset 2FA for ${m.name}`} icon={Smartphone} disabled={signingIn === m.id} onClick={() => signInAction(m, 'reset')} />
      <IconAction label={`Reissue invite for ${m.name}`} icon={KeyRound} disabled={signingIn === m.id} onClick={() => signInAction(m, 'invite')} />
    </>
  ));

  const all = members || [];
  const needle = query.trim().toLowerCase();
  const tabRows = (key) => all.filter(TEAM_TABS.find((x) => x.key === key).match);
  const shown = tabRows(tab).filter((m) => !needle || [m.name, m.mobile, m.email].some((v) => String(v || '').toLowerCase().includes(needle)));
  const { items: pageRows, paging } = useClientPaging(shown, PAGE_SIZE, `${tab}|${needle}`);

  if (!members) return <Loading />;

  const memberRow = (m) => (
    <RowCard
      key={m.id}
      id={m.id}
      title={m.name}
      badges={<><RolePill role={m.role} /><Badge status={m.status} /></>}
      meta={<><span>+91 {m.mobile}</span>{m.email ? <><Dot /><span className="truncate">{m.email}</span></> : null}</>}
      facts={(
        <FactRow label="Access">
          <span className="col-span-full">
            {m.role === 'staff' ? <FunctionChips names={m.functions || []} labels={functionLabels} /> : accessSummary(m)}
          </span>
        </FactRow>
      )}
      primary={canManageMember(m) ? (
        <button type="button" onClick={() => openEditMember(m)} className={BTN.ghost}><Pencil className="h-3.5 w-3.5" /> Edit</button>
      ) : null}
      /* No Remove action. There is no `DELETE /users/{id}` in the contract — this platform is
         soft-delete only, so Suspend *is* the removal (it archives the account). */
      icons={canManageMember(m) ? (
        <>
          {signInButtons(m)}
          <IconAction label={m.status === 'active' ? 'Suspend' : 'Reactivate'} icon={m.status === 'active' ? Ban : RotateCcw} onClick={() => toggleMemberStatus(m)} />
        </>
      ) : null}
    />
  );

  return (
    <div>
      <PageHeader
        title="Team & Access"
        subtitle="Create internal accounts and control which admin modules each person can open"
        actions={<button onClick={openNewMember} className="dz-btn dz-btn-primary"><Plus className="h-4 w-4" /> Add member</button>}
      />

      <QueueTabs tabs={TEAM_TABS.map((x) => ({ key: x.key, label: x.label, count: tabRows(x.key).length }))} active={tab} onChange={setTab} label="Team members" idPrefix="team" />
      <QueuePanel
        idPrefix="team"
        active={tab}
        note={TEAM_TABS.find((x) => x.key === tab).note}
        toolbar={(
          <>
            <SearchBox value={query} onChange={setQuery} placeholder="Name, mobile or email" label="Search members" />
            <div className="ml-auto"><PageNav {...paging} /></div>
          </>
        )}
      >
        <RowList isEmpty={!shown.length} empty={all.length ? 'No members match.' : 'No team members yet — add your first internal account.'}>
          {pageRows.map(memberRow)}
        </RowList>
      </QueuePanel>

      <Modal
        open={!!memberModal}
        onClose={() => setMemberModal(null)}
        title={memberModal?.id ? 'Edit member' : 'Add team member'}
        size="lg"
        footer={memberModal ? (
          <>
            <button onClick={() => setMemberModal(null)} className="dz-btn dz-btn-ghost">Cancel</button>
            <button onClick={saveMember} disabled={saving} className="dz-btn dz-btn-primary"><Check className="h-4 w-4" /> {memberModal.id ? 'Save changes' : 'Create member'}</button>
          </>
        ) : null}
      >
        {memberModal ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-gray-300">Full name <span className="text-rose-400">*</span></span>
                <input value={memberModal.name} onChange={(e) => setMemberModal({ ...memberModal, name: e.target.value })} className="dz-input w-full" placeholder="e.g. Rohan Kulkarni" />
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
                  className={`dz-input w-full${memberModal.id ? ' cursor-not-allowed opacity-60' : ''}`}
                  placeholder="10-digit number"
                />
                {memberModal.id ? (
                  <span className="mt-1 block text-[11px] text-gray-500">Partly hidden, and fixed for the life of the account — it is how they sign in.</span>
                ) : null}
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-xs font-semibold text-gray-300">Email <span className="text-rose-400">*</span></span>
                <input value={memberModal.email} onChange={(e) => setMemberModal({ ...memberModal, email: e.target.value })} className="dz-input w-full" placeholder="name@draazy.com" />
              </label>
            </div>

            <div>
              <span className="mb-1.5 block text-xs font-semibold text-gray-300">Role</span>
              <Select value={memberModal.role} onChange={(v) => setMemberModal({ ...memberModal, role: v })} options={roleOptions} ariaLabel="Role" disabled={!!memberModal.id} />
            </div>

            {memberModal.role === 'manager' ? (
              <p className="rounded-lg bg-teal-500/10 px-3 py-2.5 text-sm text-teal-100">Managers receive all functions by default and can create staff accounts.</p>
            ) : null}

            {memberModal.role === 'staff' ? (
              <div>
                <span className="mb-1.5 block text-xs font-semibold text-gray-300">Back-office functions</span>
                {memberModal.functionsError ? (
                  <p className="flex items-start gap-2.5 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm leading-relaxed text-red-200">
                   <Info className="mt-0.5 h-4 w-4 shrink-0" />
                   <span>{memberModal.functionsError}</span>
                  </p>
                ) : memberModal.functions === null ? (
                  <p className="text-sm text-gray-500">Loading this member’s functions…</p>
                ) : (
                  <>
                   <FunctionChecklist
                     functions={grantable}
                     selected={memberModal.functions || []}
                     onToggle={(name) => setMemberModal({
                       ...memberModal,
                       functions: memberModal.functions.includes(name)
                         ? memberModal.functions.filter((x) => x !== name)
                         : [...memberModal.functions, name],
                     })}
                   />
                   <p className="mt-2 text-xs text-gray-500">
                     {memberModal.functions?.length
                       ? 'The server derives route permissions and desk scope from these functions.'
                       : 'No function selected leaves this staff account with dashboard access only.'}
                   </p>
                  </>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
      <Modal
        open={!!inviteDialog}
        onClose={closeInviteDialog}
        title="Invite link"
        footer={inviteDialog ? (
          <>
            <button onClick={copyInvite} className="dz-btn dz-btn-primary"><Copy className="h-4 w-4" /> <span aria-live="polite">{inviteCopied || 'Copy link'}</span></button>
            <button onClick={closeInviteDialog} className="dz-btn dz-btn-ghost">Done</button>
          </>
        ) : null}
      >
        {inviteDialog ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-300">Share this privately with {inviteDialog.name}; it works once and expires in 7 days.</p>
            <input readOnly value={inviteDialog.url} className="dz-input w-full font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="Staff invite link" />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
