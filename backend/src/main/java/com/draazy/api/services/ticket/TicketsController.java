package com.draazy.api.services.ticket;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Capabilities;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** {@code POST} is unguarded by design, as on {@code /reports}; team scoping lives in {@link TicketService}
 * as {@code @PreAuthorize} cannot say "on the desk that owns row X". */
@RestController
public class TicketsController {

    private static final String OPS = "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";
    private static final String OPS_MAY_READ_TICKETS =
            OPS + " and " + BackOfficePermissions.REQUIRE_TICKETS_READ;
    private static final String OPS_MAY_WORK_TICKETS =
            OPS + " and " + Capabilities.REQUIRE_UPDATE_TICKET
                    + " and " + BackOfficePermissions.REQUIRE_TICKETS_WRITE;

    private final TicketService service;

    public TicketsController(TicketService service) {
        this.service = service;
    }

    /** Sort is stripped via {@link Pageables#unsorted(Pageable)}: newest-first is fixed and index-backed (V21),
     * so a client {@code ?sort=} would be an unmapped-property 500. */
    @GetMapping(Routes.Tickets.BASE)
    @PreAuthorize(OPS_MAY_READ_TICKETS)
    public PageResponse<TicketRow> list(@CurrentUser AuthPrincipal principal,
            @RequestParam(required = false) String team,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String priority,
            @RequestParam(required = false) String q,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                service.rows(principal, team, status, priority, q, Pageables.unsorted(pageable)), row -> row);
    }

    /** Counts per status for the same scope as {@code GET /tickets}, so the tabs never depend on a page. */
    @GetMapping(Routes.Tickets.SUMMARY)
    @PreAuthorize(OPS_MAY_READ_TICKETS)
    public TicketSummary summary(@CurrentUser AuthPrincipal principal,
            @RequestParam(required = false) String team) {
        return service.summary(principal, team);
    }

    /** One ticket in full, with its internal notes, value and quoted value. */
    @GetMapping(Routes.Tickets.BY_ID)
    @PreAuthorize(OPS_MAY_READ_TICKETS)
    public TicketDto get(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.get(principal, id);
    }

    /** The only response a non-staff caller sees, so it must not be the staff {@code Ticket},
     * which carries internal notes. */
    @PostMapping(Routes.Tickets.BASE)
    @ResponseStatus(HttpStatus.CREATED)
    public CustomerTicketDto create(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody TicketCreate body) {
        return service.create(principal, body);
    }

    @PatchMapping(Routes.Tickets.BY_ID)
    @PreAuthorize(OPS_MAY_WORK_TICKETS)
    public TicketDto update(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody TicketUpdate body) {
        return service.update(principal, id, body);
    }

    /** {@code attachments} is accepted and dropped: {@code ticket_notes} has no column for it
     * and the note schema has no field to render one. */
    @PostMapping(Routes.Tickets.NOTES)
    @PreAuthorize(OPS_MAY_WORK_TICKETS)
    @ResponseStatus(HttpStatus.CREATED)
    public TicketDto.Note addNote(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody NoteRequest body) {
        return service.addNote(principal, id, body.body());
    }

    /** Body of {@code addTicketNote} (schema {@code MessageCreate}). */
    public record NoteRequest(@NotBlank @Size(max = 4000) String body, List<String> attachments) {
    }
}
