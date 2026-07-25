const ENQUIRY_STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'open', label: 'Open' },
  { value: 'responded', label: 'Responded' },
  { value: 'closed', label: 'Closed' },
];
const VISIT_STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];
const DEAL_STATUS_OPTS = [
  { value: '', label: 'All statuses' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'closed', label: 'Closed' },
];
const ENQUIRY_TYPE_OPTS = [
  { value: '', label: 'All types' },
  { value: 'call', label: 'Call back' },
  { value: 'chat', label: 'Chat' },
  { value: 'visit', label: 'Visit' },
];
const DEAL_TYPE_OPTS = [
  { value: '', label: 'All types' },
  { value: 'rent', label: 'Rent' },
  { value: 'buy', label: 'Buy' },
];

export { ENQUIRY_STATUS_OPTS, VISIT_STATUS_OPTS, DEAL_STATUS_OPTS, ENQUIRY_TYPE_OPTS, DEAL_TYPE_OPTS };
