package com.draazy.api.finance.payment;

import com.draazy.api.billing.BillingPayments;
import com.draazy.api.common.web.Routes;
import com.draazy.api.provider.cashfree.WebhookSignature;
import com.draazy.api.services.request.ServiceRequestService;
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
 * Cashfree payment callback — source of truth for whether a purchase was paid.
 * Rationale: docs/flows/admin/finance.md#payment-webhook-signature-raw-body-idempotent-always-200
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

    /** {@code POST /webhooks/cashfree/payment}; timestamp is signed so a callback cannot be replayed. */
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

            // Three families settle here; each ignores an order id it does not own. Each gets its
            // own try/catch so a failure in one cannot rob the others of the event.
            List<Settlement> outcomes = List.of(
                    settle("subscription", () -> billingPayments.settleSubscription(orderId, paid, settledAt)),
                    settle("boost", () -> billingPayments.settleBoost(orderId, paid, settledAt)),
                    settle("service-request", () -> serviceRequests.applyWebhookOutcome(orderId, paid, amount)));

            if (paid && !outcomes.contains(Settlement.CLAIMED)) {
                // Paid webhook unreconciled: log loudly and distinctly by cause so paging routes right.
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

    /** Run one handler in isolation; {@link Settlement#FAILED} on throw so failure ≠ disownment. */
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
     * Settlement instant from the provider's {@code payment_time}; falls back to now when absent
     * or unparseable rather than failing the callback over a date format.
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
     * Decimal-rupee string → whole rupees; checks the provider, never overwrites the ledger.
     * Rationale: docs/flows/admin/finance.md#payment-webhook-signature-raw-body-idempotent-always-200
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
