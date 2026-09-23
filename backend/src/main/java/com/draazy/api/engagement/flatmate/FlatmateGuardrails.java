package com.draazy.api.engagement.flatmate;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** A <em>different</em> host on one address only flags for Ops, never blocks, because
 * {@link #fingerprint} is a fuzzy match over free text and refusing an honest post is the worse error. */
@Component
public class FlatmateGuardrails {

    /** A count rather than a rate: a dozen rooms is a brokerage whether posted in an hour or a month.
     * Owner-tier posts are exempt from the count, never from the address dedupe. */
    public static final int MAX_ACTIVE_HOST_POSTS = 3;

    /** Public because it is the only surviving link from an owner-tier post back to the listing that
     * earned it — a spare room cannot store {@code property_id}. */
    public static final String PROPERTY_PREFIX = "prop:";

    private final FlatmateRoomRepository rooms;
    private final FlatmateGroupRepository groups;

    public FlatmateGuardrails(FlatmateRoomRepository rooms, FlatmateGroupRepository groups) {
        this.rooms = rooms;
        this.groups = groups;
    }

    /** The single decision point every supply-side create runs through. Returns what was decided and
     * why, so the caller can refuse with a message that names the actual reason. */
    public HostEligibility evaluate(UUID hostId, String tier, Address address) {
        String fingerprint = fingerprint(address);
        boolean ownerTier = FlatmateVocabulary.TIER_OWNER.equals(tier);

        long held = rooms.countCappedByHost(hostId) + groups.countCappedByHost(hostId);
        boolean overCap = !ownerTier && held >= MAX_ACTIVE_HOST_POSTS;

        List<Claim> claims = claims(fingerprint);
        boolean duplicate = claims.stream().anyMatch(c -> c.hostId().equals(hostId));
        boolean contested = claims.stream().anyMatch(c -> !c.hostId().equals(hostId));

        String reason;
        if (overCap) {
            reason = "You already have " + MAX_ACTIVE_HOST_POSTS + " live flatmate posts. "
                    + "Fill or close one before posting another.";
        } else if (duplicate) {
            reason = "You already have a live flatmate post for this address.";
        } else {
            reason = "";
        }

        return new HostEligibility(overCap || duplicate, overCap, duplicate, contested,
                fingerprint, reason);
    }

    /** Ordered by how much the identifier is worth: listing id, then society+locality, then
     * title+locality. Normalised hard because these are strings people typed. */
    public String fingerprint(Address address) {
        if (address == null) {
            return null;
        }
        if (address.propertyId() != null) {
            return PROPERTY_PREFIX + address.propertyId();
        }
        String locality = normalise(address.locality());
        String society = normalise(address.society());
        String title = normalise(address.title());
        // Both remaining branches suffix the locality unconditionally, so a society with no locality
        // yields "addr:sai radha|", which can never match and would be silently unusable forever.
        if (locality.isEmpty()) {
            return null;
        }
        if (!society.isEmpty()) {
            return "addr:" + society + "|" + locality;
        }
        if (!title.isEmpty()) {
            return "addr:" + title + "|" + locality;
        }
        return null;
    }

    /** Live host-claims (rooms and groups alike) on one address. */
    private List<Claim> claims(String fingerprint) {
        List<Claim> found = new ArrayList<>();
        if (fingerprint == null) {
            return found;
        }
        rooms.findByAddressFingerprintAndArchivedFalse(fingerprint)
                .forEach(r -> found.add(new Claim(r.getHostId(), "room", r.getId())));
        groups.findByAddressFingerprintAndArchivedFalse(fingerprint)
                .forEach(g -> found.add(new Claim(g.getHostId(), "group", g.getId())));
        return found;
    }

    /** Deliberately aggressive: over-normalising costs a false flag a human clears, while
     * under-normalising lets a broker in by typing a hyphen. */
    private static String normalise(String value) {
        if (value == null || value.isBlank()) {
            return "";
        }
        String decomposed = Normalizer.normalize(value.strip(), Normalizer.Form.NFD);
        return decomposed
                .replaceAll("\\p{M}+", "")
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", " ")
                .strip();
    }

    /** What the caller knows about where the post is. Any field may be absent. */
    public record Address(UUID propertyId, String society, String locality, String title) {
    }

    /** Contract schema {@code HostEligibility}. Returned on a 409 so the client can explain the
     * refusal rather than guessing at it. */
    public record HostEligibility(boolean blocked, boolean overCap, boolean duplicate,
            boolean flagForReview, String fingerprint, String reason) {
    }

    private record Claim(UUID hostId, String kind, UUID id) {
    }
}
