package com.punenest.api.common.error;

/** 429 — the caller exceeded a rate limit (e.g. OTP requests). Carries the Retry-After hint. */
public class RateLimitedException extends ApiException {

    private final int retryAfterSeconds;

    public RateLimitedException(String message, int retryAfterSeconds) {
        super(ErrorCodes.RATE_LIMITED, 429, message);
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public int getRetryAfterSeconds() {
        return retryAfterSeconds;
    }
}
