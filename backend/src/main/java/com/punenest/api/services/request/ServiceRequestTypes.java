package com.punenest.api.services.request;

import java.util.Set;

/**
 * The {@code service_requests.type} vocabulary — the closed set of service desks a request may be
 * filed against. Mirrors the V42 CHECK, which is the real enforcement.
 *
 * <p><strong>Why this is a closed set and not free text.</strong> {@code type} used to be
 * {@code @NotBlank @Size(max = 64)} with no allowlist, and the price of a request is decided by
 * matching that string exactly: only {@link #RENT_AGREEMENT} is charged, everything else is a free
 * desk that goes straight into the ops queue. A one-character variation — {@code Rent-Agreement},
 * {@code rent_agreement}, the frontend's own {@code rental} — therefore did not fail; it created an
 * <em>unpaid</em> rent agreement and put ops to work for free. A payment gate that is opted into by
 * spelling a string correctly is not a gate.
 *
 * <p>The frontend maps its own {@code rental} onto {@link #RENT_AGREEMENT} in
 * {@code serviceRequestMapper.js}. That alias is a convenience; this set is the control. An unknown
 * type is now a 400, which is also what makes the alias's failure loud instead of free.
 */
public final class ServiceRequestTypes {

    private ServiceRequestTypes() {
    }

    /** The one priced desk: a Maharashtra Leave &amp; License agreement, drawn and e-registered. */
    public static final String RENT_AGREEMENT = "rent-agreement";

    /** Title search, legal opinion, due diligence. Free to file. */
    public static final String LEGAL = "legal";

    /** Interior and renovation. Free to file. */
    public static final String INTERIOR = "interior";

    /** Packers and movers. Free to file. */
    public static final String PACKERS = "packers";

    /** Certified property valuation. Free to file. */
    public static final String VALUATION = "valuation";

    private static final Set<String> KNOWN =
            Set.of(RENT_AGREEMENT, LEGAL, INTERIOR, PACKERS, VALUATION);

    /** True if this is one of the types the {@code service_requests_type_check} will accept. */
    public static boolean isKnown(String type) {
        return KNOWN.contains(type);
    }

    /** The accepted vocabulary, for error messages and for the contract's enum. */
    public static Set<String> known() {
        return KNOWN;
    }
}
