package com.draazy.api.common.error;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * The OpenAPI {@code Error} schema; absent fields are omitted. Why the two optional hints live in
 * the body rather than in headers: docs/system/api-standards.md §4.1.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiError(String error, String message, int status, String traceId,
        Integer attemptsRemaining, Integer retryAfterSeconds) {

    /** The shape every error but a rejected OTP or a rate limit has: no hint to report. */
    public ApiError(String error, String message, int status, String traceId) {
        this(error, message, status, traceId, null, null);
    }
}
