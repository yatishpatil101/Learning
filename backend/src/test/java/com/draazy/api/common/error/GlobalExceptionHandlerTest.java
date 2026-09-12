package com.draazy.api.common.error;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.mock.http.MockHttpInputMessage;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    void typedExceptionMapsToEnvelopeWithItsStatusAndCode() {
        var response = handler.handleApi(new NotFoundException("Property not found"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        ApiError body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.error()).isEqualTo("not_found");
        assertThat(body.message()).isEqualTo("Property not found");
        assertThat(body.status()).isEqualTo(404);
    }

    @Test
    void rateLimitedAddsRetryAfterHeader() {
        var response = handler.handleApi(new RateLimitedException("Too many requests", 30));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(response.getHeaders().getFirst(HttpHeaders.RETRY_AFTER)).isEqualTo("30");
        assertThat(response.getBody().error()).isEqualTo("rate_limited");
    }

    @Test
    void uncaughtBecomesGeneric500NeverLeakingDetail() {
        var response = handler.handleUncaught(new RuntimeException("secret stacktrace detail"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(response.getBody().error()).isEqualTo("internal");
        assertThat(response.getBody().message()).doesNotContain("secret");
    }

    /**
     * D48. The 409 is shared with the constraint-violation handler, so the thing worth pinning is
     * the message: a lost race and a rejected write are different situations and the advice that
     * resolves them differs. Hibernate's own text names the entity class and row id, which is
     * internal detail a caller has no use for, so it must not survive into the body.
     */
    @Test
    void lostConcurrentUpdateIs409AdvisingReloadAndLeaksNoEntityDetail() {
        var response = handler.handleOptimisticLock(new OptimisticLockingFailureException(
                "Row was updated or deleted by another transaction "
                        + "(com.draazy.api.services.ticket.Ticket#a1b2)"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(response.getBody().error()).isEqualTo("conflict");
        assertThat(response.getBody().message()).contains("Reload");
        assertThat(response.getBody().message()).doesNotContain("Ticket");
        assertThat(response.getBody().message()).doesNotContain("a1b2");
    }

    /**
     * The 400 path used to return {@code ex.getMessage()} verbatim. Jackson writes that message,
     * and it names the target Java class, the JSON pointer and a fragment of the payload — so the
     * one handler that echoed an exception was also the one whose exception message was not ours.
     * A realistic Jackson string is used rather than a toy one, because the assertion that matters
     * is that none of those three things survives.
     */
    @Test
    void unreadableBodyIs400AndLeaksNoJacksonDetail() {
        var response = handler.handleUnreadableBody(new HttpMessageNotReadableException(
                "JSON parse error: Cannot deserialize value of type `com.draazy.api.catalog"
                        + ".listing.ListingCreate` from String \"abc\" at [Source: (String)"
                        + "\"{\"price\":\"abc\"}\"; line: 1, column: 11]",
                new MockHttpInputMessage(new byte[0])));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody().error()).isEqualTo("bad_request");
        assertThat(response.getBody().message()).doesNotContain("com.draazy");
        assertThat(response.getBody().message()).doesNotContain("ListingCreate");
        assertThat(response.getBody().message()).doesNotContain("line: 1");
    }

    /**
     * The parameter name is the caller's own and is in the published contract, so returning it is
     * the actionable half of the answer. The Java type it failed to bind to is not — that is our
     * controller signature, and the default exception message renders it.
     */
    @Test
    void badParameterIs400NamingTheParamButNotItsJavaType() {
        var missing = handler.handleBadParameter(
                new MissingServletRequestParameterException("propertyId", "String"));

        assertThat(missing.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(missing.getBody().error()).isEqualTo("bad_request");
        assertThat(missing.getBody().message()).contains("propertyId");

        var mismatch = handler.handleBadParameter(new MethodArgumentTypeMismatchException(
                "not-a-number", Integer.class, "page", null, new NumberFormatException()));

        assertThat(mismatch.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(mismatch.getBody().message()).contains("page");
        assertThat(mismatch.getBody().message()).doesNotContain("Integer");
    }

    /** 405 without an {@code Allow} header makes the client guess which verb to use instead. */
    @Test
    void wrongVerbIs405WithAnAllowHeader() {
        var response = handler.handleMethodNotSupported(
                new HttpRequestMethodNotSupportedException("DELETE", List.of("GET", "POST")));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.METHOD_NOT_ALLOWED);
        assertThat(response.getBody().error()).isEqualTo("method_not_allowed");
        assertThat(response.getHeaders().getAllow())
                .containsExactlyInAnyOrder(HttpMethod.GET, HttpMethod.POST);
    }

    /**
     * Spring's pre-controller refusal must render the same code as the vault's own byte-sniffing
     * refusal, or a client learns two names for one outcome — the invariant {@code ErrorCodes
     * .PAYLOAD_TOO_LARGE} spells out for the analogous 413 pair.
     */
    @Test
    void unsupportedContentTypeIs415WithTheSameCodeAsTheVaultsOwnRefusal() {
        var response = handler.handleMediaTypeNotSupported(
                new HttpMediaTypeNotSupportedException(MediaType.APPLICATION_JSON,
                        List.of(MediaType.MULTIPART_FORM_DATA)));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
        assertThat(response.getBody().error())
                .isEqualTo(new UnsupportedMediaTypeException("x").getCode());
    }
}
