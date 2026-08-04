package com.punenest.api.engagement.flatmate;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * The anti-broker guardrails: how many live posts one identity may host, and whether two people are
 * claiming the same physical flat.
 *
 * <p><strong>This logic used to live in the browser</strong> — {@code frontend/src/lib/data/
 * flatmates.js}, reading {@code localStorage}, deciding for itself whether a post was allowed. A cap
 * a client enforces is not a cap: it is a suggestion that anyone with developer tools declines. It
 * moves here, where the count is a query against rows the caller cannot edit and the decision is
 * made by the process that also does the insert.
 *
 * <p>Trust is the product for a flat-sharing market. The failure mode this exists to prevent is a
 * broker posing as a tenant, listing thirty rooms they do not hold; the two signals that catch it
 * are volume from one identity and the same address claimed twice.
 *
 * <p><strong>Block versus flag is the important distinction.</strong> A hard block is reserved for
 * facts we are certain of: this identity is over the cap, or this identity is re-posting an address
 * it already holds. A <em>different</em> host claiming the same address only raises a flag for Ops,
 * because {@link #fingerprint} is a fuzzy match over free text — two genuinely different flats in
 * one large society can collide, and refusing an honest post is a worse error than reviewing one.
 */
@Component
public class FlatmateGuardrails {

    /**
     * Live non-owner-tier posts one identity may hold.
     *
     * <p>A count rather than a rate: someone advertising a dozen rooms is running a brokerage, and
     * whether they did it in an hour or over a month makes no difference to that fact. Three is the
     * honest ceiling for a person sharing the flat they live in.
     *
     * <p>Owner-tier posts are exempt from the <em>count</em> — a verified owner letting a flat room
     * by room legitimately holds several, and counting them would penalise the best supply on the
     * platform. They are never exempt from the address dedupe.
     */
    public static final int MAX_ACTIVE_HOST_POSTS = 3;

    private final FlatmateRoomRepository rooms;
    private final FlatmateGroupRepository groups;

    public FlatmateGuardrails(FlatmateRoomRepository rooms, FlatmateGroupRepository groups) {
        this.rooms = rooms;
        this.groups = groups;
    }

    /**
     * The single decision point every supply-side create runs through — room post, group, flat
     * split. Returns what was decided and why, so the caller can refuse with a message that names
     * the actual reason rather than a generic "not allowed".
     */
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

    /**
     * A stable key for one physical flat.
     *
     * <p>Ordered by how much the identifier is worth. A {@code propertyId} is an Ops-verified
     * listing and therefore exact. Failing that, a society name plus locality is a decent proxy for
     * a building. Failing that, the post's own title plus locality is a guess — kept only because a
     * weak signal that routes to a human beats no signal at all.
     *
     * <p>Normalised hard (accents stripped, punctuation dropped, whitespace collapsed) because these
     * are strings people typed: "Sai-Radha Complex" and "sai radha complex" are one building, and a
     * fingerprint that disagrees is a fingerprint that never matches anything.
     */
    public String fingerprint(Address address) {
        if (address == null) {
            return null;
        }
        if (address.propertyId() != null) {
            return "prop:" + address.propertyId();
        }
        String locality = normalise(address.locality());
        String society = normalise(address.society());
        String title = normalise(address.title());
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

    /**
     * Lower-case, accent-stripped, alphanumerics-and-single-spaces only. Deliberately aggressive:
     * the cost of over-normalising is a false flag a human clears, and the cost of
     * under-normalising is a broker who gets in by typing a hyphen.
     */
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

    /**
     * Contract schema {@code HostEligibility}. Returned on a 409 so the client can explain the
     * refusal rather than guessing at it.
     */
    public record HostEligibility(boolean blocked, boolean overCap, boolean duplicate,
            boolean flagForReview, String fingerprint, String reason) {
    }

    private record Claim(UUID hostId, String kind, UUID id) {
    }
}
