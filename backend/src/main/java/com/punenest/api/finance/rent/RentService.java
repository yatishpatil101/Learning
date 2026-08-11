package com.punenest.api.finance.rent;

import com.punenest.api.common.PlatformTime;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.payments.AbandonedCheckouts;
import com.punenest.api.common.persistence.ConstraintViolations;
import com.punenest.api.common.web.Ids;
import com.punenest.api.finance.tenancy.Tenancy;
import com.punenest.api.finance.tenancy.TenancyRepository;
import com.punenest.api.provider.PaymentGateway;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Limit;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

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
 *
 * <p><strong>The rent month is reckoned in {@link PlatformTime#IST}, never in the JVM default</strong>
 * (tech debt D179, the same class of bug as D174 in {@code FinanceService}). {@link #open} anchors a
 * payment on the 1st of the current month, and on a UTC host the JVM is still on yesterday's date
 * for the first 5.5 hours of every Indian day. Between 00:00 and 05:29 IST on the 1st that answers
 * the previous month, so a tenant paying early on the 1st would settle the month they had already
 * paid — colliding with V14's {@code uq_rent_payments_live_per_due_date} and being told their rent
 * was "already paid or in progress" — while the month actually falling due stayed open. The zone is
 * applied at the use site rather than baked into {@link #clock}, so pinning the clock in a test
 * proves this service chooses IST rather than proving the test did.
 */
@Service
public class RentService implements AbandonedCheckouts {

    private static final Logger log = LoggerFactory.getLogger(RentService.class);

    /**
     * The rail a mandate is registered with. Recorded on the row so that when a second provider is
     * added, existing mandates are still attributable — a null provider on a live standing
     * instruction is an instruction nobody can cancel.
     */
    private static final String MANDATE_PROVIDER = "cashfree";

    /** How many trailing digits of an account number survive masking. */
    private static final int VISIBLE_ACCOUNT_DIGITS = 4;

    /**
     * V14's partial unique index over one live payment per tenancy per month. Named here so the
     * catch block in {@link #open} can tell its own collision apart from every other integrity
     * failure the same insert can raise (D170).
     */
    private static final String LIVE_PER_DUE_DATE_INDEX = "uq_rent_payments_live_per_due_date";

    /**
     * V14's partial unique index over one non-revoked mandate per tenancy. Same job as
     * {@link #LIVE_PER_DUE_DATE_INDEX} for {@link #setMandate}.
     */
    private static final String ACTIVE_MANDATE_INDEX = "uq_rent_mandates_active_per_tenancy";

    /**
     * What a tenant is told when the checkout could not be opened (D148).
     *
     * <p>Written for the person reading their own ledger, and deliberately distinguishable from a
     * decline: the money never moved and retrying is the right thing to do.
     */
    private static final String CHECKOUT_UNAVAILABLE =
            "We could not open the payment page. Nothing was charged — please try again.";

    /**
     * What a tenant is told when they opened a checkout and never came back (D161).
     *
     * <p>Deliberately different wording from {@link #CHECKOUT_UNAVAILABLE}: that one is our failure
     * and "try again" is an apology, this one is the tenant's own abandoned session and the useful
     * message is that the month is free to pay again. Neither says "declined", because no bank ever
     * saw it — a ledger that cannot distinguish those three is a ledger support cannot work from.
     */
    private static final String CHECKOUT_EXPIRED =
            "This payment was not completed in time and the checkout expired. Nothing was charged — "
                    + "you can pay this month's rent again.";

    private final RentPaymentRepository payments;
    private final RentMandateRepository mandates;
    private final PayoutAccountRepository payoutAccounts;
    private final TenancyRepository tenancies;
    private final RentFeeCalculator fees;
    private final PaymentGateway gateway;
    private final RentMapper mapper;

    /** Runs the two short transactions {@link #payRent} is built from — see the field it mirrors on
     * {@code SubscriptionService} for why the template is built here and why propagation is left at
     * {@code REQUIRED}. */
    private final TransactionTemplate transactions;

    /**
     * The instant the rent month is derived from — a seam, not a configuration knob.
     *
     * <p>Deliberately <em>zone-agnostic</em>, mirroring {@code FinanceService#clock}: it answers
     * "what instant is it", and {@link #todayIst()} decides which calendar that instant falls on. A
     * test therefore pins it to a UTC-zoned {@link Clock#fixed} — the host configuration that causes
     * the bug — and the IST answer it gets back is this service's doing.
     *
     * <p>Not constructor-injected because there is no {@code Clock} bean in this application and
     * adding one to satisfy a single test would put a new global in everyone's context. Not final
     * only so {@link #useClock} can reach it; nothing in production ever calls that.
     */
    private Clock clock = Clock.systemUTC();

    public RentService(RentPaymentRepository payments, RentMandateRepository mandates,
            PayoutAccountRepository payoutAccounts, TenancyRepository tenancies,
            RentFeeCalculator fees, PaymentGateway gateway, RentMapper mapper,
            PlatformTransactionManager transactionManager) {
        this.payments = payments;
        this.mandates = mandates;
        this.payoutAccounts = payoutAccounts;
        this.tenancies = tenancies;
        this.fees = fees;
        this.gateway = gateway;
        this.mapper = mapper;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    /**
     * Pin the instant this service believes it is. <strong>Tests only</strong> — package-private so
     * nothing outside {@code finance.rent} can reach it, and so a caller that finds it has to be
     * sitting next to the javadoc saying not to.
     *
     * <p>This bean is proxied for {@code @Transactional}, so a test must unwrap the target with
     * {@code AopTestUtils.getTargetObject} before calling this, and must restore the system clock
     * afterwards — the bean outlives the test that borrowed it.
     *
     * @param pinned the clock to read instants from, or {@code null} to restore the system clock
     */
    void useClock(Clock pinned) {
        this.clock = pinned == null ? Clock.systemUTC() : pinned;
    }

    /** Today's date <em>in India</em>, whatever timezone this process was started in. */
    private LocalDate todayIst() {
        return LocalDate.now(clock.withZone(PlatformTime.IST));
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
     *   <li>Persist the payment as {@code due} and <strong>commit it</strong>, so that every reason
     *       to refuse has been exhausted before any order exists.</li>
     *   <li>Only then call the gateway, and attach the order id in a second transaction.</li>
     * </ol>
     *
     * <p><strong>Steps 5 and 6 used to be one step, in the wrong order</strong> (D148): the order
     * was opened inside the transaction that persisted the payment, so the duplicate-month index
     * firing on commit rolled the row away and left a live, payable Cashfree order behind it. The
     * tenant could then pay an order that matched no payment row. Committing first means the worst
     * case is a row with no order, which {@link #abandon} can and does clean up.
     *
     * <p>Deliberately not {@code @Transactional} for that reason — the boundaries are inside.
     *
     * @param idempotencyKey the client's {@code Idempotency-Key} header, may be null
     */
    public RentPaymentDto payRent(UUID callerId, RentPaymentCreateRequest body,
            String idempotencyKey) {
        String key = blankToNull(idempotencyKey);
        Opened opened = transactions.execute(tx -> open(callerId, body, key));

        if (opened.settled() != null) {
            // An idempotent replay: the original payment already has its order.
            return opened.settled();
        }

        PaymentGateway.PaymentOrder order;
        try {
            order = createOrder(opened);
            return transactions.execute(tx -> attach(opened.paymentId(), order));
        } catch (RuntimeException checkoutFailed) {
            // The attach is inside the guard, not only the gateway call. Rent is the worst place to
            // strand a row: a payment left at 'due' holds the month in
            // uq_rent_payments_live_per_due_date, so the tenant is refused with "already paid or in
            // progress" even on a fresh idempotency key, and cannot pay that month by any route.
            abandon(opened);
            throw checkoutFailed;
        }
    }

    /**
     * First transaction: run every check in the order documented above, then commit the payment as
     * {@code due} with no order against it yet.
     */
    private Opened open(UUID callerId, RentPaymentCreateRequest body, String key) {
        Tenancy tenancy = tenantTenancy(callerId, parseTenancyId(body.tenancyId()));

        if (key != null) {
            Optional<RentPayment> replayed =
                    payments.findByTenancyIdAndIdempotencyKey(tenancy.getId(), key);
            if (replayed.isPresent()) {
                // why: the tenant tapped Pay twice, or their connection dropped and the client
                // retried. Returning the original is the whole point of the header - creating a
                // second payment here is a real double charge.
                return Opened.settled(mapper.toDto(replayed.get()));
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
        LocalDate dueDate = todayIst().withDayOfMonth(1);
        if (payments.existsLiveForDueDate(tenancy.getId(), dueDate)) {
            throw new ConflictException("Rent for this month is already paid or in progress");
        }

        RentFeeCalculator.Breakdown breakdown = fees.compute(rent);
        RentPayment payment = new RentPayment(tenancy.getId(), breakdown.amount(),
                breakdown.platformFee(), breakdown.gst(), dueDate, method, key);
        RentPayment saved;
        try {
            saved = payments.saveAndFlush(payment);
        } catch (DataIntegrityViolationException raced) {
            // why: the check above is not a guard, it is a courtesy. Two taps on a flaky connection
            // both pass it before either commits, and only V14's partial unique index settles the
            // argument. Without this the loser of the race gets a 500 for behaving correctly.
            //
            // Only that index is translated (D170). The same insert can trip a foreign key on
            // tenancy_id or a not-null, and answering one of those with "already paid or in
            // progress" would dress a defect up as the system working — the tenant retries, the
            // retry fails identically, and nothing ever reaches the error log. Anything else goes
            // up untouched and becomes a 500.
            if (!ConstraintViolations.isOn(raced, LIVE_PER_DUE_DATE_INDEX)) {
                throw raced;
            }
            log.info("Concurrent rent payment lost the duplicate-month race for tenancy {} on {}",
                    tenancy.getId(), dueDate);
            throw new ConflictException("Rent for this month is already paid or in progress");
        }
        return new Opened(null, saved.getId(), breakdown.total(),
                "rent:" + tenancy.getId() + ":" + dueDate);
    }

    /**
     * Second transaction: record the order the committed payment is waiting on.
     *
     * <p>Nothing deletes rent payments, so a row missing here is an unmodelled concurrent write and
     * is raised rather than swallowed — returning a checkout that settles against nothing is how a
     * tenant ends up charged and still showing as unpaid.
     */
    private RentPaymentDto attach(UUID paymentId, PaymentGateway.PaymentOrder order) {
        RentPayment payment = payments.findById(paymentId)
                .orElseThrow(() -> new IllegalStateException("Rent payment " + paymentId
                        + " disappeared before gateway order " + order.orderId()
                        + " could be attached"));
        if (!payment.attachOrder(order.orderId())) {
            log.error("Rent payment {} would not take gateway order {}; it is {} with reference {}",
                    paymentId, order.orderId(), payment.getStatus(), payment.getReference());
        }
        // The session id is single-use and lives only in this response: the checkout SDK consumes
        // it, and the payment webhook - not any stored id - is what later settles the month (D167).
        return mapper.toDto(payments.saveAndFlush(payment))
                .withPaymentSessionId(order.paymentSessionId());
    }

    /**
     * Open the gateway order for a committed payment. Called with no transaction open (D148).
     *
     * <p>A blank order id is a refusal: {@code reference} is how the webhook finds this row again, so
     * a payment left without one could never be settled — the callback would arrive, match nothing,
     * and a tenant who had actually been charged would sit at {@code due} forever.
     */
    private PaymentGateway.PaymentOrder createOrder(Opened opened) {
        PaymentGateway.PaymentOrder order =
                gateway.createOrder(opened.total(), opened.reference());
        if (order.orderId() == null || order.orderId().isBlank()) {
            throw new IllegalStateException("Payment gateway returned no order id");
        }
        return order;
    }

    /**
     * Compensating write for a gateway that refused the order after the payment was committed
     * (D148).
     *
     * <p>The row must not be left {@code due}. {@code due} occupies the month in
     * {@code uq_rent_payments_live_per_due_date} and in {@link RentPaymentRepository#existsLiveForDueDate},
     * so a payment that can never be paid would block that tenancy's rent for that month
     * permanently — a far worse outcome than the one being fixed. {@code failed} is excluded from
     * both, which frees the month, and it carries a reason the tenant can read in their ledger.
     *
     * <p>A failure to compensate is logged and swallowed: the caller needs the gateway's error, not
     * a bookkeeping one.
     */
    private void abandon(Opened opened) {
        try {
            transactions.executeWithoutResult(tx -> payments.findById(opened.paymentId())
                    .ifPresent(payment -> payment.abandonUnopened(CHECKOUT_UNAVAILABLE)));
            log.error("No gateway order for rent payment {} ({}); failed it and released the "
                    + "idempotency key. Nothing was charged.",
                    opened.paymentId(), opened.reference());
        } catch (RuntimeException compensationFailed) {
            log.error("Could not fail rent payment {} after its gateway order failed; it will hold "
                    + "this month open at 'due' and block the tenant's retry",
                    opened.paymentId(), compensationFailed);
        }
    }

    /**
     * What survives the first transaction: a finished response, or plain values describing the order
     * to open. No entity crosses a transaction boundary.
     */
    private record Opened(RentPaymentDto settled, UUID paymentId, long total, String reference) {

        static Opened settled(RentPaymentDto dto) {
            return new Opened(dto, null, 0, null);
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
     * @return whether this table owned the order — the fan-out alerts on a paid event nobody claims
     */
    @Transactional
    public boolean applyWebhookOutcome(String orderId, String nextStatus, LocalDate settledOn,
            String failureReason, long providerAmount) {
        if (orderId == null || orderId.isBlank()) {
            return false;
        }
        Optional<RentPayment> found = payments.findByReference(orderId);
        if (found.isEmpty()) {
            log.info("Payment callback for order {} matched no rent payment; ignoring", orderId);
            return false;
        }
        RentPayment payment = found.get();

        // Reconciliation, not enforcement. If the provider charged something other than what we
        // billed, that is a misconfiguration or a tampered order and somebody must look at it --
        // but the money has already moved, so refusing to record it would leave a tenant who has
        // genuinely paid showing as unpaid. Checked before the idempotence guard below, not after:
        // a *contradictory redelivery* -- the same order coming back with a different amount -- is
        // the case most worth noticing, and it is exactly the one the guard returns early on.
        long billed = payment.getAmount() + payment.getPlatformFee() + payment.getGst();
        if (providerAmount > 0 && providerAmount != billed) {
            log.error("Amount mismatch on rent payment {}: billed {} but provider charged {}",
                    payment.getId(), billed, providerAmount);
        }

        if (!payment.settle(nextStatus, settledOn, failureReason)) {
            reportRefusedSettlement(payment, nextStatus, orderId);
            return true;
        }
        log.info("Rent payment {} moved to {} by provider callback", payment.getId(), nextStatus);
        return true;
    }

    /**
     * Say what it means that a callback could not be applied — and say it at the right volume.
     *
     * <p><strong>Why this stopped being one log line (D161).</strong> Until the abandoned-checkout
     * sweep existed, a rent payment reached a terminal status only through this method, so a refused
     * transition was always a redelivered callback: harmless, and correctly INFO. The sweep adds a
     * second route to {@code failed}, and it frees the month deliberately — which is right for the
     * tenant who walked away, and wrong for the one whose money lands afterwards. That tenant may by
     * then have paid the month a second time, so this is the one branch in the file that can mean a
     * double charge. It must not read like routine noise.
     *
     * <p>Only a {@code paid} callback is escalated. A redelivered {@code failed} on an already-failed
     * row moved no money and stays INFO.
     */
    private void reportRefusedSettlement(RentPayment payment, String nextStatus, String orderId) {
        if (!RentPaymentStatuses.PAID.equals(nextStatus)) {
            log.info("Ignored {} callback for order {}: payment is already {}",
                    nextStatus, orderId, payment.getStatus());
            return;
        }
        if (RentPaymentStatuses.PAID.equals(payment.getStatus())) {
            log.info("Ignored paid callback for order {}: payment is already paid", orderId);
            return;
        }
        log.error("Rent payment {} was settled by the gateway but is {} — the tenant has been "
                + "charged for {} and the month still reads unpaid, so they may have paid it "
                + "twice. Gateway order {}, tenancy {}. Refund or reconcile.", payment.getId(),
                payment.getStatus(), payment.getDueDate(), orderId, payment.getTenancyId());
    }

    /** {@inheritDoc} — "rent payment", so a sweep log line names the table that moved. */
    @Override
    public String family() {
        return "rent payment";
    }

    /**
     * Fail every checkout that was opened and then walked away from (D161). Driven by
     * {@code AbandonedCheckoutSweep}.
     *
     * <p><strong>Rent is the worst place to strand a row, which is why this matters most here.</strong>
     * A payment left at {@code due} occupies the month in
     * {@code uq_rent_payments_live_per_due_date} and in {@link RentPaymentRepository#existsLiveForDueDate},
     * so the tenant is refused with "already paid or in progress" and cannot pay that month by any
     * route — not with a fresh idempotency key, not from a different device. {@link #abandon}
     * already handles a gateway that refuses the order, but it runs in this process: a hard kill
     * between the commit and the gateway call, or a tenant simply closing the checkout (which
     * generates no webhook), leaves the row with nothing to clear it. Before this sweep, that meant
     * a permanently unpayable month.
     *
     * <p><strong>Only an abandoned checkout can be in this set.</strong> Nothing but {@link #payRent}
     * creates a rent payment, and it creates one only when a tenant has asked to pay — there is no
     * scheduled biller stamping {@code due} rows for months nobody has started. So "still
     * {@code due} well past the TTL" means an abandoned session, never an unpaid month, and the
     * sweep cannot silently write off rent somebody owes.
     *
     * <p><strong>Nothing paid is ever touched.</strong> A settled payment is {@code paid} and a
     * refused one {@code failed}, so a row still {@code due} is one no money has arrived for.
     * {@link RentPayment#abandonCheckout} re-checks that per row, and {@code @Version} settles the
     * last instant of the race against a webhook landing mid-sweep.
     *
     * @param cutoff payments created before this instant have run out of checkout time; passed in so
     *               tests need not wait on a clock
     * @return how many payments this call actually failed
     */
    @Override
    @Transactional
    public int expireAbandonedCheckouts(Instant cutoff) {
        List<RentPayment> stale = payments.findByStatusAndCreatedAtBeforeOrderByCreatedAtAsc(
                RentPaymentStatuses.DUE, cutoff, Limit.of(MAX_PER_SWEEP));
        int expired = 0;
        for (RentPayment payment : stale) {
            if (payment.abandonCheckout(CHECKOUT_EXPIRED)) {
                expired++;
                log.info("Rent payment {} failed: its checkout was opened at {} and never paid; "
                        + "{} is free to pay again",
                        payment.getId(), payment.getCreatedAt(), payment.getDueDate());
            }
        }
        return expired;
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
                //
                // And the same rule about which violation this is (D170): only the mandate index is
                // a real conflict. A bad tenancy_id or a missing column here would otherwise be
                // reported as "autopay is already set up", which is both wrong and unfalsifiable
                // from the tenant's side — they can see they have no mandate.
                if (!ConstraintViolations.isOn(raced, ACTIVE_MANDATE_INDEX)) {
                    throw raced;
                }
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
