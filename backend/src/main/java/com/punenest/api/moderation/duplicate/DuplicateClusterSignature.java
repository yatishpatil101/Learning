package com.punenest.api.moderation.duplicate;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * The identity of a derived duplicate cluster: sort its member ids, join them, hash them.
 *
 * <p>Clusters are computed on demand and never stored, so they have no id of their own — the same
 * physical pair of listings is a different object on every request. The one thing that is stable
 * about a cluster is the set of listings in it, so that set is made to serve as the key.
 *
 * <p><strong>This is the only place allowed to produce that value.</strong> "Sort and hash" reads
 * like something any caller can do inline, and that is exactly the trap: a second implementation
 * that sorts by {@link UUID} natural order instead of string order, or forgets to de-duplicate, or
 * joins with a different separator, produces a digest that is wrong in no visible way. The failure
 * mode is silent and one-directional — dismissals stop matching, so a cluster an operator settled
 * comes back, and the only symptom is a human being asked the same question twice.
 *
 * <p>Sorted as <em>strings</em> rather than by {@code UUID.compareTo}, deliberately.
 * {@link UUID#compareTo} compares the two halves as <em>signed</em> longs, so it does not agree
 * with the lexicographic order of the printed form. Either order would be self-consistent, but the
 * printed order is the one a human reproduces from {@code member_ids} with {@code sort}, and being
 * checkable by hand is worth more here than being marginally cheaper.
 */
public final class DuplicateClusterSignature {

    private DuplicateClusterSignature() {
    }

    /** The member ids in the canonical order the signature is built from. */
    public static List<String> canonicalMembers(Collection<UUID> memberIds) {
        return memberIds.stream()
                .filter(java.util.Objects::nonNull)
                .map(UUID::toString)
                .distinct()
                .sorted()
                .toList();
    }

    /**
     * The 64-character lowercase sha-256 hex digest of the canonical member list.
     *
     * <p>Hashed rather than stored as the joined ids because the column it lands in is indexed, and
     * V119 records what a btree does with an entry over 2704 bytes: it rejects the INSERT with an
     * internal error rather than a constraint violation. Joined uuids cross that at roughly 73
     * members, which one over-eager address normalisation in a large society can reach. A digest is
     * 64 characters whatever the cluster size.
     */
    public static String of(Collection<UUID> memberIds) {
        String canonical = String.join(",", canonicalMembers(memberIds));
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(canonical.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(64);
            for (byte b : digest) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16));
                hex.append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is required of every JRE by the MessageDigest spec, so this is unreachable
            // rather than merely unlikely. Rethrown unchecked so the signature stays usable inline.
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
