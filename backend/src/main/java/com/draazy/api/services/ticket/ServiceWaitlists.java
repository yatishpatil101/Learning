package com.draazy.api.services.ticket;

import com.draazy.api.security.Teams;
import java.util.Map;

/**
 * The services a stranger may ask to be told about, and the desk that will do the telling (D4).
 *
 * <p><strong>A closed set, not free text.</strong> {@code POST /service-waitlist} is unauthenticated,
 * so every field on it is a string an attacker chooses. The {@code service} could have been accepted
 * as a bounded label and stored — that is what {@code city_waitlist} does with {@code city} — but the
 * two cases are opposites. A city waitlist is for cities the platform does <em>not</em> have, so
 * there is nothing to check the value against; a service waitlist is for a service the platform
 * <em>does</em> have and has not launched, so there is. Accepting free text where a closed set exists
 * would put attacker-chosen prose in the subject line of a row a human reads and acts on.
 *
 * <p><strong>The team is derived here, not sent.</strong> A caller who could name the team could put
 * a lead on any desk in the company — legal, loans, valuation — which is not a lead, it is a way to
 * page whoever is on duty. The map is the whole authority: adding a service means adding a line, and
 * a line is reviewable in a way that a request field is not.
 *
 * <p>The subject is likewise fixed per service rather than composed from the request, so every row
 * this endpoint writes is one of a handful of known strings. That is what makes the idempotency
 * check in {@code TicketService.joinWaitlist} possible at all: it recognises a repeat by matching
 * the subject, which only works because the subject is not the caller's to vary.
 */
public final class ServiceWaitlists {

    /** The Move-in Pack, whose "coming soon" panel is the only surface using this today. */
    public static final String MOVE_IN_PACK = "move-in-pack";

    /**
     * Slug to the desk that owns the follow-up call.
     *
     * <p>{@link Teams} rather than a literal, so a team renamed there cannot leave this file
     * pointing at a value the {@code tickets_team_check} constraint will reject at insert time —
     * which on this path would be a 500 on a public endpoint.
     */
    private static final Map<String, String> TEAMS = Map.of(MOVE_IN_PACK, Teams.PACKERS);

    /** Slug to the ticket subject ops will see on the board. Fixed, never composed from input. */
    private static final Map<String, String> SUBJECTS =
            Map.of(MOVE_IN_PACK, "Move-in Pack — waitlist");

    private ServiceWaitlists() {
    }

    /** True when {@code slug} is a service somebody may join a waitlist for. */
    public static boolean isKnown(String slug) {
        return slug != null && TEAMS.containsKey(slug);
    }

    /** The desk that owns {@code slug}. Call {@link #isKnown} first. */
    public static String teamFor(String slug) {
        return TEAMS.get(slug);
    }

    /** The board subject for {@code slug}. Call {@link #isKnown} first. */
    public static String subjectFor(String slug) {
        return SUBJECTS.get(slug);
    }
}
