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

// Every other budget is keyed on the number receiving the code, which this flow's caller types — so
// they all reset by typing a different one. See OtpSendBudget.MAX_CALLER_SENDS_PER_WINDOW, V33.
@SpringBootTest(properties = {
    "draazy.otp.max-caller-sends-per-window=" + OtpCallerSendCapTest.CAP,
    "draazy.otp.send-cooldown-seconds=0",
})
@DisplayName("OTP per-caller quota")
class OtpCallerSendCapTest extends AbstractApiTest {

    /** Referenced by the annotation above, so the boundary under test cannot drift from the cap. */
    static final int CAP = 2;

    @Autowired
    UserRepository users;

    // The budget counts otp_codes rows, so rows another test committed would be charged to it.
    // This delete rides the class transaction and rolls back with it.
    @BeforeEach
    void emptyTheWindow() {
        jdbc.update("delete from otp_codes");
    }

    @Test
    void oneAccountCannotRotateTheRecipientPastItsOwnQuota() throws Exception {
        User host = host("9876530001");

        for (int i = 0; i < CAP; i++) {
            requestConsent(host, "987653100" + i).andExpect(status().isOk());
        }

        requestConsent(host, "9876531099")
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("rate_limited"));
    }

    // Without this the test above would also pass under a cap that simply closed the flow for
    // everyone once someone filled it — the failure this quota exists to prevent.
    @Test
    void anExhaustedCallerLeavesEveryOtherCallerAlone() throws Exception {
        User spender = host("9876530002");
        for (int i = 0; i < CAP; i++) {
            requestConsent(spender, "987653200" + i).andExpect(status().isOk());
        }
        requestConsent(spender, "9876532099").andExpect(status().isTooManyRequests());

        User bystander = host("9876530003");
        requestConsent(bystander, "9876532100").andExpect(status().isOk());
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
