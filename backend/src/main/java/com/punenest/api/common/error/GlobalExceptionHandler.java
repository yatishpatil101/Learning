package com.punenest.api.common.error;

import com.punenest.api.common.web.RequestCorrelation;
import jakarta.validation.ConstraintViolationException;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/**
 * The single translation point from exceptions to the OpenAPI error envelope. Every controller in
 * the app reuses this — no controller ever builds an error body itself.
 *
 * <p>Status mapping is the contract: validation → 422 {@code ValidationProblem}; the typed
 * {@link ApiException} hierarchy carries its own code/status; auth failures that reach here map to
 * 401/403; anything unrecognised is a 500 {@code internal} with the detail logged, never leaked.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** Typed domain errors — the common, expected path. */
    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiError> handleApi(ApiException ex) {
        HttpHeaders headers = new HttpHeaders();
        if (ex instanceof RateLimitedException rate) {
            headers.add(HttpHeaders.RETRY_AFTER, String.valueOf(rate.getRetryAfterSeconds()));
        }
        return ResponseEntity.status(ex.getStatus())
                .headers(headers)
                .body(new ApiError(ex.getCode(), ex.getMessage(), ex.getStatus(), traceId()));
    }

    /** {@code @Valid} on a {@code @RequestBody} — collect per-field messages. */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ValidationProblem> handleBodyValidation(MethodArgumentNotValidException ex) {
        List<ValidationProblem.FieldError> fields = ex.getBindingResult().getFieldErrors().stream()
                .map(GlobalExceptionHandler::toFieldError)
                .toList();
        return validationProblem(fields);
    }

    /** {@code @Valid} on path/query params or method-level validation. */
    @ExceptionHandler(HandlerMethodValidationException.class)
    public ResponseEntity<ValidationProblem> handleHandlerValidation(HandlerMethodValidationException ex) {
        List<ValidationProblem.FieldError> fields = ex.getParameterValidationResults().stream()
                .flatMap(r -> r.getResolvableErrors().stream()
                        .map(err -> new ValidationProblem.FieldError(
                                r.getMethodParameter().getParameterName(), err.getDefaultMessage())))
                .toList();
        return validationProblem(fields);
    }

    /** Programmatic {@code jakarta.validation} on service beans. */
    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ValidationProblem> handleConstraint(ConstraintViolationException ex) {
        List<ValidationProblem.FieldError> fields = ex.getConstraintViolations().stream()
                .map(v -> new ValidationProblem.FieldError(
                        v.getPropertyPath().toString(), v.getMessage()))
                .toList();
        return validationProblem(fields);
    }

    /** Malformed request the caller can fix → 400. */
    @ExceptionHandler({HttpMessageNotReadableException.class,
            MissingServletRequestParameterException.class,
            MethodArgumentTypeMismatchException.class})
    public ResponseEntity<ApiError> handleBadRequest(Exception ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(new ApiError(ErrorCodes.BAD_REQUEST, ex.getMessage(), 400, traceId()));
    }

    // Defensive backstop only: Spring Security's ExceptionTranslationFilter normally intercepts
    // auth/access-denied *before* the dispatcher, routing them to RestAuthEntryPoint /
    // RestAccessDeniedHandler. These handlers just guarantee the contract envelope if such an
    // exception ever reaches the controller layer (e.g. a manual check inside a @Service).

    /** Auth failures that surface at the controller layer (method security, manual checks). */
    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<ApiError> handleAuth(AuthenticationException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(new ApiError(ErrorCodes.UNAUTHORIZED, ErrorCodes.Messages.AUTH_REQUIRED,
                        401, traceId()));
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiError> handleAccessDenied(AccessDeniedException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(new ApiError(ErrorCodes.FORBIDDEN,
                        ErrorCodes.Messages.ACCESS_DENIED, 403, traceId()));
    }

    /** Last resort: never leak internals — log the cause, return a generic 500. */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleUncaught(Exception ex) {
        log.error("Unhandled exception [traceId={}]", traceId(), ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(new ApiError(ErrorCodes.INTERNAL, "Something went wrong", 500, traceId()));
    }

    private static ResponseEntity<ValidationProblem> validationProblem(
            List<ValidationProblem.FieldError> fields) {
        return ResponseEntity.unprocessableEntity()
                .body(new ValidationProblem(ErrorCodes.VALIDATION_FAILED,
                        "Request validation failed", 422, traceId(), fields));
    }

    private static ValidationProblem.FieldError toFieldError(FieldError fe) {
        return new ValidationProblem.FieldError(fe.getField(), fe.getDefaultMessage());
    }

    private static String traceId() {
        return MDC.get(RequestCorrelation.TRACE_ID_MDC);
    }
}
