package com.draazy.api.services.request;

import com.draazy.api.catalog.fee.LeaveAndLicenceCharges;
import com.draazy.api.catalog.fee.PlatformFee;
import com.draazy.api.catalog.fee.PlatformFeeRepository;
import com.draazy.api.common.error.ValidationException;
import java.util.Locale;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * What a service desk charges — the one use case that turns a wizard's {@code details} into money.
 *
 * <p>Lifted out of {@link ServiceRequestService}, which files, prices, charges, narrates and
 * expires a request and had grown past the point where those read as one thing. Pricing is the
 * cleanest of the five to separate because it is the only one that touches no request row: it is a
 * pure function of a desk name and a free-form details map, answering rupees. Nothing here reads or
 * writes {@code service_requests}, so nothing here can be got wrong by a transaction boundary.
 *
 * <p>It is a use case rather than a helper (package-structure.md §4.1). "What does this desk cost"
 * is a question the business asks in its own right — the wizard's sidebar asks it before a request
 * exists at all — and the answer is regulated: Art. 36A stamp duty and the registration fee are
 * statute, not configuration. A {@code ServiceRequestServiceHelper} holding the same code would
 * still have to be read alongside its parent to know when the charge applies; this does not.
 */
@Service
public class ServiceRequestPricing {

    private static final Logger log = LoggerFactory.getLogger(ServiceRequestPricing.class);

    /** The published fee breakdown a rent agreement is priced from ({@code platform_fees.deal}). */
    private static final String RENT_FEE_DEAL = "rent";

    /**
     * The term assumed when a rent agreement states a rent but no months (D163).
     *
     * <p>Eleven, because that is the wizard's own default and the overwhelmingly common Indian
     * tenancy — written to eleven months precisely so it falls outside rent-control registration.
     * The number is mirrored by {@code useRentAgreement.js} ({@code parseInt(terms.months, 10) ||
     * 11}); the two must agree or the sidebar's estimate and the charge diverge, which is exactly
     * what D150 closed.
     */
    private static final int DEFAULT_TERM_MONTHS = 11;

    private final PlatformFeeRepository fees;

    public ServiceRequestPricing(PlatformFeeRepository fees) {
        this.fees = fees;
    }

    /**
     * The up-front charge for a service desk, or {@code null} when the desk is free.
     *
     * <p>A rent agreement (Leave &amp; License) is the one desk that charges before ops touches it;
     * every other desk in {@link ServiceRequestTypes} is free and enters the queue immediately. It is
     * priced from the published {@code rent} fee breakdown — platform fee plus GST — plus the
     * statutory charges the state levies on the document. Brokerage is excluded: it is the cost of a
     * property deal, not of drawing up the agreement. GST is charged on the platform fee alone and is
     * already the seeded figure, because stamp duty and registration are taxes, not supplies, and
     * nothing is levied on top of them.
     *
     * <p><strong>The statutory half is computed, not published (D163).</strong> Until now this summed
     * four columns, and two of them were seeded zero — so the platform billed {@code 1999 + 0 + 0 +
     * GST} for a document that legally attracts Art. 36A stamp duty and a registration fee, and would
     * have had to remit the difference out of margin on every agreement. They were seeded zero
     * because there is no correct flat value: the duty is 0.25% of a consideration built from the
     * rent, the term and the deposit. The published row now says so by publishing {@code null}
     * (V52), and {@link LeaveAndLicenceCharges} produces the real figure from this request's own
     * terms.
     *
     * <p><strong>The wizard's sidebar has the same formula but does not yet see the null</strong> —
     * {@code providers/http/feesProvider.js} still coerces it to {@code 0} — so until that one line
     * changes the estimate on screen under-states this charge. V52's header carries the exact edit.
     * That is a release-ordering constraint, not a licence to leave the bill wrong: D150's invariant
     * is that the two agree, and they will once the coercion goes.
     *
     * <p><strong>When the terms are absent, nothing is invented.</strong> A request that carries no
     * rent is not a wizard submission and cannot be taxed: pricing it from a zero rent would produce
     * a confident ₹0 of duty, and a wrong statutory number is worse than an absent one. Such a
     * request is charged the platform fee, GST and whatever the published row does state — which for
     * {@code rent} is nothing — exactly as it was before this change. It is logged, because ops
     * cannot produce the document from it either.
     *
     * <p>Because the price is decided by matching a string, the type it is matched against has to be
     * a closed set — see {@link ServiceRequestTypes} for why free text made the gate optional.
     */
    public Long priceFor(String type, Map<String, Object> details) {
        if (!ServiceRequestTypes.RENT_AGREEMENT.equals(type)) {
            return null;
        }
        PlatformFee published = fees.findById(RENT_FEE_DEAL)
                .orElseThrow(() -> new IllegalStateException(
                        "Missing platform fee row for deal " + RENT_FEE_DEAL));
        long price = published.getPlatformFee() + published.getGst();
        LeaveAndLicenceCharges.Terms terms = leaveAndLicenceTerms(details);
        if (terms != null) {
            return price + LeaveAndLicenceCharges.on(terms).total();
        }
        log.warn("Rent agreement raised without terms; statutory charges cannot be computed and are "
                + "billed only if the published schedule states them");
        return price + orZero(published.getStampDuty()) + orZero(published.getRegistration());
    }

    /** A published fee line that is absent contributes nothing — see {@link PlatformFee}. */
    private static long orZero(Long publishedLine) {
        return publishedLine == null ? 0L : publishedLine;
    }

    /**
     * The leave-and-licence terms this request is taxed on, or {@code null} when it states none.
     *
     * <p>Read out of the free-form {@code details} object the wizard posts, which carries the terms
     * twice: flattened at the top level ({@code rent}, {@code deposit}, {@code months},
     * {@code regArea}) for ops to read, and verbatim inside {@code _state.terms} for co-fill and
     * resume. Both are consulted, top level first, because the flattened copy omits the
     * non-refundable deposit and the {@code _state} copy is the only place it exists.
     *
     * <p><strong>The defaults are the wizard's own defaults, deliberately.</strong> A blank term is
     * eleven months ({@code parseInt(terms.months, 10) || 11}); an absent deposit is no deposit,
     * which is a real and common tenancy and contributes a real zero rather than a missing one; an
     * unrecognised registration area is municipal, because Pune city is and because municipal is the
     * higher of the two fees — defaulting to the cheaper one would leave the platform remitting the
     * difference. Any other choice here would make the sidebar and the charge disagree, which is the
     * failure D150 closed.
     *
     * <p>Only the rent is load-bearing: with no rent there is no consideration and no honest duty, so
     * this returns {@code null} and the caller declines to invent one. A rent that is present but
     * outside the range that can be priced is a different thing — a malformed body, answered 422,
     * rather than a request that simply said nothing.
     */
    private LeaveAndLicenceCharges.Terms leaveAndLicenceTerms(Map<String, Object> details) {
        if (details == null || details.isEmpty()) {
            return null;
        }
        Map<String, Object> state = childObject(childObject(details, "_state"), "terms");
        Long rent = rupees(details.get("rent"), state.get("rent"));
        if (rent == null || rent <= 0L) {
            return null;
        }
        Long months = rupees(details.get("months"), state.get("months"));
        Long deposit = rupees(details.get("deposit"), state.get("deposit"));
        Long nonRefundable = rupees(details.get("nrDeposit"), state.get("nrDeposit"));
        boolean urban = !isRural(details.get("regArea"), state.get("regArea"));
        try {
            return new LeaveAndLicenceCharges.Terms(rent,
                    deposit == null ? 0L : deposit,
                    nonRefundable == null ? 0L : nonRefundable,
                    months == null || months <= 0L ? DEFAULT_TERM_MONTHS : Math.toIntExact(months),
                    urban);
        } catch (ArithmeticException | IllegalArgumentException unpriceable) {
            throw new ValidationException(
                    "details states rent-agreement terms that cannot be priced: "
                            + unpriceable.getMessage());
        }
    }

    /**
     * The first of {@code candidates} that reads as a whole non-negative rupee figure, or
     * {@code null}.
     *
     * <p>Both shapes have to be accepted because both are posted: the flattened copy holds JSON
     * numbers, the {@code _state} copy holds the raw form strings. A negative or fractional value is
     * not coerced — it is treated as unstated, so it reaches the range check as an absent term rather
     * than as a silently rounded one.
     */
    private static Long rupees(Object... candidates) {
        for (Object candidate : candidates) {
            if (candidate instanceof Number number && number.longValue() >= 0) {
                return number.longValue();
            }
            if (candidate instanceof String text && text.strip().matches("\\d{1,18}")) {
                return Long.valueOf(text.strip());
            }
        }
        return null;
    }

    /** Whether any of {@code candidates} names a rural registering body — see the caller's default. */
    private static boolean isRural(Object... candidates) {
        for (Object candidate : candidates) {
            if (candidate instanceof String text
                    && text.toLowerCase(Locale.ROOT).contains("rural")) {
                return true;
            }
        }
        return false;
    }

    /** The nested object at {@code key}, or an empty map — so lookups can chain without null checks. */
    private static Map<String, Object> childObject(Map<String, Object> parent, String key) {
        Object child = parent.get(key);
        if (child instanceof Map<?, ?> map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> typed = (Map<String, Object>) map;
            return typed;
        }
        return Map.of();
    }
}
