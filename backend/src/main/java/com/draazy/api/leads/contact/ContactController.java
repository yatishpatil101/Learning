package com.draazy.api.leads.contact;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The buyer's side of the contact gate at {@code /contacts}: read your gate state for a listing, and
 * ask the owner to reveal their number. Rationale: docs/flows/consumer/contact-gate-leads.md#api.
 */
@RestController
public class ContactController {

    private final ContactService contactService;

    public ContactController(ContactService contactService) {
        this.contactService = contactService;
    }

    /**
     * {@code GET /contacts/status?propertyId=} — the caller's gate state for one listing, plus
     * whether the owner accepts verified contacts only. Read-only: checking never creates a request.
     */
    @GetMapping(Routes.Contacts.STATUS)
    public ContactStatusResponse status(@CurrentUser AuthPrincipal principal,
            @RequestParam String propertyId) {
        return contactService.status(principal.userId(), propertyId);
    }

    /**
     * {@code POST /contacts/request} — ask the owner for contact. Idempotent, so {@code 200} with the
     * resulting state; requires only L1. Rationale: docs/flows/consumer/contact-gate-leads.md#api.
     */
    @PostMapping(Routes.Contacts.REQUEST)
    public ContactStatusResponse request(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody ContactRequestCreate body) {
        return contactService.request(principal.userId(), body);
    }
}
