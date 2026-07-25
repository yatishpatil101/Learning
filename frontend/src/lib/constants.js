/* Centralized status enums — prevents typos and enables IDE autocomplete.
   Use these constants instead of raw strings when comparing statuses. */

export const VISIT_STATUS = {
  SCHEDULED: 'scheduled',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no-show',
};

export const LISTING_STATUS = {
  UNDER_REVIEW: 'Under Review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  SOLD: 'sold',
  RENTED: 'rented',
  UNDER_OFFER: 'under_offer',
  DELETED: 'deleted',
};

export const REVIEW_STATUS = {
  IN_REVIEW: 'in_review',
  PENDING: 'pending',
  CLARIFICATION: 'clarification',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
};

export const DEAL_TYPE = {
  BUY: 'buy',
  RENT: 'rent',
};

export const USER_ROLE = {
  BUYER: 'buyer',
  OWNER: 'owner',
  ADMIN: 'admin',
  STAFF: 'staff',
};

export const CONTACT_STATUS = {
  NONE: 'none',
  PENDING: 'pending',
  APPROVED: 'approved',
  DECLINED: 'declined',
  OWNER: 'owner',
  AADHAAR_REQUIRED: 'aadhaar_required',
  LOGIN: 'login',
};
