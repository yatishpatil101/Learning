package com.punenest.api.leads.contact;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The buyer's side of the contact gate at {@code /contacts} (contract tag {@code Leads & Contact}):
 * read your gate state for a listing, and ask the owner to reveal their number.
 *
 * <p>Both routes are authenticated by the default-deny posture in {@code SecurityConfig} — the
 * contract's {@code 401} on {@code requestContact} is that filter-chain response, not a check here.
 *
 * <p><strong>No {@code @PreAuthorize} role guard</strong>, and that is the correct gate rather than an
 * oversight: the spec carries no {@code x-roles} on these operations, and any signed-in user may ask
 * for contact. A role restriction would wrongly block the very common case of an owner enquiring
 * about somebody else's listing. Identity comes from {@link AuthPrincipal}, never from the body.
 */
@RestController
public class ContactController {

    private final ContactService contactService;

    public ContactController(ContactService contactService) {
        this.contactService = contactService;
    }

    /**
     * {@code GET /contacts/status?propertyId=} (contract {@code contactStatus}) — the caller's gate
     * state for one listing: {@code owner}, {@code approved}, {@code pending}, {@code declined} or
     * {@code none}, plus whether the owner accepts verified contacts only.
     *
     * <p>Read-only and side-effect free: checking your status never creates a request.
     *
     * @throws com.punenest.api.common.error.NotFoundException when the listing does not exist
     */
    @GetMapping(Routes.Contacts.STATUS)
    public ContactStatusResponse status(@CurrentUser AuthPrincipal principal,
            @RequestParam String propertyId) {
        return contactService.status(principal.userId(), propertyId);
    }

    /**
     * {@code POST /contacts/request} (contract {@code requestContact}) — ask the owner for contact.
     *
     * <p>{@code 200} with the resulting {@link ContactStatusResponse} (not {@code 201}: the contract
     * models this as "tell me where I now stand", and a repeat call is idempotent, so there is not
     * always a new resource). Requires only L1; a missing Aadhaar badge is <em>not</em> a
     * prerequisite. The only {@code 403} is {@code verification_required}, raised solely when the
     * owner opted into verified-contact-only (ADR-019).
     *
     * @throws com.punenest.api.common.error.VerificationRequiredException on that single opt-in path
     */
    @PostMapping(Routes.Contacts.REQUEST)
    public ContactStatusResponse request(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody ContactRequestCreate body) {
        return contactService.request(principal.userId(), body);
    }
}
