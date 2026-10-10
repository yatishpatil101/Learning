package com.draazy.api.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.EmailSender;
import com.draazy.api.provider.ProviderCalls;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

@DisplayName("/admin/integrations — provider health and call log")
class AdminIntegrationsTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired ProviderCalls calls;
    @Autowired EmailSender email;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager transactions;

    private final String tag = "it-" + UUID.randomUUID();

    // Rows are written by a background thread outside the test transaction, so its rollback does not remove them.
    @AfterEach
    void removeRows() {
        TransactionTemplate own = new TransactionTemplate(transactions);
        own.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        own.executeWithoutResult(s -> jdbc.update("DELETE FROM provider_call WHERE reference LIKE ?", tag + "%"));
    }

    private void awaitRows(int expected) throws InterruptedException {
        for (int i = 0; i < 100; i++) {
            Long rows = jdbc.queryForObject("SELECT count(*) FROM provider_call WHERE reference LIKE ?", Long.class, tag + "%");
            if (rows != null && rows >= expected) {
                return;
            }
            Thread.sleep(50);
        }
        throw new AssertionError("provider_call rows for " + tag + " never landed");
    }

    private String bearer(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Integrations " + mobile.substring(6));
        u.setMobileVerified(true);
        return "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(u));
    }

    @Test
    @DisplayName("health lists the three providers in order, with the mocks reported as not live")
    void healthListsEveryProvider() throws Exception {
        calls.record(ProviderCalls.CASHFREE, "create-order", ProviderCalls.Outcome.FAILED, null, tag,
                "http 502", 40);
        awaitRows(1);

        mvc.perform(get(Routes.Admin.INTEGRATIONS)
                        .header(HttpHeaders.AUTHORIZATION, bearer("9877720001", Roles.Wire.ADMIN)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[0].provider").value("zeptomail"))
                .andExpect(jsonPath("$[1].provider").value("whatsapp"))
                .andExpect(jsonPath("$[2].provider").value("cashfree"))
                .andExpect(jsonPath("$[2].live").value(false))
                .andExpect(jsonPath("$[2].failed24h").value(org.hamcrest.Matchers.greaterThanOrEqualTo(1)))
                .andExpect(jsonPath("$[2].lastFailureDetail").value("http 502"));
    }

    @Test
    @DisplayName("a mock email is logged as skipped, masked, and found only by its full address")
    void mockEmailIsLoggedMasked() throws Exception {
        String address = tag + "@example.com";
        email.send(address, tag + " subject", "body with https://draazy.com/staff-invite#secret");
        awaitRows(1);
        String admin = bearer("9877720002", Roles.Wire.ADMIN);

        mvc.perform(get(Routes.Admin.INTEGRATION_CALLS).param("q", address.toUpperCase())
                        .header(HttpHeaders.AUTHORIZATION, admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].provider").value("zeptomail"))
                .andExpect(jsonPath("$.content[0].operation").value("email"))
                .andExpect(jsonPath("$.content[0].outcome").value("skipped"))
                .andExpect(jsonPath("$.content[0].recipient").value("***@example.com"))
                .andExpect(jsonPath("$.content[0].reference").value(tag + " subject"));

        mvc.perform(get(Routes.Admin.INTEGRATION_CALLS).param("q", tag)
                        .header(HttpHeaders.AUTHORIZATION, admin))
                .andExpect(jsonPath("$.totalElements").value(0));

        assertThat(jdbc.queryForObject("SELECT count(*) FROM provider_call WHERE detail LIKE '%secret%' "
                + "OR reference LIKE '%secret%' OR recipient LIKE ?", Long.class, tag + "%")).isZero();
    }

    @Test
    @DisplayName("filters by provider and outcome, and searches by mobile or order id")
    void filtersAndSearches() throws Exception {
        calls.record(ProviderCalls.WHATSAPP, "otp", ProviderCalls.Outcome.OK, "9811122233", tag + "-otp", null, 120);
        calls.record(ProviderCalls.CASHFREE, "refund", ProviderCalls.Outcome.OK, null, tag + "-order", null, 80);
        awaitRows(2);
        String admin = bearer("9877720003", Roles.Wire.ADMIN);

        mvc.perform(get(Routes.Admin.INTEGRATION_CALLS).param("q", "+91 98111 22233")
                        .param("provider", "whatsapp").param("outcome", "ok")
                        .header(HttpHeaders.AUTHORIZATION, admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].recipient").value("98XXXXX233"))
                .andExpect(jsonPath("$.content[0].durationMs").value(120));

        mvc.perform(get(Routes.Admin.INTEGRATION_CALLS).param("q", tag + "-order")
                        .header(HttpHeaders.AUTHORIZATION, admin))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].operation").value("refund"));

        mvc.perform(get(Routes.Admin.INTEGRATION_CALLS).param("provider", "sms")
                        .header(HttpHeaders.AUTHORIZATION, admin))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("managers and staff are refused: it is admin-only")
    void nonAdminsAreRefused() throws Exception {
        mvc.perform(get(Routes.Admin.INTEGRATIONS)
                        .header(HttpHeaders.AUTHORIZATION, bearer("9877720004", Roles.Wire.MANAGER)))
                .andExpect(status().isForbidden());
        mvc.perform(get(Routes.Admin.INTEGRATION_CALLS)
                        .header(HttpHeaders.AUTHORIZATION, bearer("9877720005", Roles.Wire.STAFF)))
                .andExpect(status().isForbidden());
    }
}
