/**
 * Pure presentation helpers for service-request status.
 *
 * The request data lives behind `serviceRequestService.js`; this file deliberately has no storage,
 * network, or user-state dependency so the tracker can render a server response without importing
 * the retired localStorage workflow engine.
 */
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
  awaiting_payment: { label: 'Payment pending', color: '#fcd34d', bg: 'rgba(245,158,11,.2)', icon: 'clock' },
  awaiting_party: { label: 'Waiting for the other party', color: '#fcd34d', bg: 'rgba(245,158,11,.2)', icon: 'hourglass' },
  submitted: { label: 'Submitted', color: '#a5b4fc', bg: 'rgba(99,102,241,.2)', icon: 'inbox' },
  docs_review: { label: 'Documents under review', color: '#fcd34d', bg: 'rgba(245,158,11,.2)', icon: 'folder-check' },
  draft_shared: { label: 'Draft ready for your review', color: '#5eead4', bg: 'rgba(20,184,166,.2)', icon: 'file-pen-line' },
  changes_requested: { label: 'Changes requested', color: '#fda4af', bg: 'rgba(244,63,94,.2)', icon: 'rotate-ccw' },
  approved: { label: 'Approved — awaiting registration', color: '#5eead4', bg: 'rgba(20,184,166,.2)', icon: 'check' },
  registration: { label: 'In government registration', color: '#fcd34d', bg: 'rgba(245,158,11,.2)', icon: 'landmark' },
  completed: { label: 'Registered & ready', color: '#6ee7b7', bg: 'rgba(16,185,129,.2)', icon: 'badge-check' },
  cancelled: { label: 'Cancelled', color: '#9ca3af', bg: 'rgba(148,163,184,.2)', icon: 'x-circle' },
};

const activeStep = (status) => (ACTIVE[status] == null ? 0 : ACTIVE[status]);

export const stepStates = (status) => {
  if (status === 'completed') return STEPS.map(() => 'done');
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
  STATUS_META[status] || { label: 'In progress', color: '#d1d5db', bg: 'rgba(255,255,255,.1)', icon: 'loader' };

/** Route a legacy invite token to the rent-agreement entry point. */
export const invitePath = (inviteId) =>
  `/services/rent-agreement?invite=${encodeURIComponent(inviteId || '')}`;

/** Route an API invite row to the invited party's detail flow. */
export const inviteRouteFor = (row) =>
  `/services/rent-agreement?party=${encodeURIComponent(row?.id || '')}&request=${encodeURIComponent(row?.requestId || '')}`;