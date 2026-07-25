export const STAGE_BADGE = {
  submitted: 'bg-indigo-500/15 text-indigo-300', docs_review: 'bg-amber-500/15 text-amber-300',
  draft_shared: 'bg-teal-500/15 text-teal-300', changes_requested: 'bg-rose-500/15 text-rose-300',
  approved: 'bg-teal-500/15 text-teal-300', registration: 'bg-amber-500/15 text-amber-300',
  completed: 'bg-emerald-500/15 text-emerald-300', awaiting_party: 'bg-slate-500/15 text-slate-300',
  cancelled: 'bg-slate-500/15 text-slate-400',
};
export const DOC_PILL = {
  verified: 'bg-emerald-500/15 text-emerald-300', rejected: 'bg-rose-500/15 text-rose-300',
  submitted: 'bg-amber-500/15 text-amber-300',
};

export const STAGE_OPTS = (svc) => [
  { value: '', label: 'All stages' },
  { value: 'open', label: 'Open (needs action)' },
  { value: 'action', label: 'Needs action' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'docs_review', label: 'Documents under review' },
  { value: 'draft_shared', label: (svc.draftNoun || 'Draft') + ' shared' },
  { value: 'changes_requested', label: 'Changes requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'registration', label: svc.regNoun || 'Registration' },
  { value: 'completed', label: 'Completed' },
];
