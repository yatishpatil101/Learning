export const DOC_LABELS = {
  aadhaar: 'Aadhaar',
  pan: 'PAN',
  passport: 'Passport',
  voter_id: 'Voter ID',
  driving_licence: 'Driving licence',
};

export const DOC_OPTIONS = [
  { value: '', label: 'Any doc' },
  { value: 'aadhaar', label: 'Aadhaar' },
  { value: 'pan', label: 'PAN' },
  { value: 'passport', label: 'Passport' },
  { value: 'voter_id', label: 'Voter ID' },
  { value: 'driving_licence', label: 'DL' },
];

/* What a reviewer must see with their own eyes before approving. Approve stays locked until every
   line is ticked — the server cannot check a photo, so this list is the human half of the gate. */
export const CHECKLISTS = {
  aadhaar: ['Name matches the card', 'DOB or birth year matches', 'Photo matches the selfie', 'Not a masked or photocopied Aadhaar'],
  pan: ['Name matches exactly', 'DOB matches', 'PAN number is clear and unedited', 'Photo or signature supports the holder'],
  passport: ['Photo page with MRZ visible', 'Name and DOB match', 'Photo matches the selfie', 'Passport is not expired'],
  voter_id: ['EPIC number on the front', 'Name and DOB or age match', 'Photo matches the selfie', 'Address on the back'],
  driving_licence: ['Name and DOB match', 'Photo matches the selfie', 'Licence is not expired'],
};
export const DEFAULT_CHECKLIST = ['Number, name and DOB match', 'Photo matches the selfie'];

export const REJECTION_LABELS = {
  blurry: 'Blurry image',
  cropped: 'Document cropped',
  mismatch: 'Details do not match',
  expired: 'Expired document',
  not_holder: 'Not the document holder',
  unsupported: 'Unsupported document',
  other: 'Other reason',
  not_reviewed: 'Auto-closed: not reviewed',
};
export const STAFF_REASONS = ['blurry', 'cropped', 'mismatch', 'expired', 'not_holder', 'unsupported', 'other'];
export const NOTE_REQUIRED_REASONS = new Set(['other', 'mismatch', 'not_holder']);

export const POSE_LABELS = {
  left: "Turned to their left (nose toward the photo's right edge)",
  right: "Turned to their right (nose toward the photo's left edge)",
  smile: 'Smiling',
};

export const STATUS_LABELS = { pending: 'Pending', verified: 'Verified', rejected: 'Rejected', revoked: 'Revoked' };

export const CLAIM_HOLD_LIMIT = 3;
/* OVERDUE_HOURS must match IdentityReviewQueueService.OVERDUE_AFTER, which filters "Overdue" server-side. */
export const WARN_HOURS = 24;
export const OVERDUE_HOURS = 48;

const ERROR_MESSAGES = {
  identity_case_claim_limit: `You already hold ${CLAIM_HOLD_LIMIT} cases — release one first.`,
  identity_qa_open: 'This sampled approval is still awaiting QA review.',
  identity_pose_unconfirmed: 'Confirm the requested pose before approving.',
};

export const docLabel = (value) => DOC_LABELS[value] || String(value || '—').replace(/_/g, ' ');
export const reasonLabel = (value) => REJECTION_LABELS[value] || String(value || '—').replace(/_/g, ' ');
export const dateLabel = (value) => (value ? new Date(value).toLocaleString() : '—');
export const sameId = (a, b) => Boolean(a && b && String(a) === String(b));
export const errorCode = (error) => String(error?.code || '').toLowerCase();
export const errorMessage = (error, fallback) => ERROR_MESSAGES[errorCode(error)] || error?.message || fallback;

export function normalizedName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function elapsed(at) {
  if (!at) return null;
  const hours = Math.max(0, (Date.now() - at) / 3600000);
  const text = hours < 1 ? `${Math.max(1, Math.round(hours * 60))}m` : hours < 48 ? `${Math.floor(hours)}h` : `${Math.floor(hours / 24)}d`;
  const tone = hours >= OVERDUE_HOURS ? 'breach' : hours >= WARN_HOURS ? 'warn' : 'ok';
  return { text, tone };
}

export const isOpenQa = (detail) => detail?.status === 'verified' && Boolean(detail?.awaitingQa);

// The server withholds the sample date from the approver alone (maker-checker).
export const isOwnQaApproval = (detail) => isOpenQa(detail) && !detail.qaSampledAt;
