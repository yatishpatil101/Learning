package com.draazy.api.identity.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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

// Past the flow's hourly share the flow narrows instead of closing. Both halves are asserted:
// either alone passes trivially. See OtpSendBudget.MAX_PURPOSE_RESERVE_SENDS_PER_WINDOW.
@SpringBootTest(properties = {
    "draazy.otp.max-purpose-sends-per-window=" + OtpPurposeReserveTest.SHARE,
    "draazy.otp.send-cooldown-seconds=0",
})
@DisplayName("OTP per-purpose reserve")
class OtpPurposeReserveTest extends AbstractApiTest {

    // Referenced by the annotation above so the two cannot drift. Four accounts fill it with one
    // send each, well inside their own quota — so a refusal here can only be the share.
    static final int SHARE = 4;

    @Autowired
    UserRepository users;

    // The share counts otp_codes rows, so rows another test committed would be charged to it.
    // This delete rides the class transaction and rolls back with it.
    @BeforeEach
    void emptyTheWindow() {
        jdbc.update("delete from otp_codes");
    }

    @Test
    void anExhaustedShareRefusesASpenderAndStillServesANewcomer() throws Exception {
        for (int i = 0; i < SHARE; i++) {
            requestConsent(host("987654000" + i), "987654100" + i).andExpect(status().isOk());
        }

        // The first of those four, asking for a second code: one send spent of a quota of five, so
        // only the exhausted share can refuse this.
        requestConsent(users.findByMobile("9876540000").orElseThrow(), "9876541099")
                .andExpect(status().isTooManyRequests());

        requestConsent(host("9876540099"), "9876541100").andExpect(status().isOk());
    }

    private User host(String mobile) {
        return users.saveAndFlush(new User(mobile, "buyer"));
    }

    /** Names its flat, because the route settles the address before it spends a send. */
    private ResultActions requestConsent(User host, String ownerMobile) throws Exception {
        return mvc.perform(post(Routes.Flatmates.OWNER_CONSENT)
                .header(HttpHeaders.AUTHORIZATION, bearer(host))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"ownerMobile\":\"" + ownerMobile + "\","
                        + "\"title\":\"Flat " + ownerMobile + "\",\"locality\":\"Baner\"}"));
    }
}
