package com.punenest.api.common.trust;

/**
 * Whether a projection may carry a field the listing's own side may see but the public may not.
 *
 * <p>A third axis alongside {@link ContactVisibility} and {@link BackOfficeVisibility}, because it
 * answers a question neither of them does. Contact visibility is "has this buyer earned the owner's
 * phone number", and its {@code REVEALED} value is reached by an approved <em>stranger</em>.
 * Back-office visibility is "is this the ops desk", and its {@code VISIBLE} value is never reached
 * by an owner at all. What is needed here is the union — the owner and the desk, and nobody else —
 * and neither existing axis can express that without also handing the field to an audience that
 * should not have it.
 *
 * <p>Guards exactly one field today: {@code electricityMeterNo}. A meter number identifies a
 * specific unit and names a live utility account, so it is one of the few things on a listing a
 * stranger could act on rather than merely read — a number plus a surname is enough to impersonate
 * a consumer at the counter. Its only reader inside the platform is the server-side duplicate probe,
 * which never leaves the service layer; the owner sees it because they typed it and must be able to
 * correct it, and the desk sees it because it is the evidence behind a duplicate flag.
 */
public enum PrivateFieldVisibility {

    /** Omit. The default for every public and cross-user surface. */
    HIDDEN,

    /** Emit. Reached on the owner's own {@code /me/listings} views and behind a staff guard. */
    VISIBLE
}
