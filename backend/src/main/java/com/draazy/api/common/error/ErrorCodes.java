package com.draazy.api.common.error;

public final class ErrorCodes {

    private ErrorCodes() {
    }

    public static final String BAD_REQUEST = "bad_request";

    public static final String UNAUTHORIZED = "unauthorized";

    /** 403 — authenticated but not permitted (RBAC deny, or an owner-only action). */
    public static final String FORBIDDEN = "forbidden";

    /** 404 — no such resource, or archived and hidden from this caller. */
    public static final String NOT_FOUND = "not_found";

    public static final String CONFLICT = "conflict";

    public static final String NAME_LOCKED_WHILE_VERIFIED = "NAME_LOCKED_WHILE_VERIFIED";

    public static final String VALIDATION_FAILED = "validation_failed";

    public static final String ACCOUNT_ARCHIVED = "account_archived";

    public static final String SIGNUPS_CLOSED = "signups_closed";

    // 403 on /auth/login: back-office accounts sign in with password + authenticator only.
    public static final String STAFF_SIGN_IN_REQUIRED = "staff_sign_in_required";

    // 401: the password-step challenge is missing, forged or older than five minutes.
    public static final String STAFF_SIGN_IN_EXPIRED = "staff_sign_in_expired";

    // 429: five consecutive misses on one back-office account.
    public static final String STAFF_SIGN_IN_LOCKED = "staff_sign_in_locked";

    public static final String VERIFICATION_REQUIRED = "verification_required";

    public static final String IDENTITY_ALREADY_REGISTERED = "identity_already_registered";

    public static final String IDENTITY_DISPUTE_OPEN = "identity_dispute_open";

    public static final String IDENTITY_NO_RECENT_CONFLICT = "identity_no_recent_conflict";

    public static final String IDENTITY_CASE_CLAIMED = "identity_case_claimed";

    public static final String IDENTITY_CASE_CLAIM_LIMIT = "identity_case_claim_limit";

    public static final String IDENTITY_QA_OPEN = "identity_qa_open";

    public static final String IDENTITY_CHALLENGE_INVALID = "identity_challenge_invalid";

    public static final String IDENTITY_POSE_UNCONFIRMED = "identity_pose_unconfirmed";

    public static final String IDENTITY_NUMBER_MISMATCH = "identity_number_mismatch";

    public static final String OWNER_CONSENT_SELF = "owner_consent_self";

    // No permission fixes it, only a completed visit or a tenancy does.
    public static final String REVIEW_NOT_ELIGIBLE = "review_not_eligible";

    public static final String CONTACT_QUOTA_EXHAUSTED = "contact_quota_exhausted";

    public static final String LISTING_QUOTA_EXHAUSTED = "listing_quota_exhausted";

    public static final String ALREADY_REVIEWED = "already_reviewed";

    public static final String PRECONDITION_FAILED = "precondition_failed";

    /** 429 — rate limit exceeded (e.g. OTP requests); pairs with a Retry-After hint. */
    public static final String RATE_LIMITED = "rate_limited";

    // Its own code because waiting cannot help; see docs/system/api-standards.md §4.2.
    public static final String OTP_ATTEMPTS_EXHAUSTED = "otp_attempts_exhausted";

    public static final String MAINTENANCE_MODE = "maintenance_mode";

    // 413 — the uploaded file exceeds the size limit.
    // Raised by our own check and by the servlet container's multipart limit; both paths must emit this code.
    public static final String PAYLOAD_TOO_LARGE = "payload_too_large";

    public static final String UNSUPPORTED_MEDIA_TYPE = "unsupported_media_type";

    public static final String METHOD_NOT_ALLOWED = "method_not_allowed";

    /** 500 — catch-all. The message is deliberately generic: never leak internals to the client. */
    public static final String INTERNAL = "internal";

    // The filter chain and exception handler share strings so clients see one API.
    public static final class Messages {

        private Messages() {
        }

        public static final String AUTH_REQUIRED = "Authentication required";

        public static final String ACCESS_DENIED = "You do not have permission to perform this action";

        // Hide Jackson details because they can expose Java types and payload fragments.
        public static final String MALFORMED_BODY = "Request body could not be read";

        public static final String METHOD_NOT_ALLOWED = "That method is not supported on this resource";

        public static final String UNSUPPORTED_CONTENT_TYPE = "That content type is not supported on this resource";
    }
}
