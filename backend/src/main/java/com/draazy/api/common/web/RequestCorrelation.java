package com.draazy.api.common.web;

/**
 * Single source of truth for the request-correlation id wiring, shared by the correlation filter
 * (which populates it) and the error advice (which reads it into the {@code traceId} field of the
 * error envelope). Keeping the key in one constant stops the producer and consumer drifting apart.
 */
public final class RequestCorrelation {

    /** SLF4J MDC key + the name the correlation id is stored under for the whole request. */
    public static final String TRACE_ID_MDC = "traceId";

    /** Response header echoing the correlation id back to the caller. */
    public static final String TRACE_ID_HEADER = "X-Trace-Id";

    private RequestCorrelation() {
    }
}
