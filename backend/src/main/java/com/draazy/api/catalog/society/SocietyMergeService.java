package com.draazy.api.catalog.society;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.security.AuthPrincipal;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Merging a duplicate society into the one that survives it, on the server, once, for everybody.
 *
 * <p><strong>What this replaces.</strong> {@code mergeSocieties()} in {@code societyAdmin.js} wrote
 * a {@code from -> to} map into the operator's own localStorage. That is the same failure the
 * candidates queue had before V105 and the residents queue had before V110, with one extra
 * consequence: because nobody else could see the decision, a second operator opening the same queue
 * found the same untouched pair and merged it again — possibly the other way round. The browser
 * version also collapsed chains and "moved" followers and Q&A. Neither survives the move to a shared
 * database, and both are refused here rather than reimplemented; see below.
 *
 * <p><strong>The merge is a pointer.</strong> Nothing is copied, moved or deleted. The losing
 * society keeps its listings, follows, reviews, residency records and claims, and
 * {@link SocietyService} unions them onto the survivor on read, so a reader sees one complete
 * building. The argument for that is in {@link Society#getMergedInto()}: rewriting
 * {@code properties.society_id} onto the survivor would leave no record of which rows had moved, and
 * a merge would become the one ops action with no undo — on the action whose input is two rows that
 * differ by a typo.
 *
 * <p><strong>Chains are refused in both directions</strong>, and this is the design decision worth
 * arguing for. The browser version collapsed them: merging A into B, where B was already merged into
 * C, silently rewrote A to point at C. That is convenient and unrecoverable — after the rewrite,
 * nothing records that the operator chose B, so undoing B→C cannot put A back where it was. Refusing
 * instead keeps {@code merged_into} a forest of depth exactly one, which is what lets every read
 * resolve in one lookup with no loop guard and makes every undo exact. The cost is two 409s, and
 * each of them names the merge to undo first, so the operator is never guessing.
 *
 * <p><strong>Why merges are audited when the sibling ops actions are not.</strong> Mint verification
 * and claim and proposal decisions all leave their evidence in the row itself — {@code verified_by},
 * {@code decided_by} — so the row is its own record. An undo erases this one: after
 * {@code DELETE /admin/society-merges/{slug}} the three columns are null and the database no longer
 * contains any trace that the merge happened, who made it, or what it pointed at. Without an audit
 * entry, "why did this building's page look different last week" would be unanswerable. So both the
 * merge and the undo are recorded.
 */
@Service
@Transactional
public class SocietyMergeService {

    /**
     * How many absorbed societies a refusal names before it starts counting.
     *
     * <p>Three because the sentence has to stay readable at a glance and the operator's next move
     * does not change once the list is long: one or two named merges is a correction, a dozen is a
     * decision to reconsider, and both readings survive naming only the first few.
     */
    private static final int NAMED_IN_REFUSAL = 3;

    private final SocietyRepository societies;
    private final AuditService audit;

    public SocietyMergeService(SocietyRepository societies, AuditService audit) {
        this.societies = societies;
        this.audit = audit;
    }

    /**
     * Every merge currently in force, newest first.
     *
     * <p>The list is what makes the undo usable rather than merely possible: a merged-away society
     * is absent from the directory and its slug resolves to the survivor, so this is the only
     * surface on which an operator can find a decision in order to reverse it.
     */
    @Transactional(readOnly = true)
    public Page<SocietyMergeResponse> list(Pageable pageable) {
        Page<Society> page = societies.merged(pageable);
        return page.map(this::describe);
    }

    /**
     * Record that {@code from} is a duplicate of {@code into}.
     *
     * @throws NotFoundException   if either slug names no society
     * @throws ValidationException if the two slugs are the same society
     * @throws ConflictException   if either side is already part of a merge
     */
    public SocietyMergeResponse merge(SocietyMergeRequest request, AuthPrincipal operator) {
        Society loser = require(request.from());
        Society survivor = require(request.into());

        if (loser.getId().equals(survivor.getId())) {
            // Also a CHECK constraint, because a row pointing at itself is an infinite resolution
            // loop and no service-layer care survives a hand-run UPDATE. Caught here as well so the
            // operator gets a sentence instead of a constraint-violation 500.
            throw new ValidationException("A society cannot be merged into itself.");
        }

        // Forward chain. The survivor is itself a duplicate, so absorbing another society into it
        // would build a two-hop pointer. Naming the real survivor makes the 409 actionable: the
        // operator almost always wants to merge into that instead, which is one corrected request
        // rather than an investigation.
        if (survivor.getMergedInto() != null) {
            Society real = SocietyMergePointer.survivor(societies, survivor);
            throw new ConflictException(survivor.getName() + " is itself merged into "
                    + real.getName() + " (" + real.getSlug() + "). Merge into that one instead.");
        }

        // Backward chain. This society has already absorbed others, so merging it away would strand
        // them behind a second hop. Refusing keeps the undo exact -- if we re-pointed its absorbed
        // duplicates at the new survivor, undoing this merge could not put them back, because
        // nothing would record where they had been.
        //
        // The refusal names them. A count alone ("already has 1 society(s) merged into it") tells an
        // operator that work stands in their way without saying what it is, which turns a correction
        // into a search through the merge list -- and the forward-chain branch above has always
        // named the society it wants instead. Capped at three so a survivor with a long tail of
        // duplicates still yields a sentence rather than a paragraph; the remainder is counted, not
        // dropped, because "and 12 more" is the part that tells the operator to stop and think.
        List<Society> absorbed = societies.findByMergedIntoOrderByMergedAtDesc(loser.getId());
        if (!absorbed.isEmpty()) {
            throw new ConflictException(loser.getName() + " already has " + absorbed.size()
                    + " society(s) merged into it (" + namesOf(absorbed)
                    + "). Undo those merges before merging it away.");
        }

        if (societies.recordMerge(loser.getId(), survivor.getId(), operator.userId()) == 0) {
            // Lost a race with another operator, which is precisely the situation the browser
            // version could not detect. Re-read rather than guess: the useful thing to say is which
            // society won, because the two operators may have chosen opposite directions.
            Society current = SocietyMergePointer.survivor(societies, require(request.from()));
            throw new ConflictException(loser.getName() + " has already been merged into "
                    + current.getName() + " (" + current.getSlug() + ").");
        }

        audit.record(operator, "society.merge", "society", loser.getSlug(),
                "into", survivor.getSlug(),
                "name", loser.getName(),
                "intoName", survivor.getName());

        return new SocietyMergeResponse(loser.getSlug(), loser.getName(),
                survivor.getSlug(), survivor.getName(), java.time.Instant.now(), operator.userId());
    }

    /**
     * Undo a merge, addressed by the slug of the society that was merged away.
     *
     * <p>By the merged-away slug and not the survivor's, because a survivor can have absorbed
     * several duplicates and "undo the merge on this society" would then be ambiguous — and the
     * ambiguity would resolve silently to the wrong one.
     *
     * @throws NotFoundException if the slug names no society, or names one that is not merged into
     *     anything. The second is a 404 rather than a 409 on purpose: the resource being deleted is
     *     the merge, and there is no merge here to delete
     */
    public void undo(String slug, AuthPrincipal operator) {
        Society loser = require(slug);
        if (loser.getMergedInto() == null) {
            throw NotFoundException.of("Merge");
        }
        Society survivor = SocietyMergePointer.survivor(societies, loser);

        if (societies.undoMerge(loser.getId()) == 0) {
            // Another operator undid it between the read and the write. Nothing to report as an
            // error -- the caller asked for the merge to be gone and it is gone -- but the audit
            // entry below would be a lie, so return before writing it.
            return;
        }

        // The row no longer remembers any of this, which is the whole reason to write it down.
        audit.record(operator, "society.unmerge", "society", loser.getSlug(),
                "wasMergedInto", survivor.getSlug(),
                "name", loser.getName());
    }

    /** A society by slug, or a 404 naming the thing the caller asked for. */
    private Society require(String slug) {
        return societies.findBySlug(slug == null ? null : slug.trim())
                .orElseThrow(() -> NotFoundException.of("Society"));
    }

    /**
     * A merged-away row plus the society it points at.
     *
     * <p>One extra read per row, which is acceptable here and would not be on a public surface: this
     * is a back-office list of the handful of merges in force, behind {@code societies:read}, and
     * the survivors are almost always already in the persistence context because a merge list is
     * dominated by a few popular duplicates. If it ever stops being a handful, it becomes a join —
     * the trigger to watch for is the page filling up.
     */
    private SocietyMergeResponse describe(Society merged) {
        Society survivor = SocietyMergePointer.survivor(societies, merged);
        return new SocietyMergeResponse(merged.getSlug(), merged.getName(),
                survivor.getSlug(), survivor.getName(), merged.getMergedAt(), merged.getMergedBy());
    }

    /**
     * Names a handful of societies for a refusal sentence, with the remainder counted.
     *
     * <p>The slug travels with the name because the name alone is not enough to act on: duplicates
     * are the thing being merged, so two rows called "Sunview Heights" is the normal case rather
     * than the odd one, and an operator handed the name twice learns nothing.
     */
    private static String namesOf(List<Society> rows) {
        String named = rows.stream().limit(NAMED_IN_REFUSAL)
                .map(s -> s.getName() + " (" + s.getSlug() + ")")
                .collect(Collectors.joining(", "));
        int rest = rows.size() - Math.min(rows.size(), NAMED_IN_REFUSAL);
        return rest == 0 ? named : named + " and " + rest + " more";
    }
}
