import { useEffect, useState } from 'react';
import { Inbox, Users, UsersRound, Flag, DoorOpen } from 'lucide-react';
import { rawDb, mutateDb, logAudit, addInternalNote } from '../../lib/mockApi.js';
import { getFlatmatePosts, getFlatmateGroups, updateFlatmatePost, updateFlatmateGroup } from '../../lib/data/flatmates.js';
import { getRooms, updateRoom } from '../../lib/store.js';
import { fmtINR, fmtNum, classNames } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import { useTabParam } from '../../lib/useTabParam.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Loading from '../../components/ui/Loading.jsx';

/* Map modStatus to Badge-compatible status string */
const MOD_BADGE = { live: 'active', approved: 'active', flagged: 'pending', removed: 'rejected', rejected: 'rejected' };
const MOD_LABEL = { live: 'Live', approved: 'Approved', flagged: 'Flagged', removed: 'Removed', rejected: 'Rejected' };
const OWNER_BADGE = { pending: 'pending', accepted: 'active', declined: 'rejected' };
const OWNER_LABEL = { pending: 'Pending', accepted: 'Accepted', declined: 'Declined' };

function policyLabel(p) { return p === 'women' ? 'Women only' : p === 'men' ? 'Men only' : 'Anyone'; }

/* A room's identity on the consumer card is its `society` — the posting wizard never
   asks for a title, so `title` is absent on every real room. Ops has to recognise the
   same string the reporter saw, so society leads here too. */
function roomName(r) { return r.society || r.title || r.roomType || '—'; }

/* Mobile card primitives — stacked layout shown < sm instead of the wide table,
   so moderation actions are never clipped off-screen on a phone. */
function CardField({ label, wide, children }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-[11px] uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-gray-200">{children}</dd>
    </div>
  );
}

function ModActions({ item, onAct, approveStatus = 'live' }) {
  const st = item.modStatus || 'live';
  return (
    <div className="flex flex-wrap gap-2">
      {!['live', 'approved'].includes(st) ? <button onClick={() => onAct(item.id, approveStatus, 'Approved')} className="rounded-lg border border-brand-teal/30 bg-brand-teal/10 px-3 py-1.5 text-xs font-medium text-brand-teal">Approve</button> : null}
      {st !== 'flagged' ? <button onClick={() => onAct(item.id, 'flagged', 'Flagged')} className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300">Flag</button> : null}
      {st !== 'removed' ? <button onClick={() => onAct(item.id, 'removed', 'Removed')} className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300">Remove</button> : null}
    </div>
  );
}

/* Ops moderates what consumers actually posted (tech-debt D97d).

   The admin page read `rawDb()` (the `puneNestDB_v5` mock database) while every
   consumer flatmate flow writes localStorage — `puneNestFlatmatePosts`,
   `puneNestFlatmateGroups`, `puneNestRoomListings`. Two disjoint stores, so a real
   post was invisible to the queue that exists to moderate it, and rooms had no tab
   at all. Both halves are read here now, seeds first so the demo rows stay.

   Rooms are the addition the register called out: a room is the most abusable
   flatmate surface (free-text title, an address, a price) and it was the one with
   no moderation path whatsoever. */
function loadFlatmates() {
  const db = rawDb();
  const seedSeekers = db.flatmateSeekers || db.flatmates?.filter?.((f) => f.kind === 'seeker') || [];
  const seedGroups = db.flatmateGroups || db.flatmates?.filter?.((f) => f.kind === 'group') || [];
  return {
    seekers: [...getFlatmatePosts(), ...seedSeekers],
    groups: [...getFlatmateGroups(), ...seedGroups],
    rooms: getRooms(),
    apps: db.groupApplications || db.flatmateApplications || [],
  };
}

/* Write the verdict wherever the row actually lives.

   The localStorage stores are tried first and the mock DB second, because a
   consumer-posted row is the one a moderator is most likely acting on. Each
   `update*` is a no-op when the id is absent, so the sequence is safe; `found`
   stops the mock-DB fallback from running once a store has claimed the row. */
function setFlatStatus(id, status) {
  let found = false;
  for (const [get, update] of [
    [getFlatmatePosts, updateFlatmatePost],
    [getFlatmateGroups, updateFlatmateGroup],
    [getRooms, updateRoom],
  ]) {
    if (get().some((x) => x.id === id)) {
      update(id, { modStatus: status });
      found = true;
      break;
    }
  }
  if (found) return;
  mutateDb((db) => {
    const colls = ['flatmateSeekers', 'flatmateGroups', 'flatmates'];
    for (const col of colls) {
      const item = (db[col] || []).find((x) => x.id === id);
      if (item) { item.modStatus = status; return; }
    }
  });
}
function setAppStatus(id, modStatus) {
  mutateDb((db) => {
    const item = (db.groupApplications || db.flatmateApplications || []).find((x) => x.id === id);
    if (item) item.modStatus = modStatus;
  });
}

export default function AdminFlatmates() {
  const { toast } = useToast();
  const { optionEnabled } = useAdminFlags();
  const [data, setData] = useState(null);
  const [tab, setTab] = useTabParam(['seekers', 'rooms', 'groups', 'apps'], 'seekers');

  const reload = () => setData(loadFlatmates());
  useEffect(() => { setData(loadFlatmates()); }, []);

  const act = (id, status, msg) => {
    const note = (status === 'flagged' || status === 'removed') ? window.prompt('Internal note (optional):') : null;
    setFlatStatus(id, status);
    if (note) addInternalNote('flatmate', id, note, status);
    logAudit('Flatmate', `Set ${id} → ${status}`);
    reload();
    toast(msg || status);
  };
  const actApp = (id, status, msg) => {
    const note = (status === 'flagged' || status === 'removed') ? window.prompt('Internal note (optional):') : null;
    setAppStatus(id, status);
    if (note) addInternalNote('flatmate-app', id, note, status);
    logAudit('Flatmate', `Application ${id} → ${status}`);
    reload();
    toast(msg || status);
  };

  if (!data) return <Loading />;
  const { seekers, groups, rooms, apps } = data;
  // Rooms count too — they are moderatable now, so a flagged room must show up in
  // the number ops actually watches, not just in its own tab.
  const flagged = [...seekers, ...groups, ...rooms].filter((x) => x.modStatus === 'flagged').length;

  const KPIS = [
    optionEnabled('flatmates.seekers') && { label: 'Seekers', value: fmtNum(seekers.length), icon: UsersRound, tab: 'seekers' },
    { label: 'Rooms', value: fmtNum(rooms.length), icon: DoorOpen, tab: 'rooms' },
    optionEnabled('flatmates.groups') && { label: 'Groups', value: fmtNum(groups.length), icon: Users, tab: 'groups' },
    { label: 'Flagged', value: fmtNum(flagged), icon: Flag, tab: null },
    optionEnabled('flatmates.applications') && { label: 'Applications', value: fmtNum(apps.length), icon: Inbox, tab: 'apps' },
  ].filter(Boolean);

  const seekerCols = [
    { key: 'name', header: 'Seeker', render: (s) => <div><div className="font-semibold">{s.name || '—'}</div><div className="text-xs text-gray-400">{s.id}{s.seed ? ' · demo' : ''}</div></div> },
    { key: 'gender', header: 'Gender', render: (s) => s.gender === 'female' ? 'Woman' : s.gender === 'male' ? 'Man' : '—' },
    { key: 'budget', header: 'Budget', render: (s) => s.budget ? fmtINR(s.budget) : '—' },
    { key: 'localities', header: 'Localities', render: (s) => (s.localities || (s.locality ? [s.locality] : [])).join(', ') || '—' },
    { key: 'verified', header: 'Verified', render: (s) => <Badge status={s.verified ? 'active' : 'pending'}>{s.verified ? 'Verified' : 'No'}</Badge> },
    { key: 'status', header: 'Status', render: (s) => <Badge status={MOD_BADGE[s.modStatus] || 'active'}>{MOD_LABEL[s.modStatus] || s.modStatus || 'Live'}</Badge> },
    { key: 'actions', header: '', className: 'whitespace-nowrap', render: (s) => (
      <div className="flex flex-wrap gap-1">
        {!['live', 'approved'].includes(s.modStatus || 'live') ? <button onClick={() => act(s.id, 'live', 'Approved')} className="rounded-lg border border-brand-teal/30 bg-brand-teal/10 px-2 py-1 text-xs text-brand-teal">Approve</button> : null}
        {s.modStatus !== 'flagged' ? <button onClick={() => act(s.id, 'flagged', 'Flagged')} className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">Flag</button> : null}
        {s.modStatus !== 'removed' ? <button onClick={() => act(s.id, 'removed', 'Removed')} className="rounded-lg border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs text-red-300">Remove</button> : null}
      </div>
    ) },
  ];

  const groupCols = [
    { key: 'title', header: 'Group', render: (g) => <div><div className="font-semibold">{g.title || '—'}</div><div className="text-xs text-gray-400">{g.id}{g.seed ? ' · demo' : ''}{g.target ? ' · applied to flat' : ''}</div></div> },
    { key: 'locality', header: 'Locality', render: (g) => g.locality || '—' },
    { key: 'policy', header: 'Open to', render: (g) => policyLabel(g.policy) },
    { key: 'perHead', header: 'Per-head', render: (g) => g.seatsTotal ? fmtINR(Math.round((g.rent || 0) / g.seatsTotal)) + '/mo' : (g.rent ? fmtINR(g.rent) + '/mo' : '—') },
    { key: 'members', header: 'Members', render: (g) => `${Array.isArray(g.members) ? g.members.length : (g.members || 0)} / ${g.seatsTotal || '—'}` },
    { key: 'status', header: 'Status', render: (g) => <Badge status={MOD_BADGE[g.modStatus] || 'active'}>{MOD_LABEL[g.modStatus] || g.modStatus || 'Live'}</Badge> },
    { key: 'actions', header: '', className: 'whitespace-nowrap', render: (g) => (
      <div className="flex flex-wrap gap-1">
        {!['live', 'approved'].includes(g.modStatus || 'live') ? <button onClick={() => act(g.id, 'live', 'Approved')} className="rounded-lg border border-brand-teal/30 bg-brand-teal/10 px-2 py-1 text-xs text-brand-teal">Approve</button> : null}
        {g.modStatus !== 'flagged' ? <button onClick={() => act(g.id, 'flagged', 'Flagged')} className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">Flag</button> : null}
        {g.modStatus !== 'removed' ? <button onClick={() => act(g.id, 'removed', 'Removed')} className="rounded-lg border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs text-red-300">Remove</button> : null}
      </div>
    ) },
  ];

  const appCols = [
    { key: 'group', header: 'Group', render: (a) => <div><div className="font-semibold">{a.groupTitle || '—'}</div><div className="text-xs text-gray-400">by {a.applicantName || '—'}</div></div> },
    { key: 'listing', header: 'Listing', render: (a) => a.listingTitle || '—' },
    { key: 'perHead', header: 'Per-head', render: (a) => a.perHead ? fmtINR(a.perHead) + '/mo' : '—' },
    { key: 'members', header: 'Members', render: (a) => `${a.members || '—'} / ${a.seatsTotal || '—'}` },
    { key: 'ownerDecision', header: 'Owner decision', render: (a) => <Badge status={OWNER_BADGE[a.status] || 'pending'}>{OWNER_LABEL[a.status] || a.status || 'Pending'}</Badge> },
    { key: 'modStatus', header: 'Mod status', render: (a) => <Badge status={MOD_BADGE[a.modStatus] || 'active'}>{MOD_LABEL[a.modStatus] || a.modStatus || 'Live'}</Badge> },
    { key: 'actions', header: '', className: 'whitespace-nowrap', render: (a) => (
      <div className="flex flex-wrap gap-1">
        {a.modStatus !== 'live' && a.modStatus !== 'approved' ? <button onClick={() => actApp(a.id, 'approved', 'Approved')} className="rounded-lg border border-brand-teal/30 bg-brand-teal/10 px-2 py-1 text-xs text-brand-teal">Approve</button> : null}
        {a.modStatus !== 'flagged' ? <button onClick={() => actApp(a.id, 'flagged', 'Flagged')} className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">Flag</button> : null}
        {a.modStatus !== 'removed' ? <button onClick={() => actApp(a.id, 'removed', 'Removed')} className="rounded-lg border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs text-red-300">Remove</button> : null}
      </div>
    ) },
  ];

  const roomCols = [
    { key: 'title', header: 'Room', render: (r) => <div><div className="font-semibold">{roomName(r)}</div><div className="text-xs text-gray-400">{r.id}{r.seed ? ' · demo' : ''}</div></div> },
    { key: 'locality', header: 'Locality', render: (r) => r.locality || (Array.isArray(r.localities) ? r.localities.join(', ') : '') || '—' },
    { key: 'rent', header: 'Rent', render: (r) => r.rent ? fmtINR(r.rent) + '/mo' : '—' },
    { key: 'seats', header: 'Seats', render: (r) => `${r.occupants ?? 0} / ${r.seatsTotal ?? r.capacity ?? '—'}` },
    { key: 'status', header: 'Status', render: (r) => <Badge status={MOD_BADGE[r.modStatus] || 'active'}>{MOD_LABEL[r.modStatus] || r.modStatus || 'Live'}</Badge> },
    { key: 'actions', header: '', className: 'whitespace-nowrap', render: (r) => <ModActions item={r} onAct={act} /> },
  ];

  const roomCard = (r) => (
    <div className="pn-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-white">{roomName(r)}</div>
          <div className="text-xs text-gray-400">{r.id}{r.seed ? ' · demo' : ''}</div>
        </div>
        <Badge status={MOD_BADGE[r.modStatus] || 'active'}>{MOD_LABEL[r.modStatus] || r.modStatus || 'Live'}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <CardField label="Locality" wide>{r.locality || (Array.isArray(r.localities) ? r.localities.join(', ') : '') || '—'}</CardField>
        <CardField label="Rent">{r.rent ? fmtINR(r.rent) + '/mo' : '—'}</CardField>
        <CardField label="Seats">{`${r.occupants ?? 0} / ${r.seatsTotal ?? r.capacity ?? '—'}`}</CardField>
      </dl>
      <div className="mt-3 border-t border-white/5 pt-3">
        <ModActions item={r} onAct={act} />
      </div>
    </div>
  );

  const seekerCard = (s) => (
    <div className="pn-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-white">{s.name || '—'}</div>
          <div className="text-xs text-gray-400">{s.id}{s.seed ? ' · demo' : ''}</div>
        </div>
        <Badge status={MOD_BADGE[s.modStatus] || 'active'}>{MOD_LABEL[s.modStatus] || s.modStatus || 'Live'}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <CardField label="Gender">{s.gender === 'female' ? 'Woman' : s.gender === 'male' ? 'Man' : '—'}</CardField>
        <CardField label="Budget">{s.budget ? fmtINR(s.budget) : '—'}</CardField>
        <CardField label="Localities" wide>{(s.localities || (s.locality ? [s.locality] : [])).join(', ') || '—'}</CardField>
        <CardField label="Verified"><Badge status={s.verified ? 'active' : 'pending'}>{s.verified ? 'Verified' : 'No'}</Badge></CardField>
      </dl>
      <div className="mt-3 border-t border-white/5 pt-3">
        <ModActions item={s} onAct={act} />
      </div>
    </div>
  );

  const groupCard = (g) => (
    <div className="pn-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-white">{g.title || '—'}</div>
          <div className="text-xs text-gray-400">{g.id}{g.seed ? ' · demo' : ''}{g.target ? ' · applied to flat' : ''}</div>
        </div>
        <Badge status={MOD_BADGE[g.modStatus] || 'active'}>{MOD_LABEL[g.modStatus] || g.modStatus || 'Live'}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <CardField label="Locality">{g.locality || '—'}</CardField>
        <CardField label="Open to">{policyLabel(g.policy)}</CardField>
        <CardField label="Per-head">{g.seatsTotal ? fmtINR(Math.round((g.rent || 0) / g.seatsTotal)) + '/mo' : (g.rent ? fmtINR(g.rent) + '/mo' : '—')}</CardField>
        <CardField label="Members">{`${Array.isArray(g.members) ? g.members.length : (g.members || 0)} / ${g.seatsTotal || '—'}`}</CardField>
      </dl>
      <div className="mt-3 border-t border-white/5 pt-3">
        <ModActions item={g} onAct={act} />
      </div>
    </div>
  );

  const appCard = (a) => (
    <div className="pn-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-white">{a.groupTitle || '—'}</div>
          <div className="text-xs text-gray-400">by {a.applicantName || '—'}</div>
        </div>
        <Badge status={MOD_BADGE[a.modStatus] || 'active'}>{MOD_LABEL[a.modStatus] || a.modStatus || 'Live'}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <CardField label="Listing" wide>{a.listingTitle || '—'}</CardField>
        <CardField label="Per-head">{a.perHead ? fmtINR(a.perHead) + '/mo' : '—'}</CardField>
        <CardField label="Members">{`${a.members || '—'} / ${a.seatsTotal || '—'}`}</CardField>
        <CardField label="Owner decision" wide><Badge status={OWNER_BADGE[a.status] || 'pending'}>{OWNER_LABEL[a.status] || a.status || 'Pending'}</Badge></CardField>
      </dl>
      <div className="mt-3 border-t border-white/5 pt-3">
        <ModActions item={a} onAct={actApp} approveStatus="approved" />
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader title="Flatmate" subtitle="Moderate flatmate seekers, groups & applications." />

      {/* KPI tiles */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPIS.map((k) => (
          <div key={k.label} onClick={k.tab ? () => setTab(k.tab) : undefined} className={classNames('pn-card p-4', k.tab && 'cursor-pointer hover:bg-white/5')}>
            <div className="flex items-start justify-between">
              <div><div className="text-xs text-gray-400">{k.label}</div><div className="mt-1 text-2xl font-extrabold">{k.value}</div></div>
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-teal/15 text-brand-teal"><k.icon className="h-4 w-4" /></span>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
        {[['seekers', 'Seekers', 'Seekers', 'flatmates.seekers'], ['rooms', 'Rooms', 'Rooms', null], ['groups', 'Groups', 'Groups', 'flatmates.groups'], ['apps', 'Group Applications', 'Applications', 'flatmates.applications']].filter(([, , , flag]) => flag === null || optionEnabled(flag)).map(([id, label, shortLabel]) => (
          <button key={id} onClick={() => setTab(id)} className={classNames('flex-1 rounded-lg px-2 py-2 text-xs font-medium transition sm:px-4 sm:text-sm', tab === id ? 'bg-brand-teal text-ink' : 'text-gray-300 hover:text-white')}>
            <span className="sm:hidden">{shortLabel}</span>
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {tab === 'seekers' ? (
        <div>
          <p className="mb-2 text-xs text-gray-400">Moderate flatmate seekers. Removed or rejected posts disappear from the public Flatmates board.</p>
          <Table columns={seekerCols} rows={seekers} pageSize={10} label="seekers" empty="No seekers yet." mobileCard={seekerCard} />
        </div>
      ) : tab === 'rooms' ? (
        <div>
          <p className="mb-2 text-xs text-gray-400">Moderate rooms offered inside a flat. Free-text title, address and price make this the most abusable flatmate surface — flagged and removed rooms disappear from the public board.</p>
          <Table columns={roomCols} rows={rooms} pageSize={10} label="rooms" empty="No rooms yet." mobileCard={roomCard} />
        </div>
      ) : tab === 'groups' ? (
        <div>
          <p className="mb-2 text-xs text-gray-400">Moderate flatmate groups that pool tenants to split a whole flat.</p>
          <Table columns={groupCols} rows={groups} pageSize={10} label="groups" empty="No groups yet." mobileCard={groupCard} />
        </div>
      ) : (
        <div>
          <p className="mb-2 text-xs text-gray-400">Group applications submitted to owners' whole-flat listings.</p>
          <Table columns={appCols} rows={apps} pageSize={10} label="applications" empty="No applications yet." mobileCard={appCard} />
        </div>
      )}
    </div>
  );
}
