package com.punenest.api.common.error;

import com.punenest.api.common.web.RequestCorrelation;
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
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

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

    /**
     * An unparseable request body → 400, with nothing said about why.
     *
     * <p>Split out from the other two 400 cases because it is the only one whose exception message
     * is not ours. Jackson writes it, and it routinely carries the target Java class, the JSON
     * pointer and a slice of the submitted payload. Returning that verbatim — which this handler
     * used to do — published the shape of the deserialisation layer to anyone willing to POST
     * `{`, and contradicted this class's own promise that unrecognised detail is logged, never
     * leaked. The detail is still logged at debug for whoever is diagnosing a real client.
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
     *
     * <p>The parameter name is safe to return — the caller chose it, and it is in the published
     * contract. The exception's own message is not: {@code MethodArgumentTypeMismatchException}
     * renders the target Java type, so the default text tells a caller who sent {@code ?page=x}
     * what our controller signature looks like. Naming the field is the actionable half; the type
     * is the leak.
     */
    @ExceptionHandler({MissingServletRequestParameterException.class,
            MethodArgumentTypeMismatchException.class})
    public ResponseEntity<ApiError> handleBadParameter(Exception ex) {
        String name = ex instanceof MissingServletRequestParameterException missing
                ? missing.getParameterName()
                : ((MethodArgumentTypeMismatchException) ex).getName();
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(new ApiError(ErrorCodes.BAD_REQUEST,
                        "Invalid or missing request parameter: " + name, 400, traceId()));
    }

    /**
     * The path matched but the verb did not → 405, with an {@code Allow} header.
     *
     * <p><strong>Why this is here at all.</strong> Spring resolves this exception itself, but only
     * if nothing upstream claims it first — and this class carries an {@code @ExceptionHandler(
     * Exception.class)} catch-all, which is broader and wins. Without an explicit handler, asking
     * for {@code DELETE /properties} returned a 500 {@code internal} and logged a stack trace, as
     * though the server had failed rather than the caller. The same reasoning covers the 415 below.
     *
     * <p>The {@code Allow} header is part of the 405 semantics, not a nicety: a response that says
     * "not that verb" without saying which verbs are accepted makes the client guess.
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
     * A {@code Content-Type} the endpoint does not declare in {@code consumes} → 415.
     *
     * <p>Note this is a <em>different</em> 415 from the one the document vault raises: that one is
     * our own {@link UnsupportedMediaTypeException} after sniffing the uploaded bytes, this one is
     * Spring refusing the request before any controller code runs. Both must render the same
     * {@code unsupported_media_type} code, or a client learns two names for one refusal — which is
     * exactly the invariant {@link ErrorCodes#PAYLOAD_TOO_LARGE} documents for the 413 pair.
     */
    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<ApiError> handleMediaTypeNotSupported(HttpMediaTypeNotSupportedException ex) {
        log.debug("Unsupported content type [traceId={}]: {}", traceId(), ex.getContentType());
        return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
                .body(new ApiError(ErrorCodes.UNSUPPORTED_MEDIA_TYPE,
                        ErrorCodes.Messages.UNSUPPORTED_CONTENT_TYPE, 415, traceId()));
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

    /**
     * The servlet container's multipart limit, which trips in the filter chain before the
     * controller is ever entered — so our own size check inside the service can never see this
     * case. Mapped here to the same {@code payload_too_large} code the service raises, because a
     * client that has to branch on two names for "your file is too big" will get it wrong.
     */
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ApiError> handleUploadTooLarge(MaxUploadSizeExceededException ex) {
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                .body(new ApiError(ErrorCodes.PAYLOAD_TOO_LARGE,
                        "That file is too large to upload", 413, traceId()));
    }

    /**
     * A unique or foreign-key constraint the database rejected.
     *
     * <p><strong>Why this is handled centrally and not recovered from locally.</strong> Several
     * services guard a create with an idempotency lookup and then rely on a unique index to settle
     * the race when two concurrent requests both miss it. The tempting recovery — catch the
     * violation and re-read the winning row — <em>cannot work</em>: Hibernate marks the persistence
     * context unusable once a constraint fires, so the follow-up read throws
     * {@code JpaSystemException} and the caller gets a confusing 500 instead of their answer.
     *
     * <p>409 is the honest reply. The write genuinely conflicted with the current state of the
     * resource, and a client that retries the same idempotent request gets the stored result,
     * because by then the winner has committed.
     *
     * <p>Logged at {@code warn} with the cause, because the other thing that reaches here is a
     * not-null or foreign-key violation from a genuine bug, and that must not disappear silently
     * behind a tidy 409.
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiError> handleDataIntegrity(DataIntegrityViolationException ex) {
        log.warn("Database rejected a write [traceId={}]", traceId(), ex);
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(new ApiError(ErrorCodes.CONFLICT,
                        "That request conflicts with existing data", 409, traceId()));
    }

    /**
     * Two writers reached the same row and the second one lost (tech debt D48).
     *
     * <p><strong>Different from the constraint violation above, and answered differently.</strong>
     * There, the database refused a write that was never valid; here it refused a write that was
     * valid when the caller loaded the row and stopped being valid while they were editing it. The
     * caller did nothing wrong, has not lost their input, and the correct advice is specific:
     * reload, look at what changed, decide whether your edit still applies. So the message says
     * that, rather than the generic conflict text.
     *
     * <p>409 rather than 412: no precondition was supplied. When {@code If-Match} arrives on
     * settings (D66) a failed precondition will be a 412 and this will stay the answer for the
     * unconditional case.
     *
     * <p>Logged at {@code info}, not {@code warn}. A lost race on the ops board is normal
     * concurrency working as designed and is not evidence of a defect; logging it at warning level
     * would train whoever reads the logs to ignore the level that also carries real database
     * rejections.
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
