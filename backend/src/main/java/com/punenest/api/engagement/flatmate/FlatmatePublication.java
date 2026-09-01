package com.punenest.api.engagement.flatmate;

import com.punenest.api.security.AuthPrincipal;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;
import org.springframework.stereotype.Component;

/**
 * Decides where a flatmate post lands: on the board, or in the D72 backlog.
 *
 * <p><strong>Read this together with the review queue.</strong> Publication and verification answer
 * two different questions and the answers deliberately disagree. This class decides
 * <em>visibility</em> — may a stranger see the post at all. The review queue decides
 * <em>verification</em> — does a human have to read the host's paperwork. A tenant-tier post is live
 * and unbadged: the board shows it, and Ops confirms the agreement afterwards. Splitting the two is
 * what lets the queue be about evidence rather than about traffic.
 *
 * <p>Its own class because the decision is now made from two directions — when a post is written
 * and again when it is edited — and the edit path has to make it <em>differently</em> without
 * drifting from the create path. Leaving both inside the supply service put the trap in
 * {@link #reapplyAfterEdit} next to two hundred lines of unrelated orchestration, where the wrong
 * thing to copy sits three screens above the right one.
 */
@Component
class FlatmatePublication {

    private final FlatmateGuardrails guardrails;
    private final FlatmateReviewRepository reviews;

    FlatmatePublication(FlatmateGuardrails guardrails, FlatmateReviewRepository reviews) {
        this.guardrails = guardrails;
        this.reviews = reviews;
    }

    /**
     * Queue an Ops review when the post makes a claim a human has to check, or refresh the one
     * already queued.
     *
     * <p>Owner-tier posts never enter the queue — they were vetted through the parent listing's own
     * documents, and reviewing the same evidence twice costs Ops real time for nothing.
     *
     * <p><strong>One row per target, updated in place.</strong> {@code uq_flatmate_reviews_room}
     * and its group twin are unique on the target, which is right — a queue with the same flat in
     * it four times is a queue nobody trusts. But it also means the edit paths cannot simply file
     * another row the way the create paths do. When they tried, the constraint came back as a 409
     * and <em>every edit of an agreement-backed post was impossible</em>, which is a create-path
     * habit producing an error the host can neither understand nor act on.
     *
     * <p>Re-opening rather than leaving the standing verdict alone, because a moderator's "yes" was
     * about facts the edit may have just changed — the address, the claimed role, the document
     * behind it. See {@link FlatmateReview#reopenAfterEdit} for what survives that: the badge does,
     * so fixing a typo never silently costs a host the trust they earned.
     */
    void enqueueReviewIfNeeded(AuthPrincipal caller, String kind, UUID roomId, UUID groupId,
            String tier, boolean flagged, Map<String, Object> agreementDoc, String address,
            boolean ownerConsent) {
        if (FlatmateVocabulary.TIER_OWNER.equals(tier)) {
            return;
        }
        boolean needsReview = FlatmateVocabulary.TIER_TENANT.equals(tier) || flagged;
        if (!needsReview) {
            return;
        }
        var standing = roomId != null ? reviews.findByRoomId(roomId) : reviews.findByGroupId(groupId);
        if (standing.isPresent()) {
            standing.get().reopenAfterEdit(address, tier, flagged, ownerConsent, agreementDoc);
            reviews.saveAndFlush(standing.get());
            return;
        }
        reviews.saveAndFlush(new FlatmateReview(kind, roomId, groupId, caller.userId(), address,
                tier, flagged, ownerConsent, agreementDoc));
    }

    /**
     * Where a freshly written post starts.
     *
     * <p>Every post used to start {@code pending} and nothing ever published one, so the board only
     * filled at the speed Ops clicked. That is defensible for a moderated noticeboard and fatal for
     * a marketplace: a host posts, sees their own card, tells a friend, and the friend finds
     * nothing. The tier ladder already ranks exactly the thing the gate was guessing at, so use it.
     *
     * <ul>
     *   <li><strong>owner</strong> — publishes. The parent listing was approved by Ops, which is
     *       the same check, already done, against better evidence.</li>
     *   <li><strong>tenant</strong> — publishes. The host staked a registered agreement on it, and
     *       the review queue puts that claim in front of a human either way.</li>
     *   <li><strong>identity</strong> — waits. Signed in and nothing more asserted is precisely the
     *       population the gate is for, and it is the cheap identity for a broker to mint.</li>
     * </ul>
     *
     * <p>{@code flagged} overrides the tier rather than being folded into it. The guardrail fires on
     * a duplicate address fingerprint or a host at the posting cap — signals about
     * <em>behaviour</em>, which a good tier does not excuse. An owner posting the same flat from
     * three accounts is the case worth catching, and it is the one a tier-only rule would wave
     * through.
     */
    String stateFor(String tier, boolean flagged) {
        if (flagged || FlatmateVocabulary.TIER_IDENTITY.equals(tier)) {
            return FlatmateVocabulary.MOD_PENDING;
        }
        return FlatmateVocabulary.MOD_LIVE;
    }

    /**
     * Re-run the trust decision after an edit, and put the post back where it now belongs.
     *
     * <p>Shared by the room and group edit paths because getting it wrong in one and not the other
     * is the likely failure, and there are two things here that are easy to get wrong.
     *
     * <p><strong>1. The eligibility result is read for its flag, never for its verdict.</strong>
     * {@link FlatmateGuardrails#evaluate} answers "may this host publish a new post at this
     * address", and both halves of {@code blocked} are guaranteed true for a post that already
     * exists: the host is over the cap partly <em>because of this row</em>, and the address is a
     * duplicate <em>of itself</em>. Honouring {@code blocked()} here — the obvious thing to copy
     * from the create path — would make every edit by a host at the cap a 409, and every edit of any
     * post a duplicate. So only {@code flagForReview} and the fingerprint are taken, and
     * {@code flagForReview} is the one signal in that record genuinely about somebody else: it means
     * a <em>different</em> host is claiming this address.
     *
     * <p><strong>2. An edit re-enters the ladder rather than always dropping to pending.</strong>
     * The rule this implements is "an edit sends the post back for review", and for the tier that
     * rule is about — {@code identity}, the one whose visibility was granted by a human clicking —
     * that is exactly what happens: {@link #stateFor} returns {@code pending} and the post leaves
     * the board until Ops looks again. Sending an owner-tier post to pending too would be theatre
     * with a cost: their visibility never came from a moderator reading the copy, it came from an
     * approved title deed, so there is no approval for an edit to invalidate and nothing for a
     * reviewer to compare it against. It would only rebuild the queue that auto-publish exists to
     * drain, and it would teach hosts not to fix their typos.
     *
     * <p>The tier itself is re-derived by the caller before this runs, so an edit that drops the
     * property or retracts the agreement claim falls down the ladder and lands in the queue on its
     * own — which is the case where an edit really does need re-checking, and it is handled by the
     * ladder rather than by a special rule.
     */
    void reapplyAfterEdit(AuthPrincipal caller, String tier, Consumer<String> fingerprint,
            Consumer<Boolean> flag, Consumer<String> modStatus,
            FlatmateGuardrails.Address address) {
        var eligibility = guardrails.evaluate(caller.userId(), tier, address);
        fingerprint.accept(eligibility.fingerprint());
        flag.accept(eligibility.flagForReview());
        modStatus.accept(stateFor(tier, eligibility.flagForReview()));
    }
}
