package com.punenest.api.services.request;

import java.util.Map;
import java.util.Set;

/**
 * The {@code service_requests.status} vocabulary and the state machine over it. Mirrors the V7
 * CHECK, which is the real enforcement.
 *
 * <p><strong>Why this list and not the frontend's.</strong> {@code docs/flows/ops/service-queues.md}
 * documents a different set of statuses ({@code submitted}, {@code docs_review},
 * {@code changes_requested}, {@code registration}) because the React prototype invented its own in
 * {@code localStorage}. The contract and the table agree on the seven below, and the contract is the
 * source of truth. The two that vanish map cleanly: {@code changes_requested} is
 * {@code draft-shared → in-progress} (the draft came back, so ops is working again), and
 * {@code registration} is the window between {@code approved} and the final document landing —
 * a state with no decision in it, and therefore not a state.
 */
public final class ServiceRequestStatuses {

    private ServiceRequestStatuses() {
    }

    /** Filed, nobody has picked it up. */
    public static final String NEW = "new";

    /** A staff member owns it. */
    public static final String ASSIGNED = "assigned";

    /** Work is happening — also where a rejected draft returns to. */
    public static final String IN_PROGRESS = "in-progress";

    /** The maker has put a deliverable in front of the customer. */
    public static final String DRAFT_SHARED = "draft-shared";

    /** The checker said yes. Only the customer can cause this. */
    public static final String APPROVED = "approved";

    /** The registered copy is in. Terminal. */
    public static final String COMPLETED = "completed";

    /** Terminal. */
    public static final String CANCELLED = "cancelled";

    /**
     * The legal moves.
     *
     * <p>{@code draft-shared → draft-shared} is intentional: a revised draft after the customer
     * asked for changes is the same move made twice, not a special case.
     */
    private static final Map<String, Set<String>> ALLOWED = Map.of(
            NEW, Set.of(ASSIGNED, IN_PROGRESS, CANCELLED),
            ASSIGNED, Set.of(IN_PROGRESS, DRAFT_SHARED, CANCELLED),
            IN_PROGRESS, Set.of(ASSIGNED, DRAFT_SHARED, CANCELLED),
            DRAFT_SHARED, Set.of(APPROVED, IN_PROGRESS, DRAFT_SHARED, CANCELLED),
            APPROVED, Set.of(COMPLETED, CANCELLED),
            COMPLETED, Set.of(),
            CANCELLED, Set.of());

    /**
     * What {@code PATCH /service-requests/{id}/status} may set.
     *
     * <p>Three statuses are deliberately absent: {@code draft-shared} is earned by actually
     * uploading a draft, {@code approved} by the customer deciding, and {@code completed} by the
     * final document landing. A status endpoint that could set them would let a staff member mark a
     * job approved and finished without ever producing the document — the maker-checker defeated by
     * a free-text field.
     */
    private static final Set<String> STAFF_SETTABLE = Set.of(ASSIGNED, IN_PROGRESS, CANCELLED);

    /** True if this is one of the seven the V7 CHECK will accept. */
    public static boolean isKnown(String status) {
        return ALLOWED.containsKey(status);
    }

    public static boolean canTransition(String from, String to) {
        return ALLOWED.getOrDefault(from, Set.of()).contains(to);
    }

    public static boolean isStaffSettable(String status) {
        return STAFF_SETTABLE.contains(status);
    }

    /** Terminal states accept no further work of any kind — no draft, no message, no document. */
    public static boolean isTerminal(String status) {
        return COMPLETED.equals(status) || CANCELLED.equals(status);
    }
}
