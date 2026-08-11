package com.punenest.api.services.ticket;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Capabilities;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
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

/**
 * {@code /tickets} — the ops board.
 *
 * <p><strong>{@code POST} carries no role guard and the other three do</strong>, the same asymmetry
 * as {@code /reports}: a queue only privileged people can write to collects nothing, while reading
 * and working it are ops-only. Spec fix S43 recorded the omission explicitly so that a later reader
 * "finishing the job" of adding {@code x-roles} does not sweep this one in.
 *
 * <p>Team scoping is enforced in {@link TicketService}, not here — {@code @PreAuthorize} can express
 * "is staff" but not "is on the desk that owns row X", and splitting one rule across two places is
 * how half of it gets forgotten.
 *
 * <p><strong>The two write routes additionally require the {@code update_ticket} capability</strong>
 * (tech debt D67), composed onto the role guard rather than replacing it, so the map can only take
 * the two writes away from a desk and never hand them to someone the role check refused. Reading the
 * board is left alone on purpose: a desk that may no longer act on a ticket can still need to see
 * that it exists in order to hand it on, and the rows it sees are already narrowed by the team
 * scoping above.
 */
@RestController
public class TicketsController {

    private static final String OPS = "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";
    private static final String OPS_MAY_WORK_TICKETS =
            OPS + " and " + Capabilities.REQUIRE_UPDATE_TICKET;

    private final TicketService service;

    public TicketsController(TicketService service) {
        this.service = service;
    }

    /**
     * {@code GET /tickets} (contract {@code listTickets}, {@code x-roles: [staff, admin]}) — paged.
     *
     * <p>Sort is stripped by {@link Pageables#unsorted(Pageable)}: newest-first is fixed server-side
     * and index-backed (V21), so an incoming {@code ?sort=} would otherwise be an unmapped-property
     * 500.
     */
    @GetMapping(Routes.Tickets.BASE)
    @PreAuthorize(OPS)
    public PageResponse<TicketDto> list(@CurrentUser AuthPrincipal principal,
            @RequestParam(required = false) String team,
            @RequestParam(required = false) String status,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                service.list(principal, team, status, Pageables.unsorted(pageable)), dto -> dto);
    }

    /**
     * {@code POST /tickets} (contract {@code createTicket}) — 201, schema {@code CustomerTicket}.
     * Any authenticated caller; see the class Javadoc for why there is no guard here.
     *
     * <p>The only response on this controller that a non-staff caller ever sees, and therefore the
     * only one that must not be the staff record — {@code Ticket} carries internal notes (debt D47).
     */
    @PostMapping(Routes.Tickets.BASE)
    @ResponseStatus(HttpStatus.CREATED)
    public CustomerTicketDto create(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody TicketCreate body) {
        return service.create(principal, body);
    }

    /**
     * {@code PATCH /tickets/{id}} (contract {@code updateTicket}, spec fixes S42 and S44,
     * {@code x-roles: [staff, admin]}).
     */
    @PatchMapping(Routes.Tickets.BY_ID)
    @PreAuthorize(OPS_MAY_WORK_TICKETS)
    public TicketDto update(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody TicketUpdate body) {
        return service.update(principal, id, body);
    }

    /**
     * {@code POST /tickets/{id}/notes} (contract {@code addTicketNote},
     * {@code x-roles: [staff, admin]}) — 201.
     *
     * <p>{@code attachments} is accepted and dropped: {@code ticket_notes} has no column for it and
     * the {@code Ticket} schema's note object has no field to render one. Written down here rather
     * than implied, as on the verification thread.
     */
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
