package com.punenest.api.documents.request;

/**
 * The {@code DocumentRequest.status} vocabulary and the transitions the owner may drive. Mirrors
 * the V6 CHECK constraint, which is the real enforcement.
 */
public final class DocumentRequestStatuses {

    private DocumentRequestStatuses() {
    }

    public static final String PENDING = "pending";
    public static final String GRANTED = "granted";
    public static final String DECLINED = "declined";

    /**
     * Reached by the clock, never by a request. A grant lapses on its {@code expiresAt}; the status
     * is what the owner sees, and the token check does not consult it — see
     * {@code DocumentRequestService.shared} for why the expiry, not the label, is authoritative.
     */
    public static final String EXPIRED = "expired";

    /**
     * Only {@code pending → granted|declined}. Both end states are terminal: an owner cannot revoke
     * a grant the buyer has already followed, and cannot quietly turn a "no" into a "yes" later
     * without the buyer asking again — which V20's partial unique index deliberately permits.
     */
    public static boolean canTransition(String from, String to) {
        return PENDING.equals(from) && (GRANTED.equals(to) || DECLINED.equals(to));
    }
}
