package com.draazy.api.services.support;

import com.draazy.api.common.attachment.MessageAttachmentDto;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

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
        return service.reply(principal, id, body.body(), body.attachments());
    }

    /**
     * {@code POST /support/tickets/{id}/attachments} (contract {@code attachToSupportTicket}) — 201.
     *
     * <p>Multipart, with {@code consumes} pinned so a JSON body is refused with 415 by the routing
     * table rather than by handler code. Guarded by the ticket's own rule — the raiser or ops — so
     * an operator working a ticket can attach a screenshot back to the customer.
     */
    @PostMapping(value = Routes.SupportTickets.ATTACHMENTS,
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public MessageAttachmentDto attach(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestParam("file") MultipartFile file) {
        return service.attach(principal, id, file);
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
     * <p>{@code attachments} names uploads the caller already made against this ticket via
     * {@link #attach} (D49) — attachment ids, never URLs, because a client-supplied location stored
     * and re-served by the platform is a request-forgery surface. The service refuses any id that is
     * not the caller's own, on this ticket, and unsent.
     *
     * <p>Note this is the <em>support</em> {@code MessageCreate}; the service-request thread's
     * {@code MessageRequest} is a different record and still has no attachments, which is why the
     * contract gives that surface its own schema.
     */
    public record MessageCreate(
            @NotBlank @Size(max = 4000) String body,
            @Size(max = 5, message = "A message can carry at most 5 attachments")
            List<String> attachments) {
    }
}
