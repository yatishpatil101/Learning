package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.error.BadRequestException;
import java.util.Set;

/** The closed vocabularies of the flatmate domain. Each is also a V27 {@code CHECK} — the constraint
 * is the guarantee, this class is the message. Why: docs/system/data-model.md. */
public final class FlatmateVocabulary {

    private FlatmateVocabulary() {
    }

    /** Who a seeker or host will share with. {@code any} is a stated openness, not an absence. */
    public static final Set<String> GENDER = Set.of("any", "male", "female");

    /** Dietary preference. Note {@code nonveg}, one word — the schema spells it without a hyphen. */
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

    /** How a running bill sits against the quoted rent. Null is a fourth state the host never
     * stated. */
    public static final Set<String> BILLING = Set.of("included", "shared", "separate");

    /** Bedrooms, as the room card spells them. {@code 4} means 4+, so the scale saturates there. */
    public static final Set<String> BHK = Set.of("1", "2", "3", "4");

    /** Spelled as the card renders it. A row house is not an independent house to anyone shopping
     * for one, so they are separate tokens. */
    public static final Set<String> HOME_TYPE =
            Set.of("Flat", "Independent House", "Villa", "Row House");

    /** Who is letting the space. Not a trust claim on its own — see {@link #VERIFICATION_TIER}. */
    public static final Set<String> HOST_ROLE = Set.of("owner", "tenant");

    /** Never accepted from a client — {@code FlatmateGuardrails} derives it, because a client naming
     * its own tier could award itself the badge the trust model rests on. */
    public static final Set<String> VERIFICATION_TIER = Set.of("identity", "tenant", "owner");

    /** {@code pending} is where everything starts and carries no accusation — why the board is gated
     * rather than cleaned up after: docs/system/data-model.md. */
    public static final Set<String> MOD_STATUS =
            Set.of("pending", "live", "approved", "flagged", "removed", "rejected");

    /** A whitelist, deliberately: stated the other way round a newly added sixth state would be
     * public until someone remembered to hide it. */
    public static final Set<String> MOD_PUBLIC = Set.of("live", "approved");

    /** How many people a requester intends to bring to a per-room-priced room. */
    public static final Set<String> SHARE_INTENT = Set.of("solo", "bring", "match");

    /** Whether a host must approve, or the requester is already in (open-policy group). */
    public static final Set<String> REQUEST_ACTION = Set.of("request", "join");

    public static final Set<String> REQUEST_STATUS = Set.of("pending", "accepted", "declined");

    /** {@link #REQUEST_STATUS} minus {@code pending}, so a decided application cannot be quietly
     * un-decided. */
    public static final Set<String> DECISION = Set.of("accepted", "declined");

    public static final Set<String> REVIEW_STATUS = Set.of("pending", "approved", "rejected");

    /** A predicate the feed service and both feed repositories match on, not a payload. */
    public static final String STATUS_APPROVED = "approved";

    /** The expiry sweep writes this without a human, so the spelling is shared by a route and a
     * scheduled job. */
    public static final String STATUS_REJECTED = "rejected";

    /** The two feed tabs, keyed on seeker intent rather than on our storage model. */
    public static final Set<String> TAB = Set.of("move-in", "team-up");

    public static final String TAB_MOVE_IN = "move-in";
    public static final String TAB_TEAM_UP = "team-up";

    public static final String TIER_IDENTITY = "identity";
    public static final String TIER_TENANT = "tenant";
    public static final String TIER_OWNER = "owner";

    public static final String ROLE_OWNER = "owner";

    /** Spelled differently from a room's or a post's {@code gender} and translated where they meet —
     * see {@link FlatmateSearchQuery#policy()}. */
    public static final String POLICY_OPEN = "any";

    public static final String POLICY_WOMEN = "women";
    public static final String POLICY_MEN = "men";
    public static final String STATUS_PENDING = "pending";
    public static final String MOD_LIVE = "live";

    /** Shares a spelling with {@link #STATUS_PENDING}, not a meaning: that one is about a person. */
    public static final String MOD_PENDING = "pending";

    /** Whether a row in this moderation state may be shown to somebody other than its author. */
    public static boolean isPublic(String modStatus) {
        return MOD_PUBLIC.contains(modStatus);
    }

    /** Deprecated {@code ?view=} values, kept as read aliases so old deep links and saved alerts
     * resolve to the right tab rather than the wrong half of the market. */
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

    /** Blank is absent — an empty string in a JSON body is a client rendering "no selection", not a
     * choice. */
    public static String orDefault(String value, Set<String> allowed, String fallback, String field) {
        String trimmed = blankToNull(value);
        return trimmed == null ? fallback : require(trimmed, allowed, field);
    }

    /** Distinct from {@link #orDefault}: null means "no preference recorded", a different fact from
     * the explicit {@code any}. */
    public static String optional(String value, Set<String> allowed, String field) {
        String trimmed = blankToNull(value);
        return trimmed == null ? null : require(trimmed, allowed, field);
    }

    public static String require(String value, Set<String> allowed, String field) {
        if (!allowed.contains(value)) {
            // Lists the vocabulary so a caller who mistyped need not open the contract.
            throw new BadRequestException(
                    "Unknown " + field + ": '" + value + "'. Expected one of "
                            + String.join(", ", allowed.stream().sorted().toList()) + ".");
        }
        return value;
    }

    public static String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value.strip();
    }

    /** The literal {@code any} collapses to null too, since rows stating {@code any} are matched by
     * the query's own {@code or col = 'any'}. */
    public static String facetOrNull(String value) {
        String trimmed = blankToNull(value);
        return POLICY_OPEN.equals(trimmed) ? null : trimmed;
    }
}
