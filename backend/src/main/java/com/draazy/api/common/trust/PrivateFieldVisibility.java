package com.draazy.api.common.trust;

/** The union of owner and ops desk, and nobody else: {@link ContactVisibility} also reaches approved strangers and
 * {@link BackOfficeVisibility} never reaches owners, so neither can express it alone. */
public enum PrivateFieldVisibility {

    /** Omit. The default for every public and cross-user surface. */
    HIDDEN,

    /** Emit. Reached on the owner's own {@code /me/listings} views and behind a staff guard. */
    VISIBLE
}
