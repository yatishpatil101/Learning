/*
 * Filter vocabularies for the demand console.
 */
const ENQUIRY_STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
];
const VISIT_STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'no-show', label: 'No show' },
];
const DEAL_STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'reserved', label: 'Reserved' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'closed', label: 'Closed' },
];
const DEAL_TYPE_OPTS = [
  { value: '', label: 'All types' },
  { value: 'rent', label: 'Rent' },
  { value: 'buy', label: 'Buy' },
];

/**
 * The statuses meaning "this request has not been answered yet".
 *
 * One list, because the console has two call sites that need the same answer and they must not
 * drift: the "Responded" button offers itself on these, and the KPI tile counts them. Let them
 * disagree and the tile renders a confident `0` over a board with three unanswered requests on it
 * — and a zero is the one number nobody double-checks, because it reads as "nothing to do here"
 * rather than as a fault.
 *
 * `pending` is the only status that belongs here: per `ContactRequestStatuses` it means *awaiting the
 * owner's decision*, and the only legal moves out of it are `approved` and `declined` — both made by
 * the owner, neither by this desk. That is why the tile is labelled "Awaiting owner" rather than
 * "Open leads": the row is not waiting on ops. It stays a list so a second awaiting status cannot
 * be added to only one of the two call sites.
 */
const AWAITING_STATUSES = ['pending'];

export { ENQUIRY_STATUS_OPTS, VISIT_STATUS_OPTS, DEAL_STATUS_OPTS, DEAL_TYPE_OPTS, AWAITING_STATUSES };
