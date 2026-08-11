package com.punenest.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;

import com.punenest.api.common.error.ConflictException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The 409 sub-code marker is the <em>last</em> thing in the message, for both sub-codes.
 *
 * <p><strong>Why this is a test and not a comment.</strong> Both flatmate conflicts serialise as
 * {@code error: "conflict"}, so the reason travels inside the prose as a trailing {@code (marker)}
 * and the client lifts it out with an end-anchored pattern. "Last" is therefore a contract, and
 * before D182 it was pinned by exactly one assertion that said {@code contains} — which is true of
 * a message with the marker in the middle, and true of a message with a full stop, a trace id or an
 * i18n wrapper bolted on after it. Every one of those changes would have shipped green and turned
 * the benign duplicate back into a red "something went wrong" on the client, which is the precise
 * regression D181 had just removed. {@code group_full} was pinned by nothing at all.
 *
 * <p><strong>Why the client's own pattern is reproduced here.</strong> Asserting {@code endsWith}
 * alone would still pass a message the client cannot parse — say one where the marker had picked up
 * a capital or a hyphen, because {@code conflictSubCode} matches {@code [a-z_]+} and nothing else.
 * Running the real expression is the only way this side can fail for the reason the other side
 * would. It is copied rather than shared because there is no mechanism to share a regex across the
 * two runtimes; the copy is annotated at both ends so an edit to either is visibly an edit to a
 * contract. If the two ever drift, this test is what says so.
 *
 * <p>Plain JUnit, no Spring: {@link FlatmateConflicts} has no collaborators, and the endpoint-level
 * proof that the services actually route through it lives in {@code FlatmateSeekerEndpointsTest},
 * {@code FlatmateSupplyEndpointsTest} and {@code FlatmateDuplicateInterestRaceTest}.
 */
@DisplayName("The 409 sub-code marker, as the client parses it")
class FlatmateConflictsTest {

    /**
     * {@code conflictSubCode} in {@code frontend/src/services/providers/http/flatmateMapper.js},
     * character for character. Anchored at the end, and lower-case-or-underscore only.
     */
    private static final Pattern CLIENT_MARKER = Pattern.compile("\\s*\\(([a-z_]+)\\)\\s*$");

    private static String subCodeAsClientSeesIt(ConflictException refusal) {
        Matcher hit = CLIENT_MARKER.matcher(refusal.getMessage());
        return hit.find() ? hit.group(1) : null;
    }

    @Test
    @DisplayName("a repeat ask ends with (already_interested) and the client can read it")
    void alreadyInterestedMarkerIsLast() {
        ConflictException refusal = FlatmateConflicts.alreadyInterested(
                "You have already sent this host a request — your earlier message is with them.");

        assertThat(refusal.getMessage())
                .as("the client anchors on the end of the string, so nothing may follow the marker")
                .endsWith("(" + FlatmateConflicts.ALREADY_INTERESTED + ")");
        assertThat(subCodeAsClientSeesIt(refusal))
                .as("the marker has to survive the client's own pattern, not just an endsWith")
                .isEqualTo(FlatmateConflicts.ALREADY_INTERESTED);
    }

    @Test
    @DisplayName("a full group ends with (group_full) and the client can read it")
    void groupFullMarkerIsLast() {
        ConflictException refusal = FlatmateConflicts.groupFull("This group is full.");

        assertThat(refusal.getMessage())
                .endsWith("(" + FlatmateConflicts.GROUP_FULL + ")");
        assertThat(subCodeAsClientSeesIt(refusal))
                .as("group_full is the one the board reacts to; before D182 nothing pinned it")
                .isEqualTo(FlatmateConflicts.GROUP_FULL);
    }

    /**
     * The prose still reaches the reader.
     *
     * <p>The client strips the marker and renders what is left, so a refusal that were nothing but
     * a marker would parse perfectly and say nothing to the person who pressed the button.
     */
    @Test
    @DisplayName("the sentence the caller wrote is still in front of the marker")
    void theProseSurvives() {
        ConflictException refusal = FlatmateConflicts.groupFull("This group is full.");

        assertThat(refusal.getMessage()).startsWith("This group is full.");
        assertThat(refusal.getMessage().replaceAll("\\s*\\([a-z_]+\\)\\s*$", ""))
                .as("what the client renders after stripping the routing token")
                .isEqualTo("This group is full.");
    }

    /**
     * A trailing space in a call site's literal does not open a gap in the middle of the message.
     *
     * <p>Cheap to get wrong (`"...them. "` reads identically in a diff) and the client's pattern
     * happens to tolerate it today — but only because of the leading {@code \s*}. Pinning the
     * normalisation means the wire form does not depend on that tolerance.
     */
    @Test
    @DisplayName("a sloppy trailing space in the prose is normalised away")
    void proseIsStripped() {
        assertThat(FlatmateConflicts.groupFull("This group is full.   ").getMessage())
                .isEqualTo("This group is full. (group_full)");
    }
}
