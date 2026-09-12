package com.draazy.api.common.error;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * The validation error envelope, matching the OpenAPI {@code ValidationProblem} schema: the base
 * {@code Error} fields plus a {@code fields[]} array of per-field messages. Emitted with HTTP 422.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ValidationProblem(
        String error, String message, int status, String traceId, List<FieldError> fields) {

    /** One field-level violation. */
    public record FieldError(String field, String message) {
    }
}
