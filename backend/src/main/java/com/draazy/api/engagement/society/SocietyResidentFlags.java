package com.draazy.api.engagement.society;

/**
 * Advisory marks on a residency request (V101 {@code society_residents.flagged}).
 *
 * <p>A mark is not a refusal. The server cannot tell a flat changing hands from somebody claiming a
 * flat that is not theirs, so it does the one thing it can: say so, to the reviewer who can tell.
 */
public final class SocietyResidentFlags {

    /** Another verified resident already holds this unit. */
    public static final String CONFLICT = "conflict";

    private SocietyResidentFlags() {
    }
}
