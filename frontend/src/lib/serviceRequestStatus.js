/** No storage, network or user-state dependency, so the tracker can render a server response with it. */
export const STEPS = ['Submitted', 'Documents', 'Draft & approval', 'Registration', 'Ready'];

const ACTIVE = {
  awaiting_payment: 0,
  awaiting_party: 0,
  submitted: 1,
  docs_review: 1,
  draft_shared: 2,
  changes_requested: 2,
  approved: 3,
  registration: 3,
  completed: 4,
  cancelled: 0,
};

const STATUS_META = {
  awaiting_payment: { label: 'Unpaid · not submitted', color: 'rgb(var(--dz-c-amber-300))', bg: 'rgb(var(--dz-c-amber-500) / .2)', icon: 'clock' },
  awaiting_party: { label: 'Waiting for the other party', color: 'rgb(var(--dz-c-amber-300))', bg: 'rgb(var(--dz-c-amber-500) / .2)', icon: 'hourglass' },
  submitted: { label: 'Submitted', color: 'rgb(var(--dz-c-indigo-300))', bg: 'rgb(var(--dz-c-indigo-500) / .2)', icon: 'inbox' },
  docs_review: { label: 'Documents under review', color: 'rgb(var(--dz-c-amber-300))', bg: 'rgb(var(--dz-c-amber-500) / .2)', icon: 'folder-check' },
  draft_shared: { label: 'Draft ready for your review', color: 'rgb(var(--dz-c-teal-300))', bg: 'rgb(var(--dz-c-teal-500) / .2)', icon: 'file-pen-line' },
  changes_requested: { label: 'Changes requested', color: 'rgb(var(--dz-c-rose-300))', bg: 'rgb(var(--dz-c-rose-500) / .2)', icon: 'rotate-ccw' },
  approved: { label: 'Approved — awaiting registration', color: 'rgb(var(--dz-c-teal-300))', bg: 'rgb(var(--dz-c-teal-500) / .2)', icon: 'check' },
  registration: { label: 'In government registration', color: 'rgb(var(--dz-c-amber-300))', bg: 'rgb(var(--dz-c-amber-500) / .2)', icon: 'landmark' },
  completed: { label: 'Registered & ready', color: 'rgb(var(--dz-c-emerald-300))', bg: 'rgb(var(--dz-c-emerald-500) / .2)', icon: 'badge-check' },
  cancelled: { label: 'Cancelled', color: 'rgb(var(--dz-c-gray-400))', bg: 'rgb(var(--dz-c-slate-400) / .2)', icon: 'x-circle' },
};

const activeStep = (status) => (ACTIVE[status] == null ? 0 : ACTIVE[status]);

export const stepStates = (status) => {
  if (status === 'completed') return STEPS.map(() => 'done');
  // Unpaid is not submitted: nothing is in progress until the payment lands.
  if (status === 'awaiting_payment') return STEPS.map(() => 'todo');
  const active = activeStep(status);
  return STEPS.map((_, index) => (index < active ? 'done' : index === active ? 'active' : 'todo'));
};

export const isActive = (status) => status !== 'completed' && status !== 'cancelled';

export const progressPct = (status) => {
  if (status === 'cancelled') return null;
  if (status === 'completed') return 100;
  return Math.round((activeStep(status) / (STEPS.length - 1)) * 100);
};

export const statusMeta = (status) =>
  STATUS_META[status] || { label: 'In progress', color: 'rgb(var(--dz-c-gray-300))', bg: 'rgb(var(--dz-c-white) / .1)', icon: 'loader' };

/** Route a legacy invite token to the rent-agreement entry point. */
export const invitePath = (inviteId) =>
  `/services/rent-agreement?invite=${encodeURIComponent(inviteId || '')}`;

/** Route an API invite row to the invited party's detail flow. */
export const inviteRouteFor = (row) =>
  `/services/rent-agreement?party=${encodeURIComponent(row?.id || '')}&request=${encodeURIComponent(row?.requestId || '')}`;