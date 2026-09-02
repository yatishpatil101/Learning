package com.draazy.api.common.error;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * The platform's error envelope, matching the OpenAPI {@code Error} schema exactly:
 * {@code { error, message, status, traceId? }}. {@code traceId} is omitted when absent.
 *
 * @param error   machine-readable code (e.g. {@code not_found})
 * @param message human-readable detail
 * @param status  HTTP status
 * @param traceId correlation id for observability (nullable)
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiError(String error, String message, int status, String traceId) {

    public static ApiError of(String error, String message, int status, String traceId) {
        return new ApiError(error, message, status, traceId);
    }
}
