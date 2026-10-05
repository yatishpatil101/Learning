package com.draazy.api.moderation.note;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

// /admin/notes — what the team knows about a case. Three operations over one table serving four entity families.
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

    @GetMapping(Routes.Moderation.NOTES_FOR_ENTITY)
    @PreAuthorize(NOTES_READ)
    public List<InternalNoteResponse> list(@CurrentUser AuthPrincipal principal,
            @PathVariable String entityType, @PathVariable String entityId) {
        return service.list(principal, entityType, entityId);
    }

    // Author comes from the principal, not the request body.
    @PostMapping(Routes.Moderation.NOTES_FOR_ENTITY)
    @PreAuthorize(NOTES_WRITE)
    @ResponseStatus(HttpStatus.CREATED)
    public InternalNoteResponse add(@CurrentUser AuthPrincipal principal,
            @PathVariable String entityType, @PathVariable String entityId,
            @Valid @RequestBody NoteCreateRequest body) {
        return service.add(principal, entityType, entityId, body.action(), body.text());
    }

    // text is @NotBlank so action-only notes cannot render as empty bullets.
    public record NoteCreateRequest(
            @NotBlank @Size(max = 4000) String text,
            @Size(max = 60) String action) {
    }
}
