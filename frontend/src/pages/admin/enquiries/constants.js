const ENQUIRY_STATUS_OPTS = [['', 'All'], ['pending', 'Awaiting owner'], ['approved', 'Approved'], ['declined', 'Declined']];
const VISIT_STATUS_OPTS = [['', 'All'], ['scheduled', 'Scheduled'], ['confirmed', 'Confirmed'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['no-show', 'No show']];
const DEAL_STATUS_OPTS = [['', 'All'], ['active', 'Active'], ['reserved', 'Reserved'], ['closed', 'Closed']];
const DEAL_TYPE_OPTS = [['', 'All'], ['rent', 'Rent'], ['buy', 'Buy']];

/* Shared by the "Responded" button and the status filter so they cannot drift;
   `pending` awaits the owner's decision, not ops. */
const AWAITING_STATUSES = ['pending'];

export { ENQUIRY_STATUS_OPTS, VISIT_STATUS_OPTS, DEAL_STATUS_OPTS, DEAL_TYPE_OPTS, AWAITING_STATUSES };
