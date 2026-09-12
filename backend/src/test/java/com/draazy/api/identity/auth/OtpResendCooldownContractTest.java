package com.draazy.api.identity.auth;

import static org.hamcrest.Matchers.allOf;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.lessThanOrEqualTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * The acknowledgement must publish the server's cooldown, or a client constant counts down to a 429.
 * 97 rather than the default so a hardcoded value cannot pass. See docs/flows/consumer/auth.md.
 */
@SpringBootTest(properties = "draazy.otp.send-cooldown-seconds=97")
@AutoConfigureMockMvc
@Transactional
@DisplayName("OTP send acknowledgement reports the enforced resend cooldown")
class OtpResendCooldownContractTest {

    @Autowired
    MockMvc mvc;

    @Test
    void theSendStepReportsTheConfiguredCooldown() throws Exception {
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"9876513001\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.otpSent").value(true))
                .andExpect(jsonPath("$.resendAfterSeconds").value(97));
    }

    /**
     * A cross-origin browser cannot read an unexposed header, so the envelope carries the number.
     * It is the wait remaining, hence a range rather than an equality.
     */
    @Test
    void aRefusedResendReportsTheWaitThatIsLeft()throws Exception {
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"9876513002\"}"))
                .andExpect(status().isOk());

        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"9876513002\"}"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.retryAfterSeconds").value(
                        allOf(greaterThan(0), lessThanOrEqualTo(97))));
    }
}
