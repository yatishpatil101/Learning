package com.draazy.api.provider;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.concurrent.RejectedExecutionException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;

@DisplayName("provider_call recorder")
class ProviderCallsTest {

    @Test
    @DisplayName("recipients are stored masked; the search key ignores formatting and case")
    void masksAndHashes() {
        assertThat(ProviderCalls.mask("98111 22233")).isEqualTo("98XXXXX233");
        assertThat(ProviderCalls.mask("Hire@Example.com")).isEqualTo("***@Example.com");
        assertThat(ProviderCalls.hashRecipient("+91 98111-22233"))
                .isEqualTo(ProviderCalls.hashRecipient("9811122233"));
        assertThat(ProviderCalls.hashRecipient(" HIRE@example.com "))
                .isEqualTo(ProviderCalls.hashRecipient("hire@example.com"));
        assertThat(ProviderCalls.hashRecipient("dz_order_1")).isNull();
    }

    @Test
    @DisplayName("a failure is reduced to a code, never the vendor's message")
    void diagnosesWithoutFreeText() {
        RuntimeException http = new RuntimeException("wrapped",
                HttpServerErrorException.create(HttpStatus.BAD_GATEWAY, "Bad Gateway for hire@example.com",
                        null, null, null));
        assertThat(ProviderCalls.diagnosis(http)).isEqualTo("http 502");
        assertThat(ProviderCalls.diagnosis(new ResourceAccessException("timed out"))).isEqualTo("network");
        assertThat(ProviderCalls.diagnosis(new IllegalStateException("no session for 98111")))
                .isEqualTo("IllegalStateException");
    }

    @Test
    @DisplayName("a database failure never reaches the caller, and track still rethrows the call's own failure")
    void recordingNeverBreaksTheCall() {
        JdbcTemplate broken = mock(JdbcTemplate.class);
        when(broken.update(anyString(), any(Object[].class))).thenThrow(new IllegalStateException("pool exhausted"));
        ProviderCalls calls = new ProviderCalls(broken, Runnable::run);

        assertThatCode(() -> calls.record(ProviderCalls.WHATSAPP, "otp", ProviderCalls.Outcome.OK,
                "9811122233", null, null, 1)).doesNotThrowAnyException();
        assertThat(calls.track(ProviderCalls.CASHFREE, "refund", null, "o1", () -> "cf_1")).isEqualTo("cf_1");
        assertThatCode(() -> calls.track(ProviderCalls.CASHFREE, "refund", null, "o1", (Runnable) () -> {
            throw new ResourceAccessException("down");
        })).isInstanceOf(ResourceAccessException.class);

        ProviderCalls full = new ProviderCalls(broken, task -> {
            throw new RejectedExecutionException("full");
        });
        assertThat(full.track(ProviderCalls.CASHFREE, "refund", null, "o1", () -> "cf_2")).isEqualTo("cf_2");
    }
}
