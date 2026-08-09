package com.punenest.api.engagement.flatmate;

import com.punenest.api.common.error.BadRequestException;
import java.util.Set;

/**
 * The closed vocabularies of the flatmate domain, in one place.
 *
 * <p>Every set here is duplicated as a {@code CHECK} constraint in V27. That duplication is
 * deliberate and the direction matters: the constraint is the guarantee (nothing writes a bad value,
 * whatever the write path), and this class is the <em>message</em>. Without it a typo in a request
 * body surfaces as a constraint violation — a 500 that any caller can trigger and that names a
 * database object rather than the field they got wrong.
 *
 * <p>Values are lower-case strings rather than Java enums because they cross the wire in both
 * directions and appear verbatim in the contract. An enum would add a mapping layer whose only job
 * is to reproduce the string it was given.
 */
public final class FlatmateVocabulary {

    private FlatmateVocabulary() {
    }

    /** Who a seeker or host will share with. {@code any} is a stated openness, not an absence. */
    public static final Set<String> GENDER = Set.of("any", "male", "female");

    /** Dietary preference. Note {@code nonveg}, one word — V7's {@code non-veg} was respelled in V27. */
    public static final Set<String> FOOD = Set.of("any", "veg", "nonveg");

    /** Who a seeker wants in the flat as a whole, as opposed to in their own room. */
    public static final Set<String> FLAT_PREF = Set.of("any", "women", "men");

    /** Whether the seeker wants a room to themselves. */
    public static final Set<String> ROOM_PREF = Set.of("any", "private", "shared");

    /** A group's join policy. {@code any} means open-join — requests auto-accept. */
    public static final Set<String> POLICY = Set.of("any", "women", "men");

    /** What the room physically is. Drives the derived attached-bathroom answer. */
    public static final Set<String> ROOM_KIND = Set.of("master", "bedroom", "living");

    /** Private or shared occupancy of the room itself. Contract spells these with a capital and a space. */
    public static final Set<String> ROOM_TYPE = Set.of("Private room", "Shared room");

    public static final Set<String> ATTACHED_BATH = Set.of("attached", "shared");

    /** Whether {@code budget} is per room or per person. Getting this wrong misprices every card. */
    public static final Set<String> PRICE_BASIS = Set.of("room", "person");

    public static final Set<String> FURNISHING = Set.of("unfurnished", "semi", "furnished");

    /** Bedrooms, as the room card spells them. {@code 4} means 4+, so the scale saturates there. */
    public static final Set<String> BHK = Set.of("1", "2", "3", "4");

    /** Who is letting the space. Not a trust claim on its own — see {@link #VERIFICATION_TIER}. */
    public static final Set<String> HOST_ROLE = Set.of("owner", "tenant");

    /**
     * Supply-side trust tier. Never accepted from a client: {@code FlatmateGuardrails} derives it
     * from the host's role and the proof they actually supplied, because a client that could name
     * its own tier could award itself the badge the entire trust model rests on.
     */
    public static final Set<String> VERIFICATION_TIER = Set.of("identity", "tenant", "owner");

    /** Admin moderation axis. Absent reads as {@code live}, so a never-moderated post is not special. */
    public static final Set<String> MOD_STATUS =
            Set.of("live", "approved", "flagged", "removed", "rejected");

    /** Moderation states that hide a post from every consumer surface — feed, map and alerts alike. */
    public static final Set<String> MOD_HIDDEN = Set.of("flagged", "removed", "rejected");

    /** How many people a requester intends to bring to a per-room-priced room. */
    public static final Set<String> SHARE_INTENT = Set.of("solo", "bring", "match");

    /** Whether a host must approve, or the requester is already in (open-policy group). */
    public static final Set<String> REQUEST_ACTION = Set.of("request", "join");

    public static final Set<String> REQUEST_STATUS = Set.of("pending", "accepted", "declined");

    public static final Set<String> REVIEW_STATUS = Set.of("pending", "approved", "rejected");

    /** The two feed tabs, keyed on seeker intent rather than on our storage model. */
    public static final Set<String> TAB = Set.of("move-in", "team-up");

    public static final String TAB_MOVE_IN = "move-in";
    public static final String TAB_TEAM_UP = "team-up";

    public static final String TIER_IDENTITY = "identity";
    public static final String TIER_TENANT = "tenant";
    public static final String TIER_OWNER = "owner";

    public static final String ROLE_OWNER = "owner";
    public static final String POLICY_OPEN = "any";
    public static final String STATUS_PENDING = "pending";
    public static final String MOD_LIVE = "live";

    /**
     * Deprecated {@code ?view=} values, kept as read aliases.
     *
     * <p>Old deep links, saved alerts and notification links all carry these. Resolving them beats
     * falling back to the default tab, which would silently show somebody the wrong half of the
     * market and look like their filter had been forgotten.
     */
    public static String resolveTab(String tab, String legacyView) {
        if (tab != null && !tab.isBlank()) {
            return require(tab.strip(), TAB, "tab");
        }
        if (legacyView == null || legacyView.isBlank()) {
            return TAB_MOVE_IN;
        }
        return switch (legacyView.strip()) {
            case "rooms" -> TAB_MOVE_IN;
            case "flatmates", "groups" -> TAB_TEAM_UP;
            default -> TAB_MOVE_IN;
        };
    }

    /**
     * Validate a supplied value against its vocabulary, or fall back to {@code fallback} when the
     * caller said nothing. Blank is treated as absent — an empty string in a JSON body is a client
     * that rendered "no selection", not a person choosing the empty option.
     */
    public static String orDefault(String value, Set<String> allowed, String fallback, String field) {
        String trimmed = blankToNull(value);
        return trimmed == null ? fallback : require(trimmed, allowed, field);
    }

    /**
     * Validate an optional value, preserving null. Distinct from {@link #orDefault}: null here means
     * "no preference recorded", which is a different fact from the explicit {@code any}.
     */
    public static String optional(String value, Set<String> allowed, String field) {
        String trimmed = blankToNull(value);
        return trimmed == null ? null : require(trimmed, allowed, field);
    }

    public static String require(String value, Set<String> allowed, String field) {
        if (!allowed.contains(value)) {
            // Names the field and lists the vocabulary: a caller who mistyped one value should not
            // have to open the contract to find out what the accepted ones were.
            throw new BadRequestException(
                    "Unknown " + field + ": '" + value + "'. Expected one of "
                            + String.join(", ", allowed.stream().sorted().toList()) + ".");
        }
        return value;
    }

    public static String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value.strip();
    }

    /**
     * A requested filter value, or {@code null} when the caller expressed no preference. Both a
     * blank and the literal {@code any} collapse to {@code null}, because on the query side
     * {@code any} means "show me everyone" — not "show me only the rooms that themselves said
     * {@code any}". A row that stated {@code any} openness is matched by the query's own
     * {@code or col = 'any'} clause, not by the filter. This mirrors the mock provider, where
     * {@code if (v && v !== 'any')} is the guard on every preference facet; without it, asking for
     * "any gender" would paradoxically return only the no-preference rooms.
     */
    public static String facetOrNull(String value) {
        String trimmed = blankToNull(value);
        return POLICY_OPEN.equals(trimmed) ? null : trimmed;
    }
}
