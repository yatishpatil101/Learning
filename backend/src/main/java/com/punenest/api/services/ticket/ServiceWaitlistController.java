package com.punenest.api.services.ticket;

import com.punenest.api.common.web.Routes;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code POST /service-waitlist} — "tell me when this launches", from somebody with no account (D4).
 *
 * <p><strong>Its own controller, not a fourth method on {@link TicketsController}.</strong> That
 * class documents itself as the ops board, where {@code POST} is the one route without a role guard
 * and the class Javadoc has to explain the asymmetry to stop a later reader closing it. Adding a
 * second unguarded method there would turn a stated exception into an apparent pattern, and the next
 * person deciding whether {@code /tickets} is "the authenticated one" would have two answers. This
 * file is small enough that its guard — there is none, by design — is the first thing about it.
 *
 * <p><strong>Three separate controls stand in for the missing session</strong>, and it is worth
 * naming which does what, because no one of them is sufficient:
 * <ul>
 *   <li>{@code WriteRateLimitFilter} caps writes per IP. It is the cheapest control and the weakest
 *       one here: a mobile network puts thousands of real people behind one address, so the ceiling
 *       has to be loose enough to be no defence against a single determined script.</li>
 *   <li>{@code BotDefenceFilter} requires a solved Turnstile challenge — this path is in its
 *       {@code CHALLENGED} set with the other two anonymous writes. It is the control that costs an
 *       attacker something, and it is off on every developer machine and in the whole test suite,
 *       which is exactly why it cannot be the only one.</li>
 *   <li>{@code TicketService.joinWaitlist} caps signups per <em>mobile</em> per hour against the
 *       table, under an advisory lock. This is the one that survives both of the above being
 *       unconfigured, and it is the only one keyed on the thing the platform actually cares about:
 *       the number ops will ring. A budget that resets on deploy is not a budget.</li>
 * </ul>
 *
 * <p>There is no {@code GET}. The rows are readable on the ops board, by ops, through the guarded
 * routes on {@link TicketsController} — a list endpoint here would be a page of unverified phone
 * numbers behind whatever guard someone remembered to add.
 */
@RestController
public class ServiceWaitlistController {

    private final TicketService service;

    public ServiceWaitlistController(TicketService service) {
        this.service = service;
    }

    /**
     * Join a waitlist. 201 whether or not a row was written — see {@link TicketService#joinWaitlist}.
     *
     * <p>Returns {@code void} rather than the created ticket. The caller cannot read
     * {@code GET /tickets}, so an id would be a reference it can never resolve, and the response
     * would confirm to a stranger whether the number they typed was already on the list.
     */
    @PostMapping(Routes.ServiceWaitlist.BASE)
    @ResponseStatus(HttpStatus.CREATED)
    public void join(@Valid @RequestBody ServiceWaitlistRequest body) {
        service.joinWaitlist(body);
    }
}
