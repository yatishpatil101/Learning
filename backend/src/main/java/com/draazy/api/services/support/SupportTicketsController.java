package com.draazy.api.services.support;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
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

// Caller-owned support history is a bare array; platform-wide support is paged elsewhere.
@RestController
public class SupportTicketsController {

    private final SupportTicketService service;

    public SupportTicketsController(SupportTicketService service) {
        this.service = service;
    }

    @GetMapping(Routes.SupportTickets.BASE)
    public List<SupportTicketSummary> list(@CurrentUser AuthPrincipal principal) {
        return service.list(principal);
    }

    @PostMapping(Routes.SupportTickets.BASE)
    @ResponseStatus(HttpStatus.CREATED)
    public SupportTicketDto create(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody SupportTicketCreate body) {
        return service.create(principal, body);
    }

    @GetMapping(Routes.SupportTickets.BY_ID)
    public SupportTicketDto get(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.get(principal, id);
    }

    @PostMapping(Routes.SupportTickets.MESSAGES)
    @ResponseStatus(HttpStatus.CREATED)
    public MessageDto reply(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody MessageCreate body) {
        return service.reply(principal, id, body.body());
    }

    @PostMapping(Routes.SupportTickets.READ)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markRead(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.markRead(principal, id);
    }

    public record MessageCreate(@NotBlank @Size(max = 4000) String body) {
    }
}
