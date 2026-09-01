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

export { ENQUIRY_STATUS_OPTS, VISIT_STATUS_OPTS, DEAL_STATUS_OPTS, DEAL_TYPE_OPTS };
