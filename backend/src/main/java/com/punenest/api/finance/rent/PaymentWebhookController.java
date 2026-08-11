package com.punenest.api.finance.rent;

import com.punenest.api.billing.BillingPayments;
import com.punenest.api.common.PlatformTime;
import com.punenest.api.common.web.Routes;
import com.punenest.api.provider.cashfree.WebhookSignature;
import com.punenest.api.services.request.ServiceRequestService;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.function.BooleanSupplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * The Cashfree payment callback at {@code /webhooks/cashfree/payment} — the source of truth for
 * whether rent was actually paid.
 *
 * <p>This is the most consequential handler in the application: the synchronous {@code 201} on
 * {@code POST /me/rent-payments} only says an order was created, and <em>this</em> is what tells an
 * owner they were paid. The same four rules as the DigiLocker callback apply, for the same reasons.
 *
 * <ol>
 *   <li><em>Signature-verified.</em> The route is {@code permitAll} because a provider has no user
 *       session; authenticity is an HMAC over the raw body ({@link WebhookSignature}). Without it,
 *       anyone who learned the URL could mark any rent paid.</li>
 *   <li><em>Raw body, not a bound object.</em> The signature covers the exact bytes sent, so the
 *       body arrives as a {@code String} and is parsed here. Letting Spring bind and re-serialize
 *       would change key order and whitespace, and every genuine callback would fail.</li>
 *   <li><em>Idempotent.</em> Deduped on {@code data.order.order_id} — unique in the database since
 *       V14. Cashfree explicitly may redeliver an event, and the state machine in
 *       {@link RentPaymentStatuses} refuses to move a payment that has already settled.</li>
 *   <li><em>Always {@code 200}.</em> A bad signature, malformed JSON and an unknown order all
 *       return the same empty {@code 200}. A provider that sees an error retries forever, and a
 *       differentiated response would let a prober confirm which order ids are real.</li>
 * </ol>
 *
 * <p><strong>The payload is nested, and that matters (spec fix S15).</strong> The contract used to
 * document a flat body that Cashfree has never sent. Anyone implementing it faithfully would have
 * built a handler that silently never fired: every field would read null, the signature would still
 * verify, and the endpoint would answer 200 while doing nothing — the worst failure mode available
 * to a payment webhook.
 */
@RestController
public class PaymentWebhookController {

    private static final Logger log = LoggerFactory.getLogger(PaymentWebhookController.class);

    /**
     * Rent is due on a calendar day in India, so a settlement day must be read in India — the
     * server's default zone is an accident of deployment. A 23:30 IST callback with no
     * {@code payment_time} stamps yesterday on a UTC host, and that is a rent row filed against
     * the wrong day.
     *
     * <p>An alias for {@link PlatformTime#IST}, kept only so the paragraph above stays next to the
     * use sites; the zone itself lives in one place (tech debt D179).
     */
    private static final ZoneId SETTLEMENT_ZONE = PlatformTime.IST;

    /** Provider status meaning the money moved. */
    private static final String PROVIDER_SUCCESS = "SUCCESS";

    private final RentService rentService;
    private final BillingPayments billingPayments;
    private final ServiceRequestService serviceRequests;
    private final WebhookSignature webhookSignature;
    private final ObjectMapper objectMapper;

    public PaymentWebhookController(RentService rentService, BillingPayments billingPayments,
            ServiceRequestService serviceRequests, WebhookSignature webhookSignature,
            ObjectMapper objectMapper) {
        this.rentService = rentService;
        this.billingPayments = billingPayments;
        this.serviceRequests = serviceRequests;
        this.webhookSignature = webhookSignature;
        this.objectMapper = objectMapper;
    }

    /**
     * {@code POST /webhooks/cashfree/payment} (contract {@code cashfreePaymentWebhook}).
     *
     * @param signature {@code x-webhook-signature}, base64 HMAC-SHA256 over {@code timestamp + body}
     * @param timestamp {@code x-webhook-timestamp}, signed alongside the body so a captured callback
     *                  cannot be replayed under a new time
     * @param rawBody   the exact bytes that were signed
     */
    @PostMapping(Routes.Webhooks.CASHFREE_PAYMENT)
    @ResponseStatus(HttpStatus.OK)
    public void cashfreePaymentWebhook(
            @RequestHeader(name = "x-webhook-signature", required = false) String signature,
            @RequestHeader(name = "x-webhook-timestamp", required = false) String timestamp,
            @RequestBody(required = false) String rawBody) {

        if (!webhookSignature.matches(signature, timestamp, rawBody)) {
            log.warn("Rejected payment webhook: signature did not verify");
            return;
        }
        try {
            JsonNode root = objectMapper.readTree(rawBody);
            JsonNode data = root.path("data");
            JsonNode payment = data.path("payment");

            String orderId = data.path("order").path("order_id").asString(null);
            String providerStatus = payment.path("payment_status").asString(null);
            boolean paid = PROVIDER_SUCCESS.equals(providerStatus);

            String next = paid ? RentPaymentStatuses.PAID : RentPaymentStatuses.FAILED;
            String paymentTime = payment.path("payment_time").asString(null);
            LocalDate settledOn = settlementDate(paymentTime);
            Instant settledAt = settlementInstant(paymentTime);
            long amount = toWholeRupees(payment.path("payment_amount").asString(null));

            // Rent is not the only thing bought through this gateway: a subscription, a listing
            // boost and a paid rent agreement all land on the same callback. Each side ignores an
            // order id it does not own, so all four are always offered the event rather than
            // guessing from the payload which it was.
            //
            // Each gets its own try/catch. They used to share one, which meant a failure in the
            // first — an unrelated bug in the rent path, say — returned 200 without the others
            // ever being asked. Cashfree does not retry a 200, so a paid agreement would have sat
            // at awaiting-payment forever with the money already taken.
            List<Settlement> outcomes = List.of(
                    settle("rent", () -> rentService.applyWebhookOutcome(orderId, next, settledOn,
                            failureReason(data.path("error_details")), amount)),
                    settle("subscription", () -> billingPayments.settleSubscription(orderId, paid, settledAt)),
                    settle("boost", () -> billingPayments.settleBoost(orderId, paid, settledAt)),
                    settle("service-request", () -> serviceRequests.applyWebhookOutcome(orderId, paid, amount)));

            if (paid && !outcomes.contains(Settlement.CLAIMED)) {
                // Money moved and nothing recorded it. Dropping this silently is how a customer pays
                // and nothing at all happens; there is no automatic recovery and no retry, so the
                // only correct response is to make it findable — and to say which of the two very
                // different causes it was, because they send whoever is paged to different places.
                if (outcomes.contains(Settlement.FAILED)) {
                    log.error("Paid webhook for order {} was not settled: a handler failed (see the "
                            + "error above). The payment is unreconciled and will not be retried", orderId);
                } else {
                    log.error("Paid webhook for order {} matched no rent payment, subscription, boost "
                            + "or service request; the payment is unreconciled", orderId);
                }
            }

        } catch (Exception unprocessable) {
            // why: a signed-but-unreadable payload is our bug or a provider change, not the
            // sender's problem. Retrying will not help, so we swallow it and keep the 200 contract.
            log.error("Signed payment webhook could not be processed", unprocessable);
        }
    }

    /** What one settle handler did with the event. */
    private enum Settlement {
        /** The handler owned the order and recorded the outcome. */
        CLAIMED,
        /** The handler does not own this order id — the normal answer for three of the four. */
        NOT_MINE,
        /** The handler threw. Distinct from {@link #NOT_MINE}: the order may well have been ours. */
        FAILED
    }

    /**
     * Run one settle handler in isolation, so a failure in it cannot cost the others their event.
     *
     * @return what the handler did; {@link Settlement#FAILED} if it threw, because a handler that
     *         failed cannot be said to have settled anything — nor to have disowned the order
     */
    private Settlement settle(String handler, BooleanSupplier settlement) {
        try {
            return settlement.getAsBoolean() ? Settlement.CLAIMED : Settlement.NOT_MINE;
        } catch (Exception failed) {
            log.error("Payment webhook handler '{}' failed; the other handlers still ran", handler,
                    failed);
            return Settlement.FAILED;
        }
    }

    /**
     * The date the payment settled, from the provider's {@code payment_time}.
     *
     * <p>Falls back to today when absent or unparseable rather than failing the whole callback: the
     * fact that the money moved is far more important than the exact day it is stamped, and
     * refusing the update over a date format would leave a paid rent showing as unpaid.
     */
    private static LocalDate settlementDate(String paymentTime) {
        if (paymentTime == null || paymentTime.isBlank()) {
            return LocalDate.now(SETTLEMENT_ZONE);
        }
        try {
            return OffsetDateTime.parse(paymentTime).toLocalDate();
        } catch (DateTimeParseException unparseable) {
            log.warn("Unparseable payment_time '{}'; stamping today", paymentTime);
            return LocalDate.now(SETTLEMENT_ZONE);
        }
    }

    /**
     * The instant the payment settled.
     *
     * <p>Billing needs a timestamp rather than a date because a subscription term and a boost window
     * both run from the moment the money moved, not from midnight. Falls back to now for the same
     * reason {@link #settlementDate} falls back to today.
     */
    private static Instant settlementInstant(String paymentTime) {
        if (paymentTime == null || paymentTime.isBlank()) {
            return Instant.now();
        }
        try {
            return OffsetDateTime.parse(paymentTime).toInstant();
        } catch (DateTimeParseException unparseable) {
            return Instant.now();
        }
    }

    /** The provider's failure reason, preferring the human-readable description. */
    private static String failureReason(JsonNode errorDetails) {
        if (errorDetails == null || errorDetails.isMissingNode() || errorDetails.isNull()) {
            return null;
        }
        String description = errorDetails.path("error_description").asString(null);
        return description != null ? description : errorDetails.path("error_reason").asString(null);
    }

    /**
     * Parses the provider's decimal-rupee string ({@code "17000.00"}) into whole rupees.
     *
     * <p><strong>Kept in exactly one place deliberately.</strong> Cashfree sends money as a decimal
     * string with paise while the platform's {@code Money} is whole rupees, so somebody has to make
     * a lossy conversion — and a lossy conversion duplicated across a codebase is a reconciliation
     * bug waiting to happen.
     *
     * <p>The result is used to <em>check</em> the provider against our own ledger, never to
     * overwrite it: the amount of record is the one this server computed, and reading it back off
     * the callback would let the provider's rounding silently become our revenue figure.
     *
     * @return whole rupees, or {@code 0} when the provider sent no amount (in which case the
     *         reconciliation check is skipped rather than failed)
     */
    static long toWholeRupees(String decimalAmount) {
        if (decimalAmount == null || decimalAmount.isBlank()) {
            return 0L;
        }
        try {
            return new BigDecimal(decimalAmount.trim())
                    .setScale(0, java.math.RoundingMode.HALF_UP)
                    .longValueExact();
        } catch (ArithmeticException | NumberFormatException notANumber) {
            log.warn("Unparseable provider amount '{}'; skipping the reconciliation check",
                    decimalAmount);
            return 0L;
        }
    }
}
