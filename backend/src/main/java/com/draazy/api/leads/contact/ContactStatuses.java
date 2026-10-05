package com.draazy.api.leads.contact;

public final class ContactStatuses {

    private ContactStatuses() {
    }

    public static final String OWNER = "owner";

    public static final String APPROVED = "approved";

    /** A request exists and is awaiting the owner's decision. Contact stays masked. */
    public static final String PENDING = "pending";

    /** The owner declined. Terminal — contact stays masked and re-requesting does not reset it. */
    public static final String DECLINED = "declined";

    public static final String NONE = "none";

    // Approval unlocks chat, not digits, so `approved` is not a reveal state.
    // Keep this with constants so new statuses must confront the vocabulary rule.
    public static boolean revealsContact(String status) {
        return APPROVED.equals(status) || OWNER.equals(status);
    }
    }
