package com.punenest.api.moderation.note;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /admin/notes} — what the team knows about a case (D29).
 *
 * <p>Three operations over one table serving four entity families. One controller rather than a
 * notes route bolted onto each of the four moderation controllers: notes have one audience, one
 * shape and one pair of permission atoms, and four copies of that is four chances for one to drift.
 *
 * <p>Every route is staff/admin <em>and</em> carries the matching atom. Read and write are separate
 * atoms because they are separate jobs — the same split {@code /reports} makes, and for the same
 * reason: more people should be able to read a case file than to add to it.
 *
 * <p>No DELETE, and that is a decision rather than an omission. A note records that somebody on the
 * team knew something at a point in time; the honest way to withdraw it is to correct it, which is
 * what {@link #edit} is for and which is audited with the previous wording.
 */
@RestController
public class InternalNoteController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";
    private static final String NOTES_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_NOTES_READ;
    private static final String NOTES_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_NOTES_WRITE;

    private final InternalNoteService service;

    public InternalNoteController(InternalNoteService service) {
        this.service = service;
    }

    /**
     * {@code GET /admin/notes/{entityType}/{entityId}} (contract {@code listInternalNotes},
     * {@code x-roles: [staff, admin]}) — newest first.
     *
     * <p>A bare array, not a page envelope. Per api-standards.md §5.1 the envelope is for
     * collections that grow with the platform; this one grows with a single case's history, and a
     * moderator opening a listing with forty notes wants the forty.
     */
    @GetMapping(Routes.Moderation.NOTES_FOR_ENTITY)
    @PreAuthorize(NOTES_READ)
    public List<InternalNoteResponse> list(@PathVariable String entityType,
            @PathVariable String entityId) {
        return service.list(entityType, entityId);
    }

    /**
     * {@code POST /admin/notes/{entityType}/{entityId}} (contract {@code addInternalNote},
     * {@code x-roles: [staff, admin]}) — 201.
     *
     * <p>The author comes from the principal. There is no author field on the body and there will
     * not be one.
     */
    @PostMapping(Routes.Moderation.NOTES_FOR_ENTITY)
    @PreAuthorize(NOTES_WRITE)
    @ResponseStatus(HttpStatus.CREATED)
    public InternalNoteResponse add(@CurrentUser AuthPrincipal principal,
            @PathVariable String entityType, @PathVariable String entityId,
            @Valid @RequestBody NoteCreateRequest body) {
        return service.add(principal, entityType, entityId, body.action(), body.text());
    }

    /**
     * {@code PATCH /admin/notes/{id}} (contract {@code editInternalNote},
     * {@code x-roles: [staff, admin]}).
     *
     * <p>Any member of staff may edit any note, not only its author — notes are how one shift hands
     * a case to the next, and a correction that has to wait for the original author is a correction
     * that does not happen. The previous wording is written to the audit log first.
     *
     * <p>{@code action} is not editable: correcting the wording of an observation is a correction,
     * and changing which decision it was filed beside is a rewrite.
     */
    @PatchMapping(Routes.Moderation.NOTE_BY_ID)
    @PreAuthorize(NOTES_WRITE)
    public InternalNoteResponse edit(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody NoteEditRequest body) {
        return service.edit(principal, id, body.text());
    }

    /**
     * Body of {@code addInternalNote}.
     *
     * <p>{@code text} is {@code @NotBlank}: the browser-side store this replaces accepted a note
     * with no text so long as it had an action label, which wrote a row that rendered as an empty
     * bullet under a colleague's name. An action with nothing to say is the audit log's job.
     */
    public record NoteCreateRequest(
            @NotBlank @Size(max = 4000) String text,
            @Size(max = 60) String action) {
    }

    /** Body of {@code editInternalNote}. */
    public record NoteEditRequest(@NotBlank @Size(max = 4000) String text) {
    }
}
