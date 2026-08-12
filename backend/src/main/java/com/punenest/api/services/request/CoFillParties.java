package com.punenest.api.services.request;

import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.common.web.Ids;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.AuthPrincipal;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Co-filled service requests: naming the counterparty, and letting them answer (D121).
 *
 * <p>A Leave &amp; License agreement is two people's paperwork. Every service request before this
 * was scoped to {@code requester_id} alone, so the tenant on an owner's rent agreement had no row
 * anywhere and therefore no route on which to fetch the matter they were a party to — the frontend
 * had been splitting the request across two mobiles in {@code localStorage} instead
 * ({@code serviceFlow.createCoFill} / {@code listForParty}).
 *
 * <p><strong>Its own collaborator rather than more methods on {@link ServiceRequestService},</strong>
 * for the reason {@link TicketMirror} is: this is the only part of the flow that resolves a person
 * from a contact detail, and it is the only part whose authorisation rule is "the invitee", which is
 * neither a role nor the requester. Folding it in would have hidden a third authorisation model
 * among nine methods that resolve "ops or the customer".
 *
 * <h2>What was deliberately not copied from the mock</h2>
 *
 * <p>The mock minted a random {@code inviteId}, put it in a WhatsApp deep link, and let anybody
 * holding that link open the invitation ({@code findInviteById} scans every bucket precisely so an
 * unauthenticated recipient can). That is a bearer token for a rent, a deposit and two sets of
 * identity documents, delivered over a channel we do not control and cannot revoke. Here the invite
 * is addressed to an <em>account</em>: the mobile is resolved against {@code users} at write time,
 * stored as a foreign key, and then discarded. An invitation is consequently only ever visible to
 * the person it names, once they have signed in as themselves.
 *
 * <p>The price is that an unregistered counterparty cannot be invited — {@link #NOT_REGISTERED}. It
 * is worth paying: that person has to hold an account to fill their half and to upload their Aadhaar
 * anyway, so the requirement is not new, only earlier, and moving it earlier is what closes the
 * unauthenticated window.
 */
@Component
class CoFillParties {

    /** The sides of an agreement. Mirrors the V75 {@code role} CHECK, which is the enforcement. */
    static final Set<String> ROLES = Set.of("owner", "tenant");

    /** Named, because the read scope keys on this exact value in three places. */
    static final String INVITED = "invited";
    static final String ACCEPTED = "accepted";
    static final String DECLINED = "declined";

    /**
     * The 409 for a mobile that belongs to nobody.
     *
     * <p>A {@code 409} and not a {@code 404}: the request the caller named exists and is theirs, and
     * nothing about it is missing — what is missing is a precondition on the other side, which is
     * the distinction {@code api-standards.md} draws between the two. It also says nothing about
     * <em>which</em> numbers hold accounts beyond the one the caller typed, so it cannot be turned
     * into a membership oracle any faster than the sign-up form already can.
     */
    private static final String NOT_REGISTERED =
            "That mobile has no PuneNest account yet. Ask them to sign up, then invite them — they "
                    + "will need to sign in to fill their half of the agreement in any case.";

    private final ServiceRequestPartyRepository parties;
    private final ServiceRequestRepository requests;
    private final UserRepository users;
    private final AuditService audit;

    CoFillParties(ServiceRequestPartyRepository parties,
            ServiceRequestRepository requests,
            UserRepository users,
            AuditService audit) {
        this.parties = parties;
        this.requests = requests;
        this.users = users;
        this.audit = audit;
    }

    /**
     * Contract {@code inviteServiceRequestParty} — 201. <strong>The requester, and nobody else.</strong>
     *
     * <p>Not ops, deliberately, and not the counterparty either. Naming the other side of an
     * agreement decides who gets to read it; letting an operator do that on the customer's behalf
     * would make a support action indistinguishable from the customer's own consent, and letting an
     * accepted party do it would let an invitation chain outward from one that was itself a typo.
     *
     * <p>{@code 404} rather than {@code 403} for a stranger's request, matching {@code visible} on
     * every other customer-scoped read: which service requests exist is not a fact this API confirms
     * to people who are not on them.
     *
     * @throws NotFoundException   if there is no such request, or it is not the caller's
     * @throws BadRequestException if the role is not one of {@link #ROLES}
     * @throws ConflictException   if the mobile has no account, names the requester, or the side is
     *                             already taken
     */
    @Transactional
    ServiceRequestPartyDto invite(AuthPrincipal caller, String requestId, String role, String mobile) {
        ServiceRequest request = Ids.parseUuid(requestId)
                .flatMap(requests::findById)
                .orElseThrow(() -> NotFoundException.of("Service request"));
        if (!caller.userId().equals(request.getRequesterId())) {
            throw NotFoundException.of("Service request");
        }
        String side = role == null ? "" : role.trim().toLowerCase();
        if (!ROLES.contains(side)) {
            throw new BadRequestException("role must be one of " + ROLES.stream().sorted().toList());
        }
        if (request.getStatus().isTerminal()) {
            throw new ConflictException("This request is " + request.getStatus()
                    + " — there is nothing left for a second party to fill.");
        }
        String normalised = MobileMask.normalise(mobile);
        User invitee = normalised == null
                ? null
                : users.findByMobileAndArchivedFalse(normalised).orElse(null);
        if (invitee == null) {
            throw new ConflictException(NOT_REGISTERED);
        }
        if (invitee.getId().equals(request.getRequesterId())) {
            throw new ConflictException("You are already on this request — invite the other party.");
        }
        if (parties.existsByRequestIdAndUserId(request.getId(), invitee.getId())) {
            throw new ConflictException("That person is already a party to this request.");
        }
        ServiceRequestParty saved = parties.saveAndFlush(
                new ServiceRequestParty(request.getId(), invitee.getId(), side, caller.userId()));
        audit.record(caller, "service-request.party-invited", "service_request",
                request.getId().toString(), "role", side, "party", invitee.getId().toString());
        return toDto(saved, request.getType(), invitee.getName(), displayName(caller.userId()));
    }

    /**
     * Contract {@code myServiceRequestInvites} — what this person has been asked to co-fill.
     *
     * <p>The replacement for the mock's deep link, and the only way an invitation is discoverable.
     * It returns invitations rather than requests on purpose: a pending party is not yet on the
     * matter, so nothing here reads the agreement. Accepting is what widens the scope, and from that
     * moment the request appears in their ordinary {@code GET /service-requests}, which is the
     * "party view" the register said did not exist.
     */
    @Transactional(readOnly = true)
    List<ServiceRequestPartyDto> myInvites(AuthPrincipal caller) {
        List<ServiceRequestParty> pending =
                parties.findByUserIdAndStatusOrderByCreatedAtDesc(caller.userId(), INVITED);
        if (pending.isEmpty()) {
            return List.of();
        }
        Map<UUID, String> types = new HashMap<>();
        requests.findAllById(pending.stream().map(ServiceRequestParty::getRequestId).toList())
                .forEach(r -> types.put(r.getId(), r.getType()));
        Map<UUID, String> names = names(pending);
        return pending.stream()
                .map(p -> toDto(p, types.get(p.getRequestId()),
                        names.get(p.getUserId()), names.get(p.getInvitedBy())))
                .toList();
    }

    /**
     * Contract {@code decideServiceRequestInvite} — <strong>the invited person, and nobody else</strong>.
     *
     * <p>Accepting is the act that grants sight of the agreement, so it has to be performed by the
     * person granting it. The requester cannot accept on their behalf and neither can ops; that is
     * the same maker-checker reasoning that keeps staff out of {@code decideServiceRequestDraft}.
     *
     * <p>A decline is final. The row stays — so the requester can see they were turned down rather
     * than watching the invitation evaporate — and the side is released by
     * {@code uq_service_request_parties_role} only once the row is gone, which it never is. Inviting
     * a different person to the same side after a decline is therefore a deliberate second act with
     * its own record, not a silent overwrite of the first.
     *
     * @throws NotFoundException if there is no such invitation, or it is not this caller's
     * @throws ConflictException if it has already been answered
     */
    @Transactional
    ServiceRequestPartyDto decide(AuthPrincipal caller, String partyId, String decision) {
        ServiceRequestParty party = Ids.parseUuid(partyId)
                .flatMap(parties::findById)
                .orElseThrow(() -> NotFoundException.of("Invitation"));
        if (!caller.userId().equals(party.getUserId())) {
            throw NotFoundException.of("Invitation");
        }
        String outcome = switch (decision == null ? "" : decision.trim().toLowerCase()) {
            case "accept" -> ACCEPTED;
            case "decline" -> DECLINED;
            default -> throw new BadRequestException("decision must be 'accept' or 'decline'");
        };
        if (!INVITED.equals(party.getStatus())) {
            throw new ConflictException("You have already " + party.getStatus() + " this invitation.");
        }
        party.answer(outcome);
        parties.saveAndFlush(party);
        audit.record(caller, "service-request.party-" + outcome, "service_request",
                party.getRequestId().toString(), "role", party.getRole());
        String type = requests.findById(party.getRequestId()).map(ServiceRequest::getType).orElse(null);
        Map<UUID, String> names = names(List.of(party));
        return toDto(party, type, names.get(party.getUserId()), names.get(party.getInvitedBy()));
    }

    /**
     * Project one row for the wire. The single construction site, so the embedded copy in
     * {@code ServiceRequest.parties} and the standalone one on the invitations list cannot drift.
     */
    static ServiceRequestPartyDto toDto(ServiceRequestParty party, String requestType,
            String partyName, String invitedByName) {
        return new ServiceRequestPartyDto(
                party.getId().toString(),
                party.getRequestId().toString(),
                requestType,
                party.getRole(),
                party.getStatus(),
                partyName,
                invitedByName,
                party.getCreatedAt());
    }

    /** Display names for a handful of rows. The paged read resolves its own — see the mapper. */
    private Map<UUID, String> names(List<ServiceRequestParty> rows) {
        Set<UUID> ids = new LinkedHashSet<>();
        rows.forEach(p -> {
            ids.add(p.getUserId());
            ids.add(p.getInvitedBy());
        });
        ids.removeIf(Objects::isNull);
        Map<UUID, String> names = new HashMap<>();
        users.findAllById(ids).forEach(u -> names.put(u.getId(), u.getName()));
        return names;
    }

    private String displayName(UUID userId) {
        return users.findById(userId).map(User::getName).orElse(null);
    }
}
