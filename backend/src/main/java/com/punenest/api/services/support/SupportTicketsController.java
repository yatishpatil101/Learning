package com.punenest.api.services.support;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /support/tickets} — the customer-facing half of support.
 *
 * <p>No {@code @PreAuthorize}: every guard here is "is this your ticket, or are you ops", which is a
 * question about the row and not about the role alone. The service owns it.
 *
 * <p>The list is a bare array per {@code api-standards.md} §5.1 — it grows with one user's own
 * support history. That is only true because S47 narrowed the operation to the caller's own tickets;
 * the platform-wide view is paged, and lives on {@link AdminSupportTicketsController} (D51).
 */
@RestController
public class SupportTicketsController {

    private final SupportTicketService service;

    public SupportTicketsController(SupportTicketService service) {
        this.service = service;
    }

    /** {@code GET /support/tickets} (contract {@code listSupportTickets}, spec fix S47). */
    @GetMapping(Routes.SupportTickets.BASE)
    public List<SupportTicketDto> list(@CurrentUser AuthPrincipal principal) {
        return service.list(principal);
    }

    /** {@code POST /support/tickets} (contract {@code createSupportTicket}) — 201. */
    @PostMapping(Routes.SupportTickets.BASE)
    @ResponseStatus(HttpStatus.CREATED)
    public SupportTicketDto create(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody SupportTicketCreate body) {
        return service.create(principal, body);
    }

    /** {@code GET /support/tickets/{id}} (contract {@code getSupportTicket}). */
    @GetMapping(Routes.SupportTickets.BY_ID)
    public SupportTicketDto get(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.get(principal, id);
    }

    /** {@code POST /support/tickets/{id}/messages} (contract {@code replySupportTicket}, S46) — 201. */
    @PostMapping(Routes.SupportTickets.MESSAGES)
    @ResponseStatus(HttpStatus.CREATED)
    public MessageDto reply(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody MessageCreate body) {
        return service.reply(principal, id, body.body());
    }

    /** {@code POST /support/tickets/{id}/read} (contract {@code markSupportTicketRead}) — 204. */
    @PostMapping(Routes.SupportTickets.READ)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markRead(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.markRead(principal, id);
    }

    /**
     * Contract schema {@code MessageCreate}.
     *
     * <p>{@code attachments} is absent for the same reason as on the service-request thread: there is
     * no upload surface behind it, so the field is accepted and dropped rather than stored as a
     * client-supplied URL nothing can render.
     */
    public record MessageCreate(@NotBlank @Size(max = 4000) String body) {
    }
}
