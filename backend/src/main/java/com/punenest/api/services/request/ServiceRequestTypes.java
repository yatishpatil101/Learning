package com.punenest.api.services.request;

import com.punenest.api.security.Teams;
import java.util.Map;
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

    /**
     * The desk each type is worked by (D44). Mirrors the V72 {@code service_requests_type_team_check}
     * pair constraint, which is the real enforcement.
     *
     * <p><strong>Total over {@link #KNOWN}, and checked to be</strong> — see the static block below.
     * The register's objection to team-scoping service requests was that inferring a desk from the
     * type string would "silently hide work the day a new type appears": a request whose type nobody
     * had mapped would belong to no desk and vanish from every queue. A partial map read at query
     * time fails that way. A total map, verified at class load and paired to the type by a database
     * CHECK, fails the other way — adding a sixth type without naming its desk stops the application
     * from starting and stops the row from being inserted, which is loud rather than lossy.
     *
     * <p>Note the one pair that is not a rename: the priced {@link #RENT_AGREEMENT} desk is worked
     * by {@link Teams#RENTAL}, which is what {@code /ops/rent-agreement} is already gated on
     * ({@code TeamRoute team="rental"}). And {@link Teams#LOANS} appears here not at all — nothing on
     * the platform files a loan as a service request, so that desk reads an empty queue. That is a
     * fact about the product, not a hole in this map: a team with no work is visible, a type with no
     * team would not be.
     */
    private static final Map<String, String> TEAM_BY_TYPE = Map.of(
            RENT_AGREEMENT, Teams.RENTAL,
            LEGAL, Teams.LEGAL,
            INTERIOR, Teams.INTERIOR,
            PACKERS, Teams.PACKERS,
            VALUATION, Teams.VALUATION);

    /**
     * The in-app page that shows this type's tracker, for notification links.
     *
     * <p><strong>Route knowledge in Java, deliberately.</strong> A notification carries a link or it
     * is a dead end — "your draft is ready" with nowhere to go is worse than silence, because the
     * reader now knows something is waiting and cannot reach it. Every other notifier on the
     * platform already names a client path ({@code /dashboard#visits}, {@code /view-documents/{id}}),
     * so this is the established shape rather than a new coupling.
     *
     * <p>It is a map and not string concatenation because the paths are <em>not</em> derivable from
     * the type: {@code valuation} lives at {@code /services/property-valuation}, {@code packers} at
     * {@code /services/packers-movers}. A {@code "/services/" + type} would have produced four
     * plausible-looking 404s and one accidental hit.
     *
     * <p>Total over {@link #KNOWN} and checked in the static block below, for the same reason
     * {@link #TEAM_BY_TYPE} is: a sixth type whose page nobody named would notify its customer with
     * a null link, which reads as an ordinary un-clickable row rather than as a mistake.
     */
    private static final Map<String, String> PAGE_BY_TYPE = Map.of(
            RENT_AGREEMENT, "/services/rent-agreement",
            LEGAL, "/services/property-legal",
            INTERIOR, "/services/interior-renovation",
            PACKERS, "/services/packers-movers",
            VALUATION, "/services/property-valuation");

    static {
        // Totality, asserted where it cannot be skipped. A missing entry here is the exact defect
        // the register predicted, and the only moment it is cheap to find is before the first
        // request is filed against it.
        if (!TEAM_BY_TYPE.keySet().equals(KNOWN)) {
            throw new IllegalStateException(
                    "Every service request type must name the desk that works it. Unmapped: "
                            + KNOWN.stream().filter(t -> !TEAM_BY_TYPE.containsKey(t)).sorted().toList()
                            + "; mapped but not a known type: "
                            + TEAM_BY_TYPE.keySet().stream().filter(t -> !KNOWN.contains(t)).sorted()
                                    .toList());
        }
        if (!PAGE_BY_TYPE.keySet().equals(KNOWN)) {
            throw new IllegalStateException(
                    "Every service request type must name the page its customer is sent to. Unmapped: "
                            + KNOWN.stream().filter(t -> !PAGE_BY_TYPE.containsKey(t)).sorted().toList()
                            + "; mapped but not a known type: "
                            + PAGE_BY_TYPE.keySet().stream().filter(t -> !KNOWN.contains(t)).sorted()
                                    .toList());
        }
    }

    /** True if this is one of the types the {@code service_requests_type_check} will accept. */
    public static boolean isKnown(String type) {
        return KNOWN.contains(type);
    }

    /** The accepted vocabulary, for error messages and for the contract's enum. */
    public static Set<String> known() {
        return KNOWN;
    }

    /**
     * The ops desk that works this type of request.
     *
     * <p><strong>Throws rather than returning null or a default.</strong> Callers reach this after
     * {@link #isKnown} has already refused an unknown type with a 400, so getting here with one
     * means the two vocabularies have drifted — and the one thing that must not happen then is a
     * request quietly landing on some fallback desk, or on none. The database says the same thing a
     * moment later; this says it first, and with the type in the message.
     *
     * @throws IllegalStateException if the type has no desk
     */
    public static String teamFor(String type) {
        String team = TEAM_BY_TYPE.get(type);
        if (team == null) {
            throw new IllegalStateException("No ops desk is mapped to service request type '" + type
                    + "'. Add it to ServiceRequestTypes.TEAM_BY_TYPE and to the V72 "
                    + "service_requests_type_team_check, or the request belongs to nobody.");
        }
        return team;
    }

    /** The type→desk pairing, for the tests that pin it and for the contract's documentation. */
    public static Map<String, String> teams() {
        return TEAM_BY_TYPE;
    }

    /**
     * The in-app page a customer is sent to for this type of request.
     *
     * <p>Throws rather than returning null or a default, for the reason {@link #teamFor} does: a
     * notification whose link silently became {@code null} is indistinguishable from one that was
     * never meant to be clickable.
     *
     * @throws IllegalStateException if the type has no page
     */
    public static String pageFor(String type) {
        String page = PAGE_BY_TYPE.get(type);
        if (page == null) {
            throw new IllegalStateException("No customer page is mapped to service request type '"
                    + type + "'. Add it to ServiceRequestTypes.PAGE_BY_TYPE, or every notification "
                    + "about it links nowhere.");
        }
        return page;
    }
}
