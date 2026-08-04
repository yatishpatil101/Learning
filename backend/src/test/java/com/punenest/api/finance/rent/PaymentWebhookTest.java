package com.punenest.api.finance.rent;

import com.punenest.api.support.AbstractApiTest;
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
import com.punenest.api.security.JwtService;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Proof for the payment webhook — the only path in the application that may declare rent paid.
 *
 * <p>Every callback here is signed with the <strong>real</strong> {@link WebhookSignature} bean
 * rather than a stub. A signature check that is only ever mocked is a signature check nobody has
 * run: the test would pass just as happily against a handler that ignored the header entirely,
 * which is precisely the bug worth catching.
 *
 * <p>Four properties are proved, matching the four rules in {@link PaymentWebhookController}:
 * an unsigned or wrongly-signed callback changes nothing; a genuine one settles the payment; a
 * redelivery of a settled payment is a no-op; and every one of those cases answers {@code 200},
 * because a differentiated response would let a prober map real order ids and a non-200 would make
 * the provider retry forever.
 */
class PaymentWebhookTest extends AbstractApiTest {

    private static final long RENT = 28_000L;

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired TenancyRepository tenancies;
    @Autowired RentPaymentRepository payments;
    @Autowired WebhookSignature webhookSignature;

    // ---- fixtures ----

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Webhook User " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /** Creates a pending rent payment through the real endpoint and returns its provider order id. */
    private String pendingPayment(String ownerMobile, String tenantMobile) throws Exception {
        User owner = user(ownerMobile, "owner");
        User tenant = user(tenantMobile, "buyer");

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

        Tenancy t = tenancies.findActiveByPropertyId(p.getId()).orElseThrow();
        String body = mvc.perform(post(Routes.Rent.PAYMENTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tenancyId\":\"" + t.getId() + "\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        int i = body.indexOf("\"reference\":\"") + 13;
        return body.substring(i, body.indexOf('"', i));
    }

    /** The nested payload Cashfree actually sends (spec fix S15), not the flat one it never did. */
    private static String callback(String orderId, String status, String amount) {
        return "{\"type\":\"PAYMENT_SUCCESS_WEBHOOK\",\"data\":{"
                + "\"order\":{\"order_id\":\"" + orderId + "\",\"order_amount\":" + amount + "},"
                + "\"payment\":{\"payment_status\":\"" + status + "\","
                + "\"payment_amount\":" + amount + ","
                + "\"payment_time\":\"2025-03-05T11:20:00+05:30\"}}}";
    }

    /** Posts a callback signed with the real HMAC, exactly as Cashfree would. */
    private void deliverSigned(String body) throws Exception {
        String ts = String.valueOf(System.currentTimeMillis());
        mvc.perform(post(Routes.Webhooks.CASHFREE_PAYMENT)
                        .header("x-webhook-timestamp", ts)
                        .header("x-webhook-signature", webhookSignature.sign(ts, body))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    private RentPayment reload(String orderId) {
        return payments.findByReference(orderId).orElseThrow();
    }

    // ---- 1: a genuine callback settles the payment ----

    @Test
    void aSignedSuccessCallbackMarksThePaymentPaid() throws Exception {
        String orderId = pendingPayment("9844400001", "9844400002");
        assertThat(reload(orderId).getStatus()).isEqualTo(RentPaymentStatuses.DUE);

        deliverSigned(callback(orderId, "SUCCESS", "28661.00"));

        RentPayment settled = reload(orderId);
        assertThat(settled.getStatus()).isEqualTo(RentPaymentStatuses.PAID);
        assertThat(settled.getPaidDate()).isNotNull();
        assertThat(settled.getFailureReason()).isNull();
    }

    @Test
    void aSignedFailureCallbackMarksThePaymentFailedAndKeepsTheReason() throws Exception {
        String orderId = pendingPayment("9844400003", "9844400004");

        String body = "{\"type\":\"PAYMENT_FAILED_WEBHOOK\",\"data\":{"
                + "\"order\":{\"order_id\":\"" + orderId + "\"},"
                + "\"payment\":{\"payment_status\":\"FAILED\",\"payment_amount\":28661.00},"
                + "\"error_details\":{\"error_description\":\"Insufficient funds\"}}}";
        deliverSigned(body);

        RentPayment failed = reload(orderId);
        assertThat(failed.getStatus()).isEqualTo(RentPaymentStatuses.FAILED);
        assertThat(failed.getFailureReason()).isEqualTo("Insufficient funds");
        assertThat(failed.getPaidDate()).isNull();
    }

    // ---- 2: forgery changes nothing ----

    @Test
    void anUnsignedCallbackIsIgnoredButStillAnswers200() throws Exception {
        String orderId = pendingPayment("9844400005", "9844400006");

        mvc.perform(post(Routes.Webhooks.CASHFREE_PAYMENT)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(callback(orderId, "SUCCESS", "28661.00")))
                .andExpect(status().isOk());

        assertThat(reload(orderId).getStatus()).isEqualTo(RentPaymentStatuses.DUE);
    }

    @Test
    void aWronglySignedCallbackIsIgnoredButStillAnswers200() throws Exception {
        String orderId = pendingPayment("9844400007", "9844400008");
        String body = callback(orderId, "SUCCESS", "28661.00");

        // A valid-looking base64 signature over the right body but the wrong secret. Without the
        // HMAC check, anyone who learned this URL could mark any rent in the country paid.
        mvc.perform(post(Routes.Webhooks.CASHFREE_PAYMENT)
                        .header("x-webhook-timestamp", String.valueOf(System.currentTimeMillis()))
                        .header("x-webhook-signature", "bm90LWEtcmVhbC1zaWduYXR1cmU=")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());

        assertThat(reload(orderId).getStatus()).isEqualTo(RentPaymentStatuses.DUE);
    }

    @Test
    void aReplayedSignatureUnderAStaleTimestampIsIgnored() throws Exception {
        String orderId = pendingPayment("9844400009", "9844400010");
        String body = callback(orderId, "SUCCESS", "28661.00");

        // Correctly signed for a timestamp six minutes old: the signature verifies in isolation but
        // the freshness window rejects it, which is what stops a captured callback being replayable
        // forever.
        String stale = String.valueOf(System.currentTimeMillis() - (6 * 60 * 1000L));
        mvc.perform(post(Routes.Webhooks.CASHFREE_PAYMENT)
                        .header("x-webhook-timestamp", stale)
                        .header("x-webhook-signature", webhookSignature.sign(stale, body))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());

        assertThat(reload(orderId).getStatus()).isEqualTo(RentPaymentStatuses.DUE);
    }

    @Test
    void aSignatureOverADifferentBodyIsIgnored() throws Exception {
        String orderId = pendingPayment("9844400011", "9844400012");
        String ts = String.valueOf(System.currentTimeMillis());

        // Sign one payload, send another - the tamper case the raw-body rule exists for.
        String signedFor = callback("mock_order_someone_else", "SUCCESS", "1.00");
        mvc.perform(post(Routes.Webhooks.CASHFREE_PAYMENT)
                        .header("x-webhook-timestamp", ts)
                        .header("x-webhook-signature", webhookSignature.sign(ts, signedFor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(callback(orderId, "SUCCESS", "28661.00")))
                .andExpect(status().isOk());

        assertThat(reload(orderId).getStatus()).isEqualTo(RentPaymentStatuses.DUE);
    }

    // ---- 3: redelivery is a no-op ----

    @Test
    void aRedeliveredSuccessLeavesTheSettledPaymentUntouched() throws Exception {
        String orderId = pendingPayment("9844400013", "9844400014");
        String body = callback(orderId, "SUCCESS", "28661.00");

        deliverSigned(body);
        java.time.LocalDate firstPaidOn = reload(orderId).getPaidDate();

        deliverSigned(body);

        RentPayment after = reload(orderId);
        assertThat(after.getStatus()).isEqualTo(RentPaymentStatuses.PAID);
        assertThat(after.getPaidDate()).isEqualTo(firstPaidOn);
    }

    @Test
    void aContradictoryFailureAfterSuccessCannotUnsettleAPaidRent() throws Exception {
        String orderId = pendingPayment("9844400015", "9844400016");

        deliverSigned(callback(orderId, "SUCCESS", "28661.00"));
        deliverSigned(callback(orderId, "FAILED", "28661.00"));

        // `paid` is terminal. A late or out-of-order failure event must never take money back off a
        // tenant's record - they would show as owing rent they have already paid.
        assertThat(reload(orderId).getStatus()).isEqualTo(RentPaymentStatuses.PAID);
    }

    // ---- 4: callbacks that are not ours ----

    @Test
    void anUnknownOrderIdIsIgnoredQuietly() throws Exception {
        // Cashfree also sends callbacks for orders this table never created. Treating those as
        // failures would mean retries forever for events that are not ours.
        deliverSigned(callback("mock_order_never_created", "SUCCESS", "500.00"));
    }

    @Test
    void aSignedButMalformedPayloadStillAnswers200() throws Exception {
        deliverSigned("{ this is not json ");
        deliverSigned("{\"data\":{}}");
    }

    // ---- 5: the amount parser used for reconciliation ----

    @Test
    void providerAmountsAreParsedToWholeRupees_andNonsenseIsSkippedNotThrown() {
        assertThat(PaymentWebhookController.toWholeRupees("28661.00")).isEqualTo(28_661L);
        assertThat(PaymentWebhookController.toWholeRupees("28661.49")).isEqualTo(28_661L);
        // HALF_UP, as an invoice rounds - not HALF_EVEN, which is right for statistics and wrong
        // for money somebody is being charged.
        assertThat(PaymentWebhookController.toWholeRupees("28661.50")).isEqualTo(28_662L);
        assertThat(PaymentWebhookController.toWholeRupees(null)).isZero();
        assertThat(PaymentWebhookController.toWholeRupees("  ")).isZero();
        // A garbage amount must not take down a callback that is otherwise telling us money moved.
        assertThat(PaymentWebhookController.toWholeRupees("not-a-number")).isZero();
    }

    @Test
    void aMismatchedProviderAmountStillSettles_becauseTheMoneyAlreadyMoved() throws Exception {
        String orderId = pendingPayment("9844400017", "9844400018");

        // The provider claims a different figure than we billed. That is worth an alert, but
        // refusing to record it would leave a tenant who has genuinely paid showing as unpaid.
        deliverSigned(callback(orderId, "SUCCESS", "1.00"));

        RentPayment settled = reload(orderId);
        assertThat(settled.getStatus()).isEqualTo(RentPaymentStatuses.PAID);
        // Our own figures are untouched: the callback is never allowed to write the ledger.
        assertThat(settled.getAmount()).isEqualTo(RENT);
        assertThat(settled.getPlatformFee() + settled.getGst()).isEqualTo(661L);
    }
}
