package com.draazy.api.common.error;

/** 429 — the caller exceeded a rate limit (e.g. OTP requests). Carries the Retry-After hint. */
public class RateLimitedException extends ApiException {

    private final int retryAfterSeconds;

    public RateLimitedException(String message, int retryAfterSeconds) {
        this(ErrorCodes.RATE_LIMITED, message, retryAfterSeconds);
    }

    /**
     * A 429 a client must handle differently from a plain rate limit — see
     * {@link ErrorCodes#OTP_ATTEMPTS_EXHAUSTED}. Only the machine code differs.
     */
    public RateLimitedException(String code, String message, int retryAfterSeconds) {
        super(code, 429, message);
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public int getRetryAfterSeconds() {
        return retryAfterSeconds;
    }
}
