package com.draazy.api.identity.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * Every other OTP limit is keyed on the recipient, so a rotating number is never refused.
 * Reasoning: docs/flows/consumer/auth.md, "OTP budgets, attempt cap and boot guards".
 */
@SpringBootTest(properties = {
    "draazy.otp.max-platform-sends-per-window=2",
    "draazy.otp.send-cooldown-seconds=0",
})
@AutoConfigureMockMvc
@Transactional
@DisplayName("OTP platform-wide send cap (M5)")
class OtpPlatformSendCapTest {

    private static final int CAP = 2;

    @Autowired
    MockMvc mvc;
    @Autowired
    JdbcTemplate jdbc;

    // The budget counts otp_codes rows, so rows another test committed would be charged to it.
    // This delete rides the class transaction and rolls back with it.
    @BeforeEach
    void emptyTheWindow() {
        jdbc.update("delete from otp_codes");
    }

    @Test
    void aRotatingRecipientIsStoppedEvenThoughNoNumberExceedsItsOwnBudget() throws Exception {
        // First send to an untouched number, so only the unkeyed budget can refuse it.
        requestCode("9876512001").andExpect(status().isOk());
        requestCode("9876512002").andExpect(status().isOk());

        requestCode("9876512003")
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("rate_limited"))
                // Says nothing about the platform budget: a named ceiling is a progress report for
                // the caller exhausting it.
                .andExpect(jsonPath("$.message").value(
                        "Login codes are temporarily unavailable — please try again later"))
                .andExpect(header().exists(HttpHeaders.RETRY_AFTER));
    }

    // Counterweight: a cap that refused unconditionally would pass the test above.
    @Test
    void sendsBelowTheCapAreUntouched()throws Exception {
        for (int i = 0; i < CAP; i++) {
            requestCode("987651300" + i).andExpect(status().isOk())
                    .andExpect(jsonPath("$.otpSent").value(true));
        }
    }

    private ResultActions requestCode(String mobile) throws Exception {
        return mvc.perform(post(Routes.Auth.LOGIN).contentType(MediaType.APPLICATION_JSON)
                .content("{\"mobile\":\"" + mobile + "\"}"));
    }
}
