package com.draazy.api.common.error;

/**
 * The machine-readable {@code error} codes of the API error envelope. Published contract in
 * {@code snake_case}: renaming one is a breaking change. See docs/system/api-standards.md §4.
 */
public final class ErrorCodes {

    private ErrorCodes() {
    }

    /** 400 — malformed request the caller can fix (bad param, unreadable body). */
    public static final String BAD_REQUEST = "bad_request";

    /** 401 — missing or invalid credentials. */
    public static final String UNAUTHORIZED = "unauthorized";

    /** 403 — authenticated but not permitted (RBAC deny, or an owner-only action). */
    public static final String FORBIDDEN = "forbidden";

    /** 404 — no such resource, or archived and hidden from this caller. */
    public static final String NOT_FOUND = "not_found";

    /** 409 — conflicts with current state. */
    public static final String CONFLICT = "conflict";

    /** 422 — request validation failed; the envelope carries a {@code fields[]} array. */
    public static final String VALIDATION_FAILED = "validation_failed";

    /** 401 — the code was right and the account is archived. Terminal: a fresh code lands here too. */
    public static final String ACCOUNT_ARCHIVED = "account_archived";

    /** 403 — the code was right, no account exists, and public onboarding is closed. Terminal. */
    public static final String SIGNUPS_CLOSED = "signups_closed";

    /**
     * 403 — this owner accepts contact from L2-verified users only. The only verification-driven 403
     * on the contact path, so a client may treat it — and only it — as "offer the Aadhaar prompt".
     */
    public static final String VERIFICATION_REQUIRED = "verification_required";

    /** 409 — this Aadhaar identity is already linked to another account (one Aadhaar = one badge). */
    public static final String AADHAAR_ALREADY_REGISTERED = "aadhaar_already_registered";

    /**
     * 422 — the caller has no standing to review this listing. No permission fixes it, only a
     * completed visit or a tenancy does.
     */
    public static final String REVIEW_NOT_ELIGIBLE = "review_not_eligible";

    /**
     * 422 — the caller has used every owner contact their plan and referrals allow. Not a 403 or a
     * 429: what fixes it is subscribing or referring. See docs/system/api-standards.md §4.2.
     */
    public static final String CONTACT_QUOTA_EXHAUSTED = "contact_quota_exhausted";

    /** 422 — every live listing slot is used. Unlike the contact quota, taking one down frees a slot. */
    public static final String LISTING_QUOTA_EXHAUSTED = "listing_quota_exhausted";

    /**
     * 409 — this account has already reviewed this target. Paired with a UNIQUE index rather than
     * only a service check, so the answer holds under concurrent submits.
     */
    public static final String ALREADY_REVIEWED = "already_reviewed";

    /**
     * 412 — a conditional write whose {@code If-Match} does not match the stored document. Not
     * {@link #CONFLICT}: the recovery is to re-read and re-apply, not to reconsider the request.
     */
    public static final String PRECONDITION_FAILED = "precondition_failed";

    /** 429 — rate limit exceeded (e.g. OTP requests); pairs with a Retry-After hint. */
    public static final String RATE_LIMITED = "rate_limited";

    /**
     * 429 — this code has taken every wrong guess it is allowed and has been burnt. Its own code
     * because waiting cannot help; see docs/system/api-standards.md §4.2.
     */
    public static final String OTP_ATTEMPTS_EXHAUSTED = "otp_attempts_exhausted";

    /**
     * 503 — the platform is closed for maintenance ({@code MaintenanceModeFilter}). Its own code so
     * a client can say "back shortly" rather than offer to sign in again.
     */
    public static final String MAINTENANCE_MODE = "maintenance_mode";

    /**
     * 413 — the uploaded file exceeds the size limit. Raised by our own check and by the servlet
     * container's multipart limit; both paths must emit this code.
     */
    public static final String PAYLOAD_TOO_LARGE = "payload_too_large";

    /**
     * 415 — the uploaded file's type is not on the vault's allowlist. Not {@link #VALIDATION_FAILED}:
     * no field the client can correct will help, only a different file.
     */
    public static final String UNSUPPORTED_MEDIA_TYPE = "unsupported_media_type";

    /** 405 — the route exists but not for this verb. A different fix from a {@link #NOT_FOUND}. */
    public static final String METHOD_NOT_ALLOWED = "method_not_allowed";

    /** 500 — catch-all. The message is deliberately generic: never leak internals to the client. */
    public static final String INTERNAL = "internal";

    /**
     * Messages the filter chain and {@link GlobalExceptionHandler} must emit byte-identically: the
     * client sees one API, so there is one copy of each string.
     */
    public static final class Messages {

        private Messages() {
        }

        public static final String AUTH_REQUIRED = "Authentication required";

        public static final String ACCESS_DENIED = "You do not have permission to perform this action";

        /**
         * The 400 for an unparseable body. Says nothing about why: Jackson's own message names the
         * target Java class, the JSON pointer and a fragment of the payload.
         */
        public static final String MALFORMED_BODY = "Request body could not be read";

        /** 405 — the path matched, the verb did not. */
        public static final String METHOD_NOT_ALLOWED = "That method is not supported on this resource";

        /** 415 — Spring refused the request's Content-Type before any controller code ran. */
        public static final String UNSUPPORTED_CONTENT_TYPE = "That content type is not supported on this resource";
    }
}
