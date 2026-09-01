/*
 * Filter vocabularies for the demand console.
 *
 * Each list is a **union of two vocabularies** while the mock store is still around (D25). The
 * server's contact requests are `pending | approved | declined`; the browser store's enquiries are
 * `new | open | responded | closed`, and those rows are still read by the analytics seam, so
 * rewriting the seed to match the contract would move a bug into a different console rather than
 * removing one.
 *
 * Offering both is the lesser evil: an option that matches nothing shows an empty table, which is
 * legible. Offering only the contract's words would leave the mock console unable to filter at all,
 * and offering only the mock's would do the same to the live one — and that failure looks like the
 * filter being broken rather than like a value not being present.
 *
 * When the mock store's enquiry rows go, delete the second group in each list.
 */
const ENQUIRY_STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
  { value: 'new', label: 'New' },
  { value: 'open', label: 'Open' },
  { value: 'responded', label: 'Responded' },
  { value: 'closed', label: 'Closed' },
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
 * The statuses meaning "this request has not been answered yet" — in **both** vocabularies.
 *
 * This list exists because the console had two call sites that needed the same answer and only one
 * of them knew about the server. The "Responded" button offered itself on
 * `new | open | pending`, correctly; the KPI tile counted `new | open` alone. On a live build the
 * server emits `pending | approved | declined` and never the other two, so the tile rendered a
 * confident `0` over a board that had three unanswered requests on it — and a zero is the one
 * number nobody double-checks, because it reads as "nothing to do here" rather than as a fault.
 *
 * `pending` is the live word and the only one that belongs to the contract: per
 * `ContactRequestStatuses`, it means *awaiting the owner's decision*, and the only legal moves out
 * of it are `approved` and `declined` — both made by the owner, neither by this desk. That is why
 * the tile is labelled "Awaiting owner" rather than "Open leads": the row is not waiting on ops.
 *
 * `new` and `open` are the browser store's, kept only so the offline `npm run dev` desk still counts
 * something. Delete them with the rest of the mock enquiry rows, and delete the second group in
 * `ENQUIRY_STATUS_OPTS` in the same commit.
 */
const AWAITING_STATUSES = ['pending', 'new', 'open'];

export { ENQUIRY_STATUS_OPTS, VISIT_STATUS_OPTS, DEAL_STATUS_OPTS, DEAL_TYPE_OPTS, AWAITING_STATUSES };
