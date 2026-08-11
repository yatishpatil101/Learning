package com.punenest.api.billing.marketplace;

import java.util.Map;
import java.util.Set;

/**
 * The {@code ServiceOrder.status} vocabulary <em>and the state machine over it</em> (D58). Mirrors
 * the {@code service_orders.status} CHECK (V8, extended by V57), which is the real enforcement.
 * Constants rather than an enum per {@code api-standards.md} §7.1.
 *
 * <p><strong>What changed in D58.</strong> This class used to say that the contract declared no
 * operation advancing an order, so scheduling, working and cancelling were ops actions with no
 * endpoint — which meant the only way to quote a job or close it was a hand-written {@code UPDATE}
 * against the database. The statuses are now reachable through the API, and the legal moves between
 * them are declared here rather than left to whoever writes the next service method.
 *
 * <p><strong>{@link #QUOTED} is the state the endpoint exists for.</strong> An offering carries a
 * <em>starting</em> price; the real number is agreed after a survey. Quoting is therefore the step
 * that attaches money to an order, which is why advancing one could never have been a plain status
 * setter — and why {@code amount} is writable on this transition and no other. An amount that can
 * move after the customer has accepted is a repricing, not a quote.
 *
 * <p><strong>The vocabulary is the one already on the wire, plus {@code quoted}.</strong> The
 * register describes the machine as {@code pending -> quoted -> accepted -> in_progress ->
 * completed}. Three of those names differ from the values this platform has stored and published
 * since V8 — {@code pending} is {@link #PLACED}, {@code accepted} is {@link #SCHEDULED},
 * {@code in_progress} is {@link #IN_PROGRESS} — and renaming them would rewrite live rows, break
 * the published {@code ServiceOrder} enum and break every client generated from it, in exchange for
 * nothing a user can see. Only the genuinely missing state was added; the shape of the machine is
 * exactly as specified.
 */
public final class ServiceOrderStatuses {

    private ServiceOrderStatuses() {
    }

    /** Ordered, awaiting a survey and a quote. The only status {@code createServiceOrder} produces. */
    public static final String PLACED = "placed";

    /** Surveyed and priced. The one transition that may set {@code amount}. */
    public static final String QUOTED = "quoted";

    /** The customer accepted the quote, so the job is booked. Only the customer causes this. */
    public static final String SCHEDULED = "scheduled";

    /** The crew is on the job. Past the point of cancellation. */
    public static final String IN_PROGRESS = "in-progress";

    /** Done. Terminal. */
    public static final String COMPLETED = "completed";

    /** Called off, by the customer or by ops, before work started. Terminal. */
    public static final String CANCELLED = "cancelled";

    /**
     * The legal moves.
     *
     * <p>{@link #CANCELLED} is reachable from every state <em>before</em> work starts and from none
     * after: once a crew is on site there is a job to bill for, and "cancelled" would be a claim
     * that nothing happened. Closing an order that went wrong mid-job is a completion, or a refund
     * — neither is a status change, and neither is invented here.
     *
     * <p>There is deliberately no {@code quoted -> quoted} self-loop. Re-quoting before acceptance
     * is a reasonable thing to want, and it is left out on purpose: the register specified a linear
     * machine, and a self-loop is the one edge that lets a desk change a price the customer is
     * currently looking at without the customer ever seeing the first one.
     */
    private static final Map<String, Set<String>> ALLOWED = Map.of(
            PLACED, Set.of(QUOTED, CANCELLED),
            QUOTED, Set.of(SCHEDULED, CANCELLED),
            SCHEDULED, Set.of(IN_PROGRESS, CANCELLED),
            IN_PROGRESS, Set.of(COMPLETED),
            COMPLETED, Set.of(),
            CANCELLED, Set.of());

    /**
     * What {@code PATCH /service-orders/{id}/status} may set.
     *
     * <p>Two statuses are absent and the absences are the design. {@link #PLACED} is what ordering
     * produces, so nothing can move an order back to it. {@link #SCHEDULED} means <em>the customer
     * accepted the price</em> — handing that to the same desk that set the price would let ops
     * quote a job and accept its own quote in two calls, which is the whole reason acceptance is a
     * separate operation with a different guard.
     */
    private static final Set<String> OPS_SETTABLE =
            Set.of(QUOTED, IN_PROGRESS, COMPLETED, CANCELLED);

    /** True if this is one of the statuses {@code service_orders_status_check} will accept. */
    public static boolean isKnown(String status) {
        return ALLOWED.containsKey(status);
    }

    /** True if {@code from -> to} is a move the machine allows. An unknown state allows nothing. */
    public static boolean canTransition(String from, String to) {
        return ALLOWED.getOrDefault(from, Set.of()).contains(to);
    }

    /** True if ops may name this status on the staff endpoint. */
    public static boolean isOpsSettable(String status) {
        return OPS_SETTABLE.contains(status);
    }

    /** Terminal states accept no further move of any kind. */
    public static boolean isTerminal(String status) {
        return COMPLETED.equals(status) || CANCELLED.equals(status);
    }
}
