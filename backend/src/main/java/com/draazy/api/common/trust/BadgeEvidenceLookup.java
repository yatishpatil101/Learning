package com.draazy.api.common.trust;

import java.util.UUID;

/**
 * Kernel port: vault asks whether a file backs a live Ownership Verified badge.
 * Rationale: docs/system/cross-cutting.md#document-vault-allowlist-sniff-scan-store
 */
public interface BadgeEvidenceLookup {

    /**
     * What the trust record has to say about a vault document somebody is about to delete.
     *
     * @param documentId the vault row; {@code null} answers {@link Hold#NONE}
     */
    Hold holdOn(UUID documentId);

    /** How strong a claim the ownership gate has on one vault document. */
    enum Hold {

        /** No evidence row cites it. The vault decides alone. */
        NONE,

        /**
         * Cited but the badge is not live — file may go; an audit line records the loss because a
         * later withdrawal investigation ("the Index II turned out to be forged") reaches for it.
         */
        CITED,

        /**
         * Cited while the badge is live. The listing is telling buyers something the platform
         * vouched for on the strength of this file, so the file stays until the claim stops.
         */
        LIVE_BADGE
    }
}
