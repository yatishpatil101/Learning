package com.draazy.api.leads.notes;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * The owner's private lead annotations at {@code /me/lead-notes}.
 *
 * <p><strong>Owner-scoped with nothing else in front of it.</strong> No role guard, for the same
 * reason as {@code MePhotoRequestsController}: any signed-in user becomes an owner the moment they
 * post a listing. And no ownership check on {@code leadKey} — the server does not know what a lead
 * key refers to (V119), so it cannot verify that the caller owns the lead. That sounds like a hole
 * and is not one: the note is stored under the caller's own id, so annotating a key you have no
 * business seeing writes a private string into your own row and reveals nothing. There is no read
 * path that turns a key into a lead.
 *
 * <p><strong>No {@code @Validated} on the class</strong>, deliberately, even though the bound on
 * {@code leadKey} below is a parameter constraint. Spring validates constrained controller
 * parameters natively; adding {@code @Validated} instead routes them through the AOP validator,
 * which reports the violation as {@code saveLeadNote.leadKey} — leaking a Java method name into the
 * wire and giving the client a field name it cannot match against anything it sent. Left off, the
 * same rejection arrives as a plain {@code leadKey}. No other controller in this codebase carries
 * the annotation either.
 */
@RestController
public class MeLeadNotesController {

    private final LeadNoteService leadNotes;

    public MeLeadNotesController(LeadNoteService leadNotes) {
        this.leadNotes = leadNotes;
    }

    /** Every annotation the caller has written. Unpaged on purpose — see {@link LeadNoteRepository}. */
    @GetMapping(Routes.MeLeadNotes.BASE)
    public List<LeadNoteResponse> myLeadNotes(@CurrentUser AuthPrincipal principal) {
        return leadNotes.myNotes(principal.userId());
    }

    /**
     * Write one annotation, or clear it.
     *
     * <p><strong>{@code PUT} rather than {@code PATCH}, and the body is the whole annotation.</strong>
     * The owner edits the note and the date through separate controls, so the UI produces partial
     * edits — but JSON cannot distinguish an omitted field from one cleared to null, and every
     * workaround costs more than it saves. The panel already holds the current annotation, so it
     * merges there and sends the result. See {@code LeadNote#replace}.
     *
     * <p><strong>{@code 204} means cleared.</strong> An annotation with neither field is not stored
     * as a blank row; the row is deleted, because the inbox reads "has a note" as existence.
     *
     * <p>The bound on {@code leadKey} is not a guess at what a key looks like — the server never
     * parses one — but the point past which the database stops answering in constraints. The unique
     * index is a btree, and a btree entry over 2704 bytes fails the insert with an internal error,
     * so an authenticated caller sending a 3000-character key would get a 500 from a code path
     * nobody wrote. 200 is a little over three times the longest key the client mints today
     * ({@code 'documents:<buyerMobile>|<propertyId>'}, 57 characters with a UUID property id), which
     * leaves room for a fifth lead source without leaving room for abuse. V119 carries the same
     * bound as a CHECK, so it survives a writer that never passes through here.
     */
    @PutMapping(Routes.MeLeadNotes.BY_KEY)
    public ResponseEntity<LeadNoteResponse> saveLeadNote(@CurrentUser AuthPrincipal principal,
            @PathVariable @Size(max = 200) String leadKey, @Valid @RequestBody LeadNoteUpsert body) {
        return leadNotes.save(principal.userId(), leadKey, body.note(), body.followUpAt())
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    /**
     * The whole annotation. Both fields nullable; both null (or a blank note) clears it.
     *
     * @param note a cap rather than a validation of content — this is the owner's private scratch
     *             space and the only thing worth refusing is a payload large enough to be an attack
     */
    public record LeadNoteUpsert(@Size(max = 2000) String note, Instant followUpAt) {
    }
}
