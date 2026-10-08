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

/** A merge is a pointer (see {@link Society#getMergedInto()}); chains are refused both ways so {@code merged_into} stays one hop
 * and every undo is exact. Merges and undos are audited because an undo erases the evidence in the row. */
@Service
@Transactional
public class SocietyMergeService {

    /** Three names keep the refusal readable at a glance; one or two merges is a correction, a dozen a decision to reconsider. */
    private static final int NAMED_IN_REFUSAL = 3;

    private final SocietyRepository societies;
    private final AuditService audit;

    public SocietyMergeService(SocietyRepository societies, AuditService audit) {
        this.societies = societies;
        this.audit = audit;
    }

    /** The only surface where an operator can find a merge to undo: a merged-away society is absent from the directory and its slug resolves to the survivor. */
    @Transactional(readOnly = true)
    public Page<SocietyMergeResponse> list(Pageable pageable) {
        Page<Society> page = societies.merged(pageable);
        return page.map(this::describe);
    }

    /** Records {@code from} as a duplicate of {@code into}; refused for unknown slugs (404), the same society (422), or a side already in a merge (409). */
    public SocietyMergeResponse merge(SocietyMergeRequest request, AuthPrincipal operator) {
        Society loser = require(request.from());
        Society survivor = require(request.into());

        if (loser.getId().equals(survivor.getId())) {
            // Also a CHECK constraint: a self-pointing row loops resolution forever; caught here to avoid a 500.
            throw new ValidationException("A society cannot be merged into itself.");
        }

        if (survivor.getArchivedAt() != null) {
            throw new ConflictException(survivor.getName() + " has been retired from the catalogue. Merge into a live society.");
        }

        // Forward chain: the survivor is a duplicate, so naming the real one makes the 409 actionable.
        if (survivor.getMergedInto() != null) {
            Society real = SocietyMergePointer.survivor(societies, survivor);
            throw new ConflictException(survivor.getName() + " is itself merged into "
                    + real.getName() + " (" + real.getSlug() + "). Merge into that one instead.");
        }

        // Backward chain: re-pointing absorbed duplicates would leave undo unable to restore them;
        // the refusal names up to three of them so the operator can act, and counts the rest.
        List<Society> absorbed = societies.findByMergedIntoOrderByMergedAtDesc(loser.getId());
        if (!absorbed.isEmpty()) {
            throw new ConflictException(loser.getName() + " already has " + absorbed.size()
                    + " society(s) merged into it (" + namesOf(absorbed)
                    + "). Undo those merges before merging it away.");
        }

        if (societies.recordMerge(loser.getId(), survivor.getId(), operator.userId()) == 0) {
            // Lost a race with another operator: re-read to name the society that won,
            // as the two operators may have chosen opposite directions.
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

    /** Keyed by the merged-away slug: a survivor may have absorbed several duplicates.
     * Not merged → 404, not 409, because the resource being deleted is the merge itself. */
    public void undo(String slug, AuthPrincipal operator) {
        Society loser = require(slug);
        if (loser.getMergedInto() == null) {
            throw NotFoundException.of("Merge");
        }
        Society survivor = SocietyMergePointer.survivor(societies, loser);

        if (societies.undoMerge(loser.getId()) == 0) {
            // Another operator undid it concurrently; return before an audit entry that would be false.
            return;
        }

        // The merge pointer is gone after undo, so the audit entry is the only record of what was merged.
        audit.record(operator, "society.unmerge", "society", loser.getSlug(),
                "wasMergedInto", survivor.getSlug(),
                "name", loser.getName());
    }

    /** A society by slug, or a 404 naming the thing the caller asked for. */
    private Society require(String slug) {
        return societies.findBySlug(slug == null ? null : slug.trim())
                .orElseThrow(() -> NotFoundException.of("Society"));
    }

    /** One extra read per row is fine for a small back-office list; it becomes a join if the page fills up. */
    private SocietyMergeResponse describe(Society merged) {
        Society survivor = SocietyMergePointer.survivor(societies, merged);
        return new SocietyMergeResponse(merged.getSlug(), merged.getName(),
                survivor.getSlug(), survivor.getName(), merged.getMergedAt(), merged.getMergedBy());
    }

    /** The slug travels with the name because duplicates commonly share a name, which alone isn't actionable. */
    private static String namesOf(List<Society> rows) {
        String named = rows.stream().limit(NAMED_IN_REFUSAL)
                .map(s -> s.getName() + " (" + s.getSlug() + ")")
                .collect(Collectors.joining(", "));
        int rest = rows.size() - Math.min(rows.size(), NAMED_IN_REFUSAL);
        return rest == 0 ? named : named + " and " + rest + " more";
    }
}
