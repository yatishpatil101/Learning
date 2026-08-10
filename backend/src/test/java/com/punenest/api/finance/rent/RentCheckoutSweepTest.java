package com.punenest.api.finance.rent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Routes;
import com.punenest.api.finance.tenancy.Tenancy;
import com.punenest.api.finance.tenancy.TenancyRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.provider.cashfree.WebhookSignature;
import com.punenest.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The sweep that retires abandoned rent checkouts — D161.
 *
 * <p><strong>Why a stale {@code due} row is always an abandoned checkout.</strong> Rent here is not
 * a monthly invoice the platform raises: nothing but {@code payRent} ever creates a payment row, and
 * it creates one only when a tenant opens a checkout. So a {@code due} row that has sat past its TTL
 * is not an unpaid month waiting to be paid — it is a checkout somebody walked away from, and the
 * month it covers is not payable again until it is cleared. That is what makes sweeping it safe, and
 * it is the one assumption in this file worth restating if the rent rail ever gains a scheduler.
 *
 * <p><strong>The residual risk is deliberate and bounded.</strong> A payment confirmed after the row
 * has been swept lands on a terminal row and is ignored — the same trade D152 already made for
 * service requests. The TTL sits well outside the life of a Cashfree session, so the window is one a
 * customer cannot reach by ordinary use; and leaving the month unpayable forever is the worse
 * failure of the two.
 */
@DisplayName("D161 — abandoned rent checkouts are retired and the month is freed")
class RentCheckoutSweepTest extends AbstractApiTest {

    private static final long RENT = 28_000L;

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired TenancyRepository tenancies;
    @Autowired RentPaymentRepository payments;
    @Autowired RentService rentService;
    @Autowired WebhookSignature webhookSignature;

    @Test
    @DisplayName("a due payment past its TTL fails with a reason, and the month can be paid again")
    void staleCheckoutsFailAndFreeTheMonth() throws Exception {
        User tenant = user("9877700001", "buyer");
        Tenancy t = tenancyFor(user("9877700002", "owner"), tenant);
        pay(t, tenant, 201);

        assertThat(rentService.expireAbandonedCheckouts(future())).isEqualTo(1);

        RentPayment swept = onlyPayment(tenant);
        assertThat(swept.getStatus()).isEqualTo(RentPaymentStatuses.FAILED);
        // The tenant reads this in their own ledger, so it must not read as a decline: no bank ever
        // saw this money, and "try again" is the correct next step rather than an apology.
        assertThat(swept.getFailureReason())
                .contains("checkout expired")
                .contains("Nothing was charged");
        assertThat(swept.getPaidDate()).isNull();

        // The point of the sweep: the month is payable again rather than blocked by a dead row.
        pay(t, tenant, 201);
    }

    @Test
    @DisplayName("a payment still inside its TTL is left alone")
    void freshCheckoutsSurvive() throws Exception {
        User tenant = user("9877700003", "buyer");
        Tenancy t = tenancyFor(user("9877700004", "owner"), tenant);
        pay(t, tenant, 201);

        assertThat(rentService.expireAbandonedCheckouts(past())).isZero();

        assertThat(onlyPayment(tenant).getStatus()).isEqualTo(RentPaymentStatuses.DUE);
    }

    @Test
    @DisplayName("a settled payment is never touched, however old it is")
    void paidRentIsUntouchable() throws Exception {
        User tenant = user("9877700005", "buyer");
        Tenancy t = tenancyFor(user("9877700006", "owner"), tenant);
        deliverSigned(payAndReadRef(t, tenant));

        assertThat(rentService.expireAbandonedCheckouts(future())).isZero();

        RentPayment settled = onlyPayment(tenant);
        assertThat(settled.getStatus()).isEqualTo(RentPaymentStatuses.PAID);
        assertThat(settled.getFailureReason()).isNull();
    }

    @Test
    @DisplayName("a second pass over the same rows fails nothing further")
    void theSweepIsIdempotent() throws Exception {
        User tenant = user("9877700007", "buyer");
        Tenancy t = tenancyFor(user("9877700008", "owner"), tenant);
        pay(t, tenant, 201);

        assertThat(rentService.expireAbandonedCheckouts(future())).isEqualTo(1);
        assertThat(rentService.expireAbandonedCheckouts(future())).isZero();
    }

    /**
     * The case {@code abandonUnopened} could never have covered: the gateway order exists, the
     * tenant simply closed the modal. A guard on "no reference yet" would have skipped precisely the
     * rows this sweep is for.
     */
    @Test
    @DisplayName("a row that already carries a gateway order is swept, not skipped")
    void rowsWithAnOrderAreSweptToo() throws Exception {
        User tenant = user("9877700009", "buyer");
        Tenancy t = tenancyFor(user("9877700010", "owner"), tenant);
        assertThat(payAndReadRef(t, tenant)).isNotBlank();

        assertThat(rentService.expireAbandonedCheckouts(future())).isEqualTo(1);

        assertThat(onlyPayment(tenant).getStatus()).isEqualTo(RentPaymentStatuses.FAILED);
    }

    // ---------------------------------------------------------------- fixtures

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Rent Sweep " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /** A let flat closed to a tenant — which is what opens the tenancy the rent rail bills on. */
    private Tenancy tenancyFor(User owner, User tenant) throws Exception {
        Property p = new Property(owner, "Let flat", "rent", "apartment", RENT, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("950"));
        properties.saveAndFlush(p);

        mvc.perform(post("/me/deals/" + p.getId() + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":" + RENT + ",\"counterpartyMobile\":\""
                                + tenant.getMobile() + "\"}"))
                .andExpect(status().isOk());

        return tenancies.findActiveByPropertyId(p.getId()).orElseThrow();
    }

    /** Everything this suite creates is younger than this, so the whole set is past its TTL. */
    private Instant future() {
        return Instant.now().plus(Duration.ofMinutes(5));
    }

    /** Older than anything this suite creates, so nothing is stale. */
    private Instant past() {
        return Instant.now().minus(Duration.ofHours(1));
    }

    // ---------------------------------------------------------------- actions

    private void pay(Tenancy t, User tenant, int expected) throws Exception {
        mvc.perform(post(Routes.Rent.PAYMENTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenancyId\":\"" + t.getId() + "\"}"))
                .andExpect(status().is(expected));
    }

    private String payAndReadRef(Tenancy t, User tenant) throws Exception {
        String body = mvc.perform(post(Routes.Rent.PAYMENTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenancyId\":\"" + t.getId() + "\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return jsonField(body, "reference");
    }

    private void deliverSigned(String orderId) throws Exception {
        String paidAt = java.time.OffsetDateTime.now(java.time.ZoneId.of("Asia/Kolkata"))
                .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX"));
        String body = "{\"type\":\"PAYMENT_SUCCESS_WEBHOOK\",\"data\":{"
                + "\"order\":{\"order_id\":\"" + orderId + "\"},"
                + "\"payment\":{\"payment_status\":\"SUCCESS\","
                + "\"payment_amount\":28661.00,"
                + "\"payment_time\":\"" + paidAt + "\"}}}";
        String ts = String.valueOf(System.currentTimeMillis());
        mvc.perform(post(Routes.Webhooks.CASHFREE_PAYMENT)
                        .header("x-webhook-timestamp", ts)
                        .header("x-webhook-signature", webhookSignature.sign(ts, body))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    // ---------------------------------------------------------------- state

    /**
     * Read through the repository, not {@code jdbc}: the sweep joins this test's transaction and
     * mutates managed entities, and only a JPA query forces those changes out to the database. Raw
     * SQL here would quietly assert the pre-sweep state and pass whatever the sweep did.
     */
    private RentPayment onlyPayment(User tenant) {
        List<RentPayment> found = paymentsOf(tenant.getId());
        assertThat(found).hasSize(1);
        return found.getFirst();
    }

    private List<RentPayment> paymentsOf(UUID tenantId) {
        return payments.findByTenantId(tenantId, PageRequest.of(0, 100)).getContent();
    }

    private static String jsonField(String body, String field) {
        int i = body.indexOf("\"" + field + "\":\"") + field.length() + 4;
        return body.substring(i, body.indexOf('"', i));
    }
}
