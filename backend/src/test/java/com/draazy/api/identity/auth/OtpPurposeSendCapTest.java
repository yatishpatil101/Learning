package com.draazy.api.identity.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

// Owner consent names somebody else's number, so every per-recipient limit resets with each number
// it names; only this share keeps the spam out of the pool login draws from.
@SpringBootTest(properties = {
    "draazy.otp.max-purpose-sends-per-window=2",
    "draazy.otp.send-cooldown-seconds=0",
})
@DisplayName("OTP per-purpose send share")
class OtpPurposeSendCapTest extends AbstractApiTest {

    private static final int CAP = 2;

    @Autowired
    UserRepository users;

    // The budget counts otp_codes rows, so rows another test committed would be charged to it.
    // This delete rides the class transaction and rolls back with it.
    @BeforeEach
    void emptyTheWindow() {
        jdbc.update("delete from otp_codes");
    }

    @Test
    void oneFlowCannotSpendTheWholePoolByRotatingTheRecipient() throws Exception {
        User host = host("9876520001");

        for (int i = 0; i < CAP; i++) {
            requestConsent(host, "987652100" + i).andExpect(status().isOk());
        }

        requestConsent(host, "9876521099")
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("rate_limited"));
    }

    // Without this the test above would also pass under a cap that simply stopped every send once
    // the window filled.
    @Test
    void anExhaustedSideFlowLeavesSignInAlone() throws Exception {
        User host = host("9876520002");
        for (int i = 0; i < CAP; i++) {
            requestConsent(host, "987652200" + i).andExpect(status().isOk());
        }
        requestConsent(host, "9876522099").andExpect(status().isTooManyRequests());

        mvc.perform(post(Routes.Auth.LOGIN).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"9876529999\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.otpSent").value(true));
    }

    private User host(String mobile) {
        return users.saveAndFlush(new User(mobile, "buyer"));
    }

    // Names its flat: the route settles the address before it spends a send, so an unnameable flat
    // is refused at 400 and never reaches the budget this class is about.
    private ResultActions requestConsent(User host, String ownerMobile) throws Exception {
        return mvc.perform(post(Routes.Flatmates.OWNER_CONSENT)
                .header(HttpHeaders.AUTHORIZATION, bearer(host))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"ownerMobile\":\"" + ownerMobile + "\","
                        + "\"title\":\"Flat " + ownerMobile + "\",\"locality\":\"Baner\"}"));
    }
}
