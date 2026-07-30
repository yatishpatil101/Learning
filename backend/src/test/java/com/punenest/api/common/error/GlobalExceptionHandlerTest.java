package com.punenest.api.common.error;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;

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
}
