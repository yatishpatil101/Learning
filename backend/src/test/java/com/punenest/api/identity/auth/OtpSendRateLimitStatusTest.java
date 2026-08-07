package com.punenest.api.identity.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Guards tech-debt D90: a rate-limited OTP request must answer {@code 429}, not {@code 500}.
 *
 * <p><strong>Why this is not in {@code AuthEndpointsTest}, and why it cannot be.</strong> The bug is
 * a transaction-propagation bug, and every other HTTP test extends {@link
 * com.punenest.api.support.AbstractApiTest}, which is {@code @Transactional}. Under a test-managed
 * transaction {@code AuthService.login} merely <em>participates</em> and never commits, so the
 * failing commit that produced the 500 cannot happen — the bug is invisible to the entire existing
 * suite. This class is therefore deliberately <strong>not</strong> {@code @Transactional}, for the
 * same reason {@link OtpServiceDurabilityTest} is not.
 *
 * <p>The original failure: {@code OtpService.sendCode} refused inside the caller's transaction with
 * the default rollback rule, marking it rollback-only; {@code AuthService.login} then honoured its
 * own {@code noRollbackFor}, attempted the commit, and got an {@code UnexpectedRollbackException}
 * that the catch-all rendered as {@code 500 internal}. The user was told the server broke when in
 * fact they had been told to wait — and the {@code Retry-After} they needed never arrived.
 *
 * <p>Being non-transactional, the row this writes is real and is what the limiter counts, so the
 * test clears its own number before and after rather than assuming a fresh database. The number is
 * test-only and matched by no other test.
 */
@SpringBootTest
@AutoConfigureMockMvc
class OtpSendRateLimitStatusTest {

    private static final String MOBILE = "9876500912";

    @Autowired
    MockMvc mvc;
    @Autowired
    JdbcTemplate jdbc;

    @BeforeEach
    @AfterEach
    void clearOwnSendHistory() {
        jdbc.update("delete from otp_codes where mobile = ?", MOBILE);
    }

    @Test
    void secondSendInsideTheCooldownAnswers429WithARetryAfterHint() throws Exception {
        mvc.perform(login()).andExpect(status().isOk())
                .andExpect(jsonPath("$.otpSent").value(true));

        mvc.perform(login())
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("rate_limited"))
                // The message is the point of the 429: it tells the user to wait, which a 500 does not.
                .andExpect(jsonPath("$.message").value(
                        "A code was just sent — wait a moment before requesting another"))
                .andExpect(header().exists(HttpHeaders.RETRY_AFTER));
    }

    private static org.springframework.test.web.servlet.RequestBuilder login() {
        return post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mobile\":\"" + MOBILE + "\"}");
    }
}
