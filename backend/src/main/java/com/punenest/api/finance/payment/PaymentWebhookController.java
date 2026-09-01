package com.punenest.api.finance.payment;

import com.punenest.api.billing.BillingPayments;
import com.punenest.api.common.web.Routes;
import com.punenest.api.provider.cashfree.WebhookSignature;
import com.punenest.api.services.request.ServiceRequestService;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
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
 * whether a purchase was actually paid for.
 *
 * <p>This is the most consequential handler in the application: the synchronous {@code 201} on a
 * checkout only says an order was created, and <em>this</em> is what tells a customer they were
 * charged. The same four rules as the DigiLocker callback apply, for the same reasons.
 *
 * <ol>
 *   <li><em>Signature-verified.</em> The route is {@code permitAll} because a provider has no user
 *       session; authenticity is an HMAC over the raw body ({@link WebhookSignature}). Without it,
 *       anyone who learned the URL could mark any order paid.</li>
 *   <li><em>Raw body, not a bound object.</em> The signature covers the exact bytes sent, so the
 *       body arrives as a {@code String} and is parsed here. Letting Spring bind and re-serialize
 *       would change key order and whitespace, and every genuine callback would fail.</li>
 *   <li><em>Idempotent.</em> Deduped on {@code data.order.order_id}, which every settling family
 *       stores under a unique constraint. Cashfree explicitly may redeliver an event, and each
 *       family's state machine refuses to move an order that has already settled.</li>
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
 *
 * <p><strong>Why it lives in {@code finance} rather than in a product package.</strong>
 * Three unrelated families settle here — subscriptions, boosts and paid service requests — so the
 * callback belongs to none of them, and it cannot move into the shared kernel either: it has to
 * call into all three, and {@code package-structure.md} §2 forbids the kernel from importing a
 * feature ({@code ArchitectureBoundaryTest} fails the build over it). {@code finance} is the
 * context ranked above billing and services precisely so that this arrow is legal. It sat in
 * {@code finance.rent} while online rent-pay existed; when that rail was withdrawn the handler
 * stayed in {@code finance}, one package across, because the other three still depend on it.
 */
@RestController
public class PaymentWebhookController {

    private static final Logger log = LoggerFactory.getLogger(PaymentWebhookController.class);

    /** Provider status meaning the money moved. */
    private static final String PROVIDER_SUCCESS = "SUCCESS";

    private final BillingPayments billingPayments;
    private final ServiceRequestService serviceRequests;
    private final WebhookSignature webhookSignature;
    private final ObjectMapper objectMapper;

    public PaymentWebhookController(BillingPayments billingPayments,
            ServiceRequestService serviceRequests, WebhookSignature webhookSignature,
            ObjectMapper objectMapper) {
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

            String paymentTime = payment.path("payment_time").asString(null);
            Instant settledAt = settlementInstant(paymentTime);
            long amount = toWholeRupees(payment.path("payment_amount").asString(null));

            // One gateway, several products: a subscription, a listing boost and a paid rent
            // agreement all land on this same callback. Each side ignores an order id it does not
            // own, so all three are always offered the event rather than guessing from the payload
            // which it was.
            //
            // Each gets its own try/catch. They used to share one, which meant a failure in the
            // first — an unrelated bug in one path, say — returned 200 without the others ever
            // being asked. Cashfree does not retry a 200, so a paid agreement would have sat at
            // awaiting-payment forever with the money already taken.
            List<Settlement> outcomes = List.of(
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
                    log.error("Paid webhook for order {} matched no subscription, boost or service "
                            + "request; the payment is unreconciled", orderId);
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
        /** The handler does not own this order id — the normal answer for two of the three. */
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
     * The instant the payment settled, from the provider's {@code payment_time}.
     *
     * <p>Billing needs a timestamp because a subscription term and a boost window both run from the
     * moment the money moved, not from midnight. Falls back to now when the field is absent or
     * unparseable rather than failing the whole callback: the fact that the money moved is far more
     * important than the exact instant it is stamped, and refusing the update over a date format
     * would leave a paid order showing as unpaid.
     */
    private static Instant settlementInstant(String paymentTime) {
        if (paymentTime == null || paymentTime.isBlank()) {
            return Instant.now();
        }
        try {
            return OffsetDateTime.parse(paymentTime).toInstant();
        } catch (DateTimeParseException unparseable) {
            log.warn("Unparseable payment_time '{}'; stamping now", paymentTime);
            return Instant.now();
        }
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
