package com.draazy.api.services.request;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.validation.Formats;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import java.time.Duration;
import java.time.Instant;
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
 * identity documents, delivered over a channel we do not control and cannot revoke. There is no
 * token here and there never will be. An invitation is only ever readable by the person it names,
 * signed in as themselves.
 *
 * <p><strong>What V107 did give back is the ability to name somebody who has not signed up.</strong>
 * V75 resolved the mobile against {@code users} at write time and refused if it matched nobody,
 * which put a stranger's registration in the middle of the requester's checkout. The invitation may
 * now be addressed to a number instead: {@link #invite} writes a pending row,
 * {@link #claimPendingFor} binds it to the account the moment that number registers and proves
 * itself by OTP, and the number is discarded in the same statement. This is a weaker claim about
 * who the invitee is than V75 made, and exactly as strong as every sign-in on the platform — see
 * V107's header for why that is the same trust rather than a new one, and for the recycled-number
 * expiry that bounds it.
 *
 * <p><strong>Claiming is not accepting.</strong> The claimed row is still {@code invited}. Proving
 * control of a number says who you are; it does not say you consent to be on somebody's rent
 * agreement, and {@link #decide} still has to be called by the person themselves.
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
     * How long an invitation may sit unclaimed before the sweep deletes it.
     *
     * <p>Ninety days, matching V64's referral signals — the other place this codebase holds personal
     * data about somebody who never handed it over. It is not a tidiness window: TRAI releases a
     * disconnected mobile back into the pool after ninety days, so an invitation older than this one
     * could be claimed by a stranger who simply inherited the number. The clock is the answer to
     * that, and V107 makes it a CHECK so no pending row can exist without one.
     */
    static final Duration PENDING_INVITE_TTL = Duration.ofDays(90);

    private final ServiceRequestPartyRepository parties;
    private final ServiceRequestRepository requests;
    private final UserRepository users;
    private final AuditService audit;
    private final Notifier notifier;

    CoFillParties(ServiceRequestPartyRepository parties,
            ServiceRequestRepository requests,
            UserRepository users,
            AuditService audit,
            Notifier notifier) {
        this.parties = parties;
        this.requests = requests;
        this.users = users;
        this.audit = audit;
        this.notifier = notifier;
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
     * @throws BadRequestException if the role is not one of {@link #ROLES}, or the mobile is not a
     *                             ten-digit Indian number
     * @throws ConflictException   if the mobile names the requester, the side is already taken, or
     *                             the request is already terminal
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
        if (normalised == null) {
            throw new BadRequestException(Formats.MOBILE_MESSAGE);
        }
        User invitee = users.findByMobileAndArchivedFalse(normalised).orElse(null);
        if (invitee == null) {
            return inviteByMobile(caller, request, side, normalised);
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
        notifyInvitee(request, saved, invitee.getId(), side);
        return toDto(saved, request.getType(), invitee.getName(), displayName(caller.userId()));
    }

    /**
     * Tell the person they have been named on somebody else's paperwork.
     *
     * <p>Only reachable from the branch above, where the invitee already holds an account. The
     * pending-number branch has no {@code userId} to address and therefore no inbox to write to;
     * that invitation announces itself when {@link #claimPendingFor} binds it, which is the first
     * moment there is anybody to announce it to.
     *
     * <p>Until this existed the invitation was silent on live. The client had been writing the row
     * itself ({@code useRentAgreement.generate}), into {@code localStorage} under the *inviter's*
     * browser — so it reached the tenant only when tenant and owner were the same person, which is
     * to say in the mock and nowhere else. Discovery still worked, because
     * {@link #myInvites} lists the invitation on the dashboard, but nothing ever prompted the
     * tenant to go and look.
     *
     * <p>The link carries {@code party} and {@code request} rather than an invitation token, for the
     * reason the class header gives: an invitation is readable only by the person it names, signed
     * in as themselves. It is the same shape the frontend builds for the live wizard, so a tapped
     * notification and a tapped dashboard row land in the same place.
     */
    private void notifyInvitee(ServiceRequest request, ServiceRequestParty saved, UUID inviteeId,
            String side) {
        notifier.notify(inviteeId, "service.party-invited",
                "You were added as the " + side,
                "Complete your details so this request can move forward.",
                ServiceRequestTypes.pageFor(request.getType())
                        + "?party=" + saved.getId()
                        + "&request=" + request.getId());
    }

    /**
     * The invitation nobody can answer yet — addressed to a number with no account behind it (V107).
     *
     * <p>The requester cannot be reached down this path: they hold an account by definition, so
     * their own number would have resolved above. That is why there is no self-invite check here and
     * one directly above.
     *
     * <p>The audit entry names the <em>masked</em> number rather than the whole of it. An audit log
     * has no retention window — {@code ErasureRetention} says so to the subject in as many words —
     * so writing the number here would outlive both the expiry sweep and the erasure statement that
     * exist to bound it, and would do it in the one table neither can reach.
     */
    private ServiceRequestPartyDto inviteByMobile(AuthPrincipal caller, ServiceRequest request,
            String side, String normalised) {
        if (parties.existsByRequestIdAndMobile(request.getId(), normalised)) {
            throw new ConflictException("That number has already been invited to this request.");
        }
        ServiceRequestParty saved = parties.saveAndFlush(new ServiceRequestParty(
                request.getId(), normalised, Instant.now().plus(PENDING_INVITE_TTL), side,
                caller.userId()));
        audit.record(caller, "service-request.party-invited", "service_request",
                request.getId().toString(), "role", side, "party", MobileMask.mask(normalised));
        return toDto(saved, request.getType(), null, displayName(caller.userId()));
    }

    /**
     * Bind this person to any invitation that was addressed to their number before they had an
     * account (V107). Called on the customer-facing reads, not on sign-up.
     *
     * <p><strong>Why a lazy claim rather than an event on registration.</strong> {@code identity}
     * sits at rank 0 of {@code ArchitectureBoundaryTest} and {@code services} at rank 3, so the
     * sign-up path cannot call into this package, and there is no application-event bus in this
     * codebase to invert it with — introducing one for a single listener would be a new mechanism
     * carrying one message. Claiming on read needs neither, and it is strictly more robust: it also
     * catches the person who already held an account under a number they added later, and it
     * self-heals if a claim is ever missed, which an event fired once cannot.
     *
     * <p>Cheap on the answer it almost always gives. The lookup is a partial index over pending rows
     * only ({@code idx_service_request_parties_pending}), and a claimed row leaves that index for
     * good, so the common "nothing waiting for this number" costs one index probe returning nothing.
     *
     * <p>Expired rows are skipped rather than claimed. The sweep will delete them; until it runs,
     * an invitation past its clock must not become a party — that clock is the recycled-number
     * defence, and honouring it only when the sweep happens to have run would make the defence a
     * matter of scheduling.
     */
    @Transactional
    void claimPendingFor(AuthPrincipal caller) {
        User self = users.findById(caller.userId()).orElse(null);
        if (self == null || self.getMobile() == null) {
            return;
        }
        List<ServiceRequestParty> waiting = parties.findByMobile(self.getMobile());
        if (waiting.isEmpty()) {
            return;
        }
        Instant now = Instant.now();
        for (ServiceRequestParty party : waiting) {
            if (party.getInviteExpiresAt() != null && party.getInviteExpiresAt().isBefore(now)) {
                continue;
            }
            // The invitation was addressed to a number that turns out to be the requester's own, or
            // to somebody already on the matter. Claiming would breach uq_service_request_parties_user
            // and, more to the point, would put one person on both sides of their own agreement.
            // Drop it: an invitation that cannot be answered is not one worth keeping a number for.
            boolean wouldDuplicate = parties.existsByRequestIdAndUserId(party.getRequestId(),
                    caller.userId())
                    || requests.findById(party.getRequestId())
                            .map(r -> caller.userId().equals(r.getRequesterId()))
                            .orElse(true);
            if (wouldDuplicate) {
                parties.delete(party);
                continue;
            }
            party.claim(caller.userId());
            parties.save(party);
            audit.record(caller, "service-request.party-claimed", "service_request",
                    party.getRequestId().toString(), "role", party.getRole());
        }
        parties.flush();
    }

    /**
     * Contract {@code withdrawServiceRequestParty} — 204. <strong>The requester, and nobody else.</strong>
     *
     * <p>The invitation that has to be takeable back. A mistyped mobile is not a rare event, and
     * without this it is unrecoverable: {@code uq_service_request_parties_role} means the side is
     * spoken for, so the requester can neither invite the person they meant nor open checkout —
     * {@code openDeferredCheckout} refuses while an invitation is outstanding. Before V107 that
     * stranger would at least eventually decline; a pending row addressed to a number belonging to
     * nobody has no one who can, so the requester would have been stuck until the ninety-day sweep.
     *
     * <p><strong>Only while unanswered.</strong> An accepted party is on the matter and has been
     * shown it; removing them is not an edit to a form, and it is not something the other side gets
     * to do quietly. A declined row stays for the same reason it always did — so the requester can
     * see they were turned down rather than watching the invitation evaporate.
     *
     * <p>The row is deleted rather than marked, because a withdrawn invitation has to release the
     * side, and that release is exactly what the unique index keys on. The act survives in the audit
     * log and in the request's timeline.
     *
     * @throws NotFoundException if there is no such invitation, or it is not on a request of the
     *                           caller's — the same silence every customer-scoped read keeps
     * @throws ConflictException if it has already been answered
     */
    @Transactional
    void withdraw(AuthPrincipal caller, String requestId, String partyId) {
        ServiceRequest request = Ids.parseUuid(requestId)
                .flatMap(requests::findById)
                .orElseThrow(() -> NotFoundException.of("Service request"));
        if (!caller.userId().equals(request.getRequesterId())) {
            throw NotFoundException.of("Service request");
        }
        ServiceRequestParty party = Ids.parseUuid(partyId)
                .flatMap(parties::findById)
                .filter(p -> p.getRequestId().equals(request.getId()))
                .orElseThrow(() -> NotFoundException.of("Invitation"));
        if (!INVITED.equals(party.getStatus())) {
            throw new ConflictException("That invitation has already been " + party.getStatus()
                    + " — it can no longer be withdrawn.");
        }
        parties.delete(party);
        parties.flush();
        audit.record(caller, "service-request.party-withdrawn", "service_request",
                request.getId().toString(), "role", party.getRole());
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
                MobileMask.mask(party.getMobile()),
                party.isPending(),
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
