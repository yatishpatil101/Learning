package com.punenest.api.finance.rent;

import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.finance.tenancy.Tenancy;
import com.punenest.api.finance.tenancy.TenancyRepository;
import com.punenest.api.provider.PaymentGateway;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The rent money rail — initiating a payment, reading both sides of the ledger, and the autopay
 * mandate and payout account that sit either end of it.
 *
 * <p><strong>Everything that decides an amount is derived here, never accepted.</strong> The rent
 * comes from the tenancy (spec fix S12) and the fee and GST come from {@link RentFeeCalculator}
 * (spec fix S13). The client's only say in the money is the optional {@code expectedAmount}, which
 * can refuse a charge but can never set one.
 *
 * <p><strong>A payment is created pending and is settled only by the provider callback.</strong>
 * See {@link RentPaymentStatuses}. Nothing in this class writes {@code paid} except
 * {@link #applyWebhookOutcome}, which is reachable only from the signature-verified webhook.
 *
 * <p><strong>Scoping is by participation, and a stranger's row is a 404, never a 403.</strong> A
 * tenant sees payments on tenancies they hold; an owner sees payments on tenancies they let.
 * Answering 403 would confirm that a given tenancy id exists and belongs to someone else.
 */
@Service
public class RentService {

    private static final Logger log = LoggerFactory.getLogger(RentService.class);

    /**
     * The rail a mandate is registered with. Recorded on the row so that when a second provider is
     * added, existing mandates are still attributable — a null provider on a live standing
     * instruction is an instruction nobody can cancel.
     */
    private static final String MANDATE_PROVIDER = "cashfree";

    /** How many trailing digits of an account number survive masking. */
    private static final int VISIBLE_ACCOUNT_DIGITS = 4;

    private final RentPaymentRepository payments;
    private final RentMandateRepository mandates;
    private final PayoutAccountRepository payoutAccounts;
    private final TenancyRepository tenancies;
    private final RentFeeCalculator fees;
    private final PaymentGateway gateway;
    private final RentMapper mapper;

    public RentService(RentPaymentRepository payments, RentMandateRepository mandates,
            PayoutAccountRepository payoutAccounts, TenancyRepository tenancies,
            RentFeeCalculator fees, PaymentGateway gateway, RentMapper mapper) {
        this.payments = payments;
        this.mandates = mandates;
        this.payoutAccounts = payoutAccounts;
        this.tenancies = tenancies;
        this.fees = fees;
        this.gateway = gateway;
        this.mapper = mapper;
    }

    /** Contract {@code myRentPayments} — what the caller has paid or owes, as tenant. */
    @Transactional(readOnly = true)
    public Page<RentPaymentDto> myRentPayments(UUID callerId, Pageable pageable) {
        return payments.findByTenantId(callerId, pageable).map(mapper::toDto);
    }

    /** Contract {@code rentLedger} — what the caller has been paid, as owner. */
    @Transactional(readOnly = true)
    public Page<RentPaymentDto> rentLedger(UUID callerId, Pageable pageable) {
        return payments.findByOwnerId(callerId, pageable).map(mapper::toDto);
    }

    /**
     * Contract {@code payRent} — initiate a rent payment. Returns the row as <strong>pending</strong>.
     *
     * <p>Order of operations matters and is deliberate:
     * <ol>
     *   <li>Resolve the tenancy and check the caller is its tenant — 404 otherwise. This comes
     *       first so that everything after it is already scoped to a caller who belongs here.</li>
     *   <li>Replay the idempotency key <em>within that tenancy</em>, before any further validation,
     *       so a retry of a request that succeeded returns the original payment rather than a 409
     *       about a duplicate month. Scoping the replay to the tenancy is what stops one tenant
     *       reading another's payment by presenting their key.</li>
     *   <li>Derive the amount, then check {@code expectedAmount} against it.</li>
     *   <li>Refuse a month that is already settled or in flight.</li>
     *   <li>Only then call the gateway, so a rejected request never creates an order.</li>
     * </ol>
     *
     * @param idempotencyKey the client's {@code Idempotency-Key} header, may be null
     */
    @Transactional
    public RentPaymentDto payRent(UUID callerId, RentPaymentCreateRequest body,
            String idempotencyKey) {

        Tenancy tenancy = tenantTenancy(callerId, parseTenancyId(body.tenancyId()));

        String key = blankToNull(idempotencyKey);
        if (key != null) {
            Optional<RentPayment> replayed =
                    payments.findByTenancyIdAndIdempotencyKey(tenancy.getId(), key);
            if (replayed.isPresent()) {
                // why: the tenant tapped Pay twice, or their connection dropped and the client
                // retried. Returning the original is the whole point of the header - creating a
                // second payment here is a real double charge.
                return mapper.toDto(replayed.get());
            }
        }

        Long rent = tenancy.getRent();
        if (rent == null || rent <= 0) {
            // why 409, not 400: the request is perfectly well-formed. It conflicts with the state of
            // the tenancy, which is what 409 is for (api-standards §3). Better a clear conflict than
            // billing zero and recording a settled month.
            throw new ConflictException(
                    "This tenancy has no rent on record; ask the owner to set it before paying");
        }
        if (body.expectedAmount() != null && !body.expectedAmount().equals(rent)) {
            // why 409: this is optimistic concurrency. The client is confirming a figure it read
            // earlier and the figure has since moved - the same shape as a stale ETag, and the same
            // status code. Rejecting it is the entire point of the field.
            throw new ConflictException("Rent is now " + rent
                    + "; refresh and confirm the new amount before paying");
        }

        String method = requirePayableMethod(body.method());
        LocalDate dueDate = LocalDate.now().withDayOfMonth(1);
        if (payments.existsLiveForDueDate(tenancy.getId(), dueDate)) {
            throw new ConflictException("Rent for this month is already paid or in progress");
        }

        RentFeeCalculator.Breakdown breakdown = fees.compute(rent);
        PaymentGateway.PaymentOrder order = gateway.createOrder(
                breakdown.total(), "rent:" + tenancy.getId() + ":" + dueDate);

        if (order.orderId() == null || order.orderId().isBlank()) {
            // why: `reference` is how the webhook finds this row again. A payment stored without
            // one can never be settled - the callback would arrive, match nothing, and the tenant
            // would sit at "due" having actually been charged. Failing here, before anything is
            // persisted, is the only outcome that does not strand money.
            throw new IllegalStateException("Payment gateway returned no order id");
        }

        RentPayment payment = new RentPayment(tenancy.getId(), breakdown.amount(),
                breakdown.platformFee(), breakdown.gst(), dueDate, method, order.orderId(), key);
        try {
            return mapper.toDto(payments.saveAndFlush(payment));
        } catch (DataIntegrityViolationException raced) {
            // why: the check above is not a guard, it is a courtesy. Two taps on a flaky connection
            // both pass it before either commits, and only V14's partial unique index settles the
            // argument. Without this the loser of the race gets a 500 for behaving correctly.
            throw new ConflictException("Rent for this month is already paid or in progress");
        }
    }

    /**
     * Apply a terminal outcome from the payment webhook.
     *
     * <p>Package-private-by-intent through the controller only: this is the one path that may write
     * {@link RentPaymentStatuses#PAID}, and it is reachable only after an HMAC check.
     *
     * <p><strong>An unknown order id is not an error.</strong> Cashfree also sends callbacks for
     * orders this table never created (a boost, a subscription, a test from their dashboard), and
     * treating those as failures would mean retries forever for events that are not ours.
     *
     * @param orderId       the provider's order id, matched against {@code reference}
     * @param nextStatus    {@link RentPaymentStatuses#PAID} or {@link RentPaymentStatuses#FAILED}
     * @param settledOn     settlement date; ignored unless paid
     * @param failureReason provider reason; ignored unless failed
     * @param providerAmount what the provider says was charged, whole rupees, or {@code 0} if it
     *                       sent none — checked against our own figure, never written over it
     */
    @Transactional
    public void applyWebhookOutcome(String orderId, String nextStatus, LocalDate settledOn,
            String failureReason, long providerAmount) {
        if (orderId == null || orderId.isBlank()) {
            return;
        }
        Optional<RentPayment> found = payments.findByReference(orderId);
        if (found.isEmpty()) {
            log.info("Payment callback for order {} matched no rent payment; ignoring", orderId);
            return;
        }
        RentPayment payment = found.get();
        if (!payment.settle(nextStatus, settledOn, failureReason)) {
            // why: a redelivered callback on an already-terminal payment. Expected, not an error -
            // but worth a line, because a *contradictory* redelivery is worth noticing.
            log.info("Ignored {} callback for order {}: payment is already {}",
                    nextStatus, orderId, payment.getStatus());
            return;
        }

        // Reconciliation, not enforcement. If the provider charged something other than what we
        // billed, that is a misconfiguration or a tampered order and somebody must look at it --
        // but the money has already moved, so refusing to record it would leave a tenant who has
        // genuinely paid showing as unpaid. Record, then shout.
        long billed = payment.getAmount() + payment.getPlatformFee() + payment.getGst();
        if (providerAmount > 0 && providerAmount != billed) {
            log.error("Amount mismatch on rent payment {}: billed {} but provider charged {}",
                    payment.getId(), billed, providerAmount);
        }
        log.info("Rent payment {} moved to {} by provider callback", payment.getId(), nextStatus);
    }

    /**
     * Contract {@code getMandate} — the caller's autopay mandate.
     *
     * <p><strong>The endpoint is singular but a tenant can hold two tenancies.</strong> The contract
     * has no way to express "which one", so this returns the most recently created active mandate.
     * Recording the ruling rather than hiding it: the alternative — returning an arbitrary one —
     * would show a tenant a ceiling and a day-of-month belonging to a different flat, which is
     * worse than showing them their newest. If multi-tenancy autopay becomes real, the fix is a
     * spec change to {@code /me/rent-mandates}, not a heuristic here.
     */
    @Transactional(readOnly = true)
    public RentMandateDto getMandate(UUID callerId) {
        return mandates.findLiveByTenantId(callerId).stream()
                .findFirst()
                .map(mapper::toDto)
                .orElseGet(RentMandateDto::none);
    }

    /**
     * Contract {@code setMandate} — create, amend, pause, resume or revoke autopay (spec fix S22).
     *
     * <p>Creating always produces an {@code active} mandate. After that, {@code status} moves it
     * around the small state machine in {@link MandateStatuses}:
     *
     * <p><strong>Pause is reversible; revoke is not.</strong> The two are not degrees of the same
     * thing. Pausing is the platform declining to debit an instruction the bank still holds — a
     * tenant between jobs skipping a month — so resuming it is not new consent to anything, the
     * ceiling and the day are unchanged. Revoking withdraws the instruction itself, and reviving
     * that <em>would</em> be charging an account on consent the tenant took back. Collapsing the
     * two would make "pause" a one-way door disguised as a toggle: strictly worse than useless,
     * because a tenant would tap it expecting to resume and find they could not.
     */
    @Transactional
    public RentMandateDto setMandate(UUID callerId, RentMandateUpdateRequest body) {
        Tenancy tenancy = tenantTenancy(callerId, parseTenancyId(body.tenancyId()));
        Optional<RentMandate> existing = mandates.findLiveByTenancyId(tenancy.getId());

        if (existing.isEmpty()) {
            if (body.status() != null) {
                // why 404: the caller is trying to pause or revoke a mandate that is not there.
                // Silently creating an active mandate in response to "pause" would be the exact
                // opposite of the intent, and 404 is what the contract declares for this path.
                throw new NotFoundException("No active autopay mandate to update");
            }
            RentMandate created = new RentMandate(
                    tenancy.getId(), body.maxAmount(), body.dayOfMonth(), MANDATE_PROVIDER);
            try {
                return mapper.toDto(mandates.saveAndFlush(created));
            } catch (DataIntegrityViolationException raced) {
                // Same race as payRent, worse consequence: two standing instructions against one
                // rent means the tenant is debited twice every month until somebody notices.
                throw new ConflictException("Autopay is already set up on this tenancy");
            }
        }

        RentMandate mandate = existing.get();
        if (body.maxAmount() != null) {
            mandate.setMaxAmount(body.maxAmount());
        }
        if (body.dayOfMonth() != null) {
            mandate.setDayOfMonth(body.dayOfMonth());
        }
        if (body.status() != null) {
            String next = body.status();
            if (!MandateStatuses.isValid(next)) {
                // Unknown vocabulary value: the caller's bug, not a state conflict.
                throw new BadRequestException("status must be one of: "
                        + MandateStatuses.settableList());
            }
            if (!MandateStatuses.canTransition(mandate.getStatus(), next)) {
                // Covers revive-from-revoked and no-op self-transitions alike. 409 rather than 422:
                // the payload is fine, it is the mandate's current state that refuses it.
                throw new ConflictException(
                        "Cannot change an autopay mandate from " + mandate.getStatus()
                                + " to " + next);
            }
            mandate.setStatus(next);
        }
        return mapper.toDto(mandate);
    }

    /**
     * Contract {@code getPayoutAccount} — where the caller's rent is settled.
     *
     * <p>Empty shape rather than 404 when unset (D5): the client renders a blank form either way.
     */
    @Transactional(readOnly = true)
    public PayoutAccountDto getPayoutAccount(UUID callerId) {
        return payoutAccounts.findByOwnerId(callerId)
                .map(mapper::toDto)
                .orElseGet(PayoutAccountDto::none);
    }

    /**
     * Contract {@code setPayoutAccount} — link or replace the caller's payout destination.
     *
     * <p><strong>PUT replaces, it does not merge.</strong> An owner switching from a bank account
     * to a UPI id must not be left with a stale IFSC pointing at the old one — a payout destination
     * assembled from two different submissions is a payout to nowhere.
     *
     * <p>The full account number is masked on the way in and the original is never persisted; see
     * {@link PayoutAccount}.
     */
    @Transactional
    public PayoutAccountDto setPayoutAccount(UUID callerId, PayoutAccountUpdateRequest body) {
        boolean hasBank = body.accountNumber() != null && !body.accountNumber().isBlank();
        boolean hasUpi = body.upiId() != null && !body.upiId().isBlank();
        if (!hasBank && !hasUpi) {
            throw new BadRequestException("Provide either an account number with IFSC, or a UPI id");
        }
        if (hasBank && hasUpi) {
            // why: "either/or" has to mean it. A row carrying both a bank account and a UPI id
            // gives the payout rail two destinations and no rule for choosing, so the money lands
            // wherever the implementation happens to look first - and the owner has no way to tell
            // which they configured. Making them pick is the only unambiguous answer.
            throw new BadRequestException(
                    "Provide either an account number with IFSC, or a UPI id — not both");
        }
        if (hasBank && (body.ifsc() == null || body.ifsc().isBlank())) {
            throw new BadRequestException("IFSC is required with an account number");
        }

        PayoutAccount account = payoutAccounts.findByOwnerId(callerId)
                .orElseGet(() -> new PayoutAccount(callerId));
        account.setAccountHolder(body.accountHolder().trim());
        account.setMaskedAccount(hasBank ? mask(body.accountNumber()) : null);
        account.setIfsc(hasBank ? body.ifsc() : null);
        account.setUpiId(hasUpi ? body.upiId().trim() : null);
        // why: changing where money goes invalidates any previous penny-drop. Carrying `verified`
        // across a change would mark an unverified account as checked.
        account.setVerified(false);
        return mapper.toDto(payoutAccounts.save(account));
    }

    /**
     * The caller's tenancy, or 404.
     *
     * <p>Not-found and not-yours are the same answer on purpose: distinguishing them tells a prober
     * which tenancy ids are real.
     */
    private Tenancy tenantTenancy(UUID callerId, UUID tenancyId) {
        return tenancies.findById(tenancyId)
                .filter(t -> callerId.equals(t.getTenantId()))
                .orElseThrow(() -> NotFoundException.of("Tenancy"));
    }

    /** A malformed tenancy id is 404 for the same reason a stranger's is. */
    private static UUID parseTenancyId(String token) {
        return Ids.parseUuid(token).orElseThrow(() -> NotFoundException.of("Tenancy"));
    }

    /** Defaults to UPI, which is what all but a handful of Indian tenants will use. */
    private static String requirePayableMethod(String method) {
        if (method == null || method.isBlank()) {
            return PaymentMethods.UPI;
        }
        if (!PaymentMethods.isPayable(method)) {
            throw new BadRequestException(
                    "method must be one of: " + PaymentMethods.payableList());
        }
        return method;
    }

    /**
     * Keeps the last {@value #VISIBLE_ACCOUNT_DIGITS} digits and replaces the rest with {@code X},
     * matching the contract's {@code XXXXXX7890} example.
     *
     * <p>Four digits is the standard tail on an Indian bank statement, which is the point: the
     * owner needs to recognise their own account, and nobody else needs to reconstruct it.
     */
    private static String mask(String accountNumber) {
        String digits = accountNumber.trim();
        if (digits.length() <= VISIBLE_ACCOUNT_DIGITS) {
            // Unreachable through the API - the request pattern demands 9-18 digits - but a masking
            // function whose fallback is "return the input unmasked" is the wrong shape to leave
            // lying around for the next caller who arrives from somewhere other than a controller.
            return "X".repeat(VISIBLE_ACCOUNT_DIGITS);
        }
        int hidden = digits.length() - VISIBLE_ACCOUNT_DIGITS;
        return "X".repeat(hidden) + digits.substring(hidden);
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
