package com.punenest.api.billing.marketplace;

/**
 * The {@code ServiceOrder.status} vocabulary (contract enum; {@code service_orders.status} CHECK,
 * V8). Constants rather than an enum per {@code api-standards.md} §7.1.
 *
 * <p>Only {@link #PLACED} is produced by this slice — the contract declares no operation that
 * advances an order, so scheduling, working and cancelling are ops actions with no endpoint yet.
 * The values are declared anyway because they are the column's CHECK and the DTO's enum.
 */
public final class ServiceOrderStatuses {

    private ServiceOrderStatuses() {
    }

    /** Ordered, awaiting a survey and a quote. */
    public static final String PLACED = "placed";

    /** Quoted and booked for a slot. */
    public static final String SCHEDULED = "scheduled";

    /** The crew is on the job. */
    public static final String IN_PROGRESS = "in-progress";

    /** Done. */
    public static final String COMPLETED = "completed";

    /** Called off by the customer or ops. */
    public static final String CANCELLED = "cancelled";
}
