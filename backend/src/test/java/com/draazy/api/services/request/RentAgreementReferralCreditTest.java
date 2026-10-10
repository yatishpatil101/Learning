package com.draazy.api.services.request;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.PlatformTime;
import com.draazy.api.common.settings.PlatformSettings;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import com.jayway.jsonpath.JsonPath;
import java.time.LocalDate;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.ResultActions;

@DisplayName("A referral-earned free rent agreement waives Draazy's fee at checkout, never the government's")
class RentAgreementReferralCreditTest extends AbstractApiTest {

    private static final String DECLARATION = "{\"declaration\":\"ra-decl-2026-09\"}";

    @MockitoBean RentAgreementReadiness readiness;

    @Autowired UserRepository users;
    @Autowired PlatformSettings settings;
    @Autowired ServiceRequestReferralCredit referralCredit;

    private User owner(String mobile, int qualifiedReferrals) {
        User u = new User(mobile, "owner");
        u.setName("Referrer " + mobile.substring(6));
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        for (int i = 0; i < qualifiedReferrals; i++) {
            jdbc.update("""
                    insert into referrals (referrer_id, referrer_mobile, referred_mobile, channel, status)
                    values (?, ?, ?, 'owner', 'qualified')
                    """, saved.getId(), mobile, "97" + mobile.substring(4) + "0" + i);
        }
        return saved;
    }

    private static String details() {
        String start = LocalDate.now(PlatformTime.IST).plusDays(7).toString();
        return "{\"_state\":{\"prop\":{\"gramPanchayat\":false},\"terms\":{\"months\":\"11\",\"rent\":\"30000\",\"deposit\":\"0\","
                + "\"startDate\":\"" + start + "\"}}}";
    }

    private String file(User caller, String details) throws Exception {
        String body = details == null ? "{\"type\":\"rent-agreement\"}"
                : "{\"type\":\"rent-agreement\",\"details\":" + details + "}";
        String json = mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(json, "$.id");
    }

    private ResultActions checkout(User caller, String id) throws Exception {
        return mvc.perform(post(Routes.ServiceRequests.CHECKOUT, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(DECLARATION))
                .andExpect(status().isOk());
    }

    private ResultActions agreements(User caller) throws Exception {
        return mvc.perform(get(Routes.Plans.ENTITLEMENTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().isOk());
    }

    private long amount(String id) {
        return jdbc.queryForObject("select amount from service_requests where id = ?::uuid", Long.class, id);
    }

    private boolean credited(String id) {
        return jdbc.queryForObject("select referral_credit from service_requests where id = ?::uuid",
                Boolean.class, id);
    }

    private long draazyFeeWithGst() {
        long fee = settings.rentAgreementPlatform();
        return fee + settings.gstOn(fee);
    }

    @Test
    @DisplayName("takes only Draazy's fee and its GST off, bills the government charges, and spends the credit once")
    void spendsOneCreditAndKeepsGovernmentCharges() throws Exception {
        User caller = owner("9820100001", 3);
        agreements(caller)
                .andExpect(jsonPath("$.agreements.free").value(1))
                .andExpect(jsonPath("$.agreements.used").value(0))
                .andExpect(jsonPath("$.agreements.remaining").value(1));

        String first = file(caller, details());
        long full = amount(first);
        assertThat(full).isGreaterThan(draazyFeeWithGst());

        checkout(caller, first).andExpect(jsonPath("$.paymentSessionId").isNotEmpty());
        assertThat(amount(first)).isEqualTo(full - draazyFeeWithGst()).isPositive();
        assertThat(credited(first)).isTrue();
        agreements(caller)
                .andExpect(jsonPath("$.agreements.free").value(1))
                .andExpect(jsonPath("$.agreements.used").value(1))
                .andExpect(jsonPath("$.agreements.remaining").value(0));

        jdbc.update("update service_requests set status = 'new' where id = ?::uuid", first);
        String second = file(caller, details());
        checkout(caller, second);
        assertThat(amount(second)).isEqualTo(full);
        assertThat(credited(second)).isFalse();
    }

    @Test
    @DisplayName("reopening an open checkout does not take a second credit")
    void resumingDoesNotSpendAgain() throws Exception {
        User caller = owner("9820100002", 6);
        String id = file(caller, details());
        checkout(caller, id);
        long charged = amount(id);
        checkout(caller, id);

        assertThat(amount(id)).isEqualTo(charged);
        agreements(caller).andExpect(jsonPath("$.agreements.used").value(1))
                .andExpect(jsonPath("$.agreements.remaining").value(1));
    }

    @Test
    @DisplayName("a caller with no earned credit pays the full price")
    void noCreditNoWaiver() throws Exception {
        User caller = owner("9820100003", 2);
        String id = file(caller, details());
        long full = amount(id);

        checkout(caller, id);

        assertThat(amount(id)).isEqualTo(full);
        assertThat(credited(id)).isFalse();
    }

    @Test
    @DisplayName("a request whose whole price was Draazy's fee skips the gateway and is filed as paid")
    void zeroTotalSkipsTheGateway() throws Exception {
        jdbc.update("update platform_fees set stamp_duty = 0, registration = 0 where deal = 'rent'");
        User caller = owner("9820100004", 3);
        String id = file(caller, null);

        checkout(caller, id)
                .andExpect(jsonPath("$.status").value("new"))
                .andExpect(jsonPath("$.amount").value(0))
                .andExpect(jsonPath("$.paymentSessionId").doesNotExist());

        assertThat(jdbc.queryForObject("select payment_ref from service_requests where id = ?::uuid",
                String.class, id)).isNull();
        assertThat(jdbc.queryForObject("""
                select count(*) from service_request_timeline
                where request_id = ?::uuid and event = 'payment.waived'
                """, Long.class, id)).isEqualTo(1L);
        agreements(caller).andExpect(jsonPath("$.agreements.remaining").value(0));
    }

    @Test
    @DisplayName("a cancelled request gives its credit back")
    void cancellingReleasesTheCredit() throws Exception {
        User caller = owner("9820100005", 3);
        String id = file(caller, details());
        checkout(caller, id);

        jdbc.update("update service_requests set status = 'cancelled' where id = ?::uuid", id);

        agreements(caller).andExpect(jsonPath("$.agreements.used").value(0))
                .andExpect(jsonPath("$.agreements.remaining").value(1));
    }

    @Test
    @DisplayName("a clawed-back referral leaves remaining at zero, never negative, and the issued agreement stays")
    void clawbackNeverGoesNegative() throws Exception {
        User caller = owner("9820100006", 3);
        String id = file(caller, details());
        checkout(caller, id);
        long charged = amount(id);

        jdbc.update("update referrals set status = 'clawed-back' where referrer_id = ?", caller.getId());

        agreements(caller)
                .andExpect(jsonPath("$.agreements.free").value(0))
                .andExpect(jsonPath("$.agreements.used").value(1))
                .andExpect(jsonPath("$.agreements.remaining").value(0));
        assertThat(amount(id)).isEqualTo(charged);
        assertThat(credited(id)).isTrue();
    }

    @Test
    @DisplayName("only rent agreements can hold a credit")
    void otherServicesAreUntouched() {
        User caller = owner("9820100007", 3);
        ServiceRequest other = new ServiceRequest(caller.getId(), ServiceRequestTypes.PACKERS, null, null, null);
        other.awaitPayment(1000L);

        assertThat(referralCredit.spend(other)).isFalse();
        assertThat(other.getAmount()).isEqualTo(1000L);
        assertThat(other.isReferralCredit()).isFalse();
    }
}
