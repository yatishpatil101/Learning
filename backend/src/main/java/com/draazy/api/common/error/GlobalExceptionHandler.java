package com.draazy.api.common.error;

import com.draazy.api.common.web.RequestCorrelation;
import jakarta.validation.ConstraintViolationException;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * The single translation point from exceptions to the OpenAPI error envelope; no controller builds
 * an error body itself. Status mapping and the non-obvious handlers: docs/system/api-standards.md §4.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** Typed domain errors — the common, expected path. */
    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiError> handleApi(ApiException ex) {
        HttpHeaders headers = new HttpHeaders();
        Integer retryAfterSeconds = null;
        if (ex instanceof RateLimitedException rate) {
            headers.add(HttpHeaders.RETRY_AFTER, String.valueOf(rate.getRetryAfterSeconds()));
            // Also in the body: no CORS response header is exposed, so a cross-origin browser
            // cannot read the header (docs/system/api-standards.md §4.1).
            retryAfterSeconds = rate.getRetryAfterSeconds();
        }
        Integer attemptsRemaining =
                ex instanceof OtpIncorrectException otp ? otp.getAttemptsRemaining() : null;
        return ResponseEntity.status(ex.getStatus())
                .headers(headers)
                .body(new ApiError(ex.getCode(), ex.getMessage(), ex.getStatus(), traceId(),
                        attemptsRemaining, retryAfterSeconds));
    }

    /** {@code @Valid} on a {@code @RequestBody} — collect per-field messages. */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ValidationProblem> handleBodyValidation(MethodArgumentNotValidException ex) {
        List<ValidationProblem.FieldError> fields = ex.getBindingResult().getFieldErrors().stream()
                .map(GlobalExceptionHandler::toFieldError)
                .toList();
        return validationProblem(fields);
    }

    /**
     * {@code @Valid} on path/query params or method-level validation. A nested field name wins over
     * the parameter name, which would report {@code "body"}: docs/system/api-standards.md §4.3.
     */
    @ExceptionHandler(HandlerMethodValidationException.class)
    public ResponseEntity<ValidationProblem> handleHandlerValidation(HandlerMethodValidationException ex) {
        List<ValidationProblem.FieldError> fields = ex.getParameterValidationResults().stream()
                .flatMap(r -> r.getResolvableErrors().stream()
                        .map(err -> new ValidationProblem.FieldError(
                                err instanceof FieldError nested
                                        ? nested.getField()
                                        : r.getMethodParameter().getParameterName(),
                                err.getDefaultMessage())))
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

    /**
     * An unparseable request body → 400, with nothing said about why: Jackson's own message would
     * publish the deserialisation layer's shape. Detail is logged at debug instead.
     */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiError> handleUnreadableBody(HttpMessageNotReadableException ex) {
        log.debug("Unreadable request body [traceId={}]: {}", traceId(), ex.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(new ApiError(ErrorCodes.BAD_REQUEST, ErrorCodes.Messages.MALFORMED_BODY,
                        400, traceId()));
    }

    /**
     * A missing or untypeable query/path parameter → 400, naming the parameter and nothing else.
     * The name is published contract; the exception's own message leaks the target Java type.
     */
    @ExceptionHandler({MissingServletRequestParameterException.class, MissingServletRequestPartException.class,
            MethodArgumentTypeMismatchException.class})
    public ResponseEntity<ApiError> handleBadParameter(Exception ex) {
        String name = ex instanceof MissingServletRequestParameterException missing
                ? missing.getParameterName()
                : ex instanceof MissingServletRequestPartException missing
                        ? missing.getRequestPartName()
                : ((MethodArgumentTypeMismatchException) ex).getName();
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(new ApiError(ErrorCodes.BAD_REQUEST,
                        "Invalid or missing request parameter: " + name, 400, traceId()));
    }

    /**
     * The path matched but the verb did not → 405, with the {@code Allow} header its semantics
     * require. Explicit because the catch-all outranks Spring: api-standards.md §4.3.
     */
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiError> handleMethodNotSupported(HttpRequestMethodNotSupportedException ex) {
        HttpHeaders headers = new HttpHeaders();
        if (ex.getSupportedHttpMethods() != null) {
            headers.setAllow(ex.getSupportedHttpMethods());
        }
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
                .headers(headers)
                .body(new ApiError(ErrorCodes.METHOD_NOT_ALLOWED,
                        ErrorCodes.Messages.METHOD_NOT_ALLOWED, 405, traceId()));
    }

    /**
     * A {@code Content-Type} the endpoint does not declare in {@code consumes} → 415. Must render
     * the same code as the vault's own {@link UnsupportedMediaTypeException}, raised after sniffing.
     */
    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<ApiError> handleMediaTypeNotSupported(HttpMediaTypeNotSupportedException ex) {
        log.debug("Unsupported content type [traceId={}]: {}", traceId(), ex.getContentType());
        return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
                .body(new ApiError(ErrorCodes.UNSUPPORTED_MEDIA_TYPE,
                        ErrorCodes.Messages.UNSUPPORTED_CONTENT_TYPE, 415, traceId()));
    }

    /**
     * No route matched at all → 404 rather than the catch-all's 500. Logged at {@code debug}: a
     * mistyped URL is not an operational event.
     */
    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ApiError> handleNoRoute(NoResourceFoundException ex) {
        log.debug("No route for [traceId={}]: {} {}", traceId(), ex.getHttpMethod(), ex.getResourcePath());
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(new ApiError(ErrorCodes.NOT_FOUND, "That route does not exist", 404, traceId()));
    }

    // Defensive backstop only: ExceptionTranslationFilter normally routes these to
    // RestAuthEntryPoint / RestAccessDeniedHandler before the dispatcher is reached.

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

    /**
     * The servlet container's multipart limit, which trips before the controller is entered, so the
     * service's own size check cannot see it. Same code as the service raises, deliberately.
     */
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ApiError> handleUploadTooLarge(MaxUploadSizeExceededException ex) {
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                .body(new ApiError(ErrorCodes.PAYLOAD_TOO_LARGE,
                        "That file is too large to upload", 413, traceId()));
    }

    /**
     * A unique or foreign-key violation → 409, never recovered from locally; {@code warn} because a
     * genuine bug also lands here. Why local recovery cannot work: docs/system/api-standards.md §4.3.
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiError> handleDataIntegrity(DataIntegrityViolationException ex) {
        log.warn("Database rejected a write [traceId={}]", traceId(), ex);
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(new ApiError(ErrorCodes.CONFLICT,
                        "That request conflicts with existing data", 409, traceId()));
    }

    /**
     * Two writers reached the same row and the second lost. Its own message because the caller did
     * nothing wrong; {@code info} because a lost race is concurrency working, not a defect.
     */
    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<ApiError> handleOptimisticLock(OptimisticLockingFailureException ex) {
        log.info("Concurrent update rejected [traceId={}]: {}", traceId(), ex.getMessage());
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(new ApiError(ErrorCodes.CONFLICT,
                        "Someone else changed this while you were editing it. Reload and try again.",
                        409, traceId()));
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
