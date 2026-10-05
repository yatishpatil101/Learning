package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.error.ConflictException;

/** Sub-codes split benign duplicate interest from genuine refusals under one 409 code. */
final class FlatmateConflicts {

    private FlatmateConflicts() {
    }

    static final String ALREADY_INTERESTED = "already_interested";

    static final String GROUP_FULL = "group_full";

    static final String ROOM_FULL = "room_full";

    static final String GROUP_LIMIT = "group_limit";

    /** Named for the rule because each surface offers a different remedy. */
    static final String HOST_CAPPED = "host_capped";

    static final String DUPLICATE_ADDRESS = "duplicate_address";

    /** The host has already accepted or declined, so the ask is no longer the requester's to retract. */
    static final String ALREADY_DECIDED = "already_decided";

    /** Split rooms project a property address, so edit and delete share the same sub-code. */
    static final String SPLIT_ROOM = "split_room";

    /** Strip prose before appending markers so routing patterns do not depend on caller spaces. */
    private static ConflictException marked(String prose, String subCode) {
        return new ConflictException(prose.strip() + " (" + subCode + ")");
    }

    /** Each surface supplies wording, but all duplicate-interest messages promise the ask survived. */
    static ConflictException alreadyInterested(String prose) {
        return marked(prose, ALREADY_INTERESTED);
    }

    static ConflictException groupFull(String prose) {
        return marked(prose, GROUP_FULL);
    }

    static ConflictException roomFull(String prose) {
        return marked(prose, ROOM_FULL);
    }

    static ConflictException groupLimit(String prose) {
        return marked(prose, GROUP_LIMIT);
    }

    /** Keep the booleans, but mirror them into the sub-code parser clients already use. */
    static String guardrailSubCode(boolean overCap, boolean duplicate) {
        if (overCap) {
            return HOST_CAPPED;
        }
        return duplicate ? DUPLICATE_ADDRESS : null;
    }

    static String mark(String prose, String subCode) {
        return subCode == null ? prose.strip() : prose.strip() + " (" + subCode + ")";
    }
}
