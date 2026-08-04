package com.punenest.api.engagement.flatmate;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.error.RateLimitedException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.engagement.notification.Notification;
import com.punenest.api.engagement.notification.NotificationRepository;
import com.punenest.api.identity.auth.OtpCode;
import com.punenest.api.identity.auth.OtpService;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.AuthPrincipal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Rooms and groups — the supply side of the flatmates market.
 *
 * <p><strong>Every create here runs the anti-broker guardrails, and that is the point of the
 * class.</strong> Rooms and groups are the two ways a person offers a place to live, and both are
 * where a broker would pose as a tenant. The cap and the address dedupe used to be enforced in the
 * browser; they are enforced here now, against rows the caller cannot edit.
 *
 * <p><strong>Trust tiers are derived, never accepted.</strong> {@link #deriveTier} is the only place
 * a tier is decided, and it reads the caller's relationship to a real listing rather than anything
 * in the request body. A host asking for the owner tier gets it only if they own an Ops-approved
 * property; a tenant claiming a rent agreement gets a review queue entry, not a badge.
 */
@Service
public class FlatmateSupplyService {

    /** Enquiries one account may send per {@link #RATE_WINDOW}. Same reasoning as seeker interest. */
    private static final int MAX_INTERESTS = 10;

    private static final Duration RATE_WINDOW = Duration.ofHours(1);

    private static final int MAX_MESSAGE = 4000;

    /** People allowed in one room, anywhere on the platform. Above this it is a dormitory. */
    private static final int MAX_PER_ROOM = 3;

    private final FlatmateRoomRepository rooms;
    private final FlatmateGroupRepository groups;
    private final FlatmateRequestRepository requests;
    private final FlatmateReviewRepository reviews;
    private final FlatmateOwnerConsentRepository consents;
    private final FlatmateGuardrails guardrails;
    private final FlatmateMapper mapper;
    private final PropertyRepository properties;
    private final UserRepository users;
    private final NotificationRepository notifications;
    private final OtpService otpService;
    private final AuditService audit;

    public FlatmateSupplyService(FlatmateRoomRepository rooms, FlatmateGroupRepository groups,
            FlatmateRequestRepository requests, FlatmateReviewRepository reviews,
            FlatmateOwnerConsentRepository consents, FlatmateGuardrails guardrails,
            FlatmateMapper mapper, PropertyRepository properties, UserRepository users,
            NotificationRepository notifications, OtpService otpService, AuditService audit) {
        this.rooms = rooms;
        this.groups = groups;
        this.requests = requests;
        this.reviews = reviews;
        this.consents = consents;
        this.guardrails = guardrails;
        this.mapper = mapper;
        this.properties = properties;
        this.users = users;
        this.notifications = notifications;
        this.otpService = otpService;
        this.audit = audit;
    }

    // =======================================================================================
    // Rooms
    // =======================================================================================

    /** {@code GET /flatmates/rooms} — public. */
    @Transactional(readOnly = true)
    public Page<FlatmateRoomDto> roomFeed(String locality, Pageable pageable) {
        Page<FlatmateRoom> page = rooms.feed(FlatmateVocabulary.blankToNull(locality), pageable);
        return page.map(room -> mapper.toDto(room,
                FlatmateMapper.RoomView.anonymous(hostName(room.getHostId()))));
    }

    /**
     * {@code GET /properties/{id}/rooms} — the rooms a flat has been split into, public.
     *
     * <p>Declared in the contract since the flatmates slice and served by nothing until now: a
     * client generated from the spec got a 404 from an operation the document promised. It is a read
     * on the largest UI surface in the app, so it was implemented rather than struck out.
     *
     * <p><strong>Anonymous view, like every other public room read.</strong> The host's number is
     * never on this response — it is reached by expressing interest, which is the whole point of the
     * contact rules. {@code RoomView.anonymous} has no parameter to pass a number to, so that is
     * structural here rather than a line somebody has to remember.
     *
     * <p>The occupancy ledger is computed once for the flat rather than per room. Every row shares
     * one {@code propertyId}, so {@code committedInFlat} would otherwise issue the same query N
     * times and — worse — each row would see a ledger built from a separate read.
     */
    @Transactional(readOnly = true)
    public List<FlatmateRoomDto> roomsInFlat(UUID propertyId) {
        List<FlatmateRoom> flatRooms = rooms.findByPropertyIdAndArchivedFalse(propertyId);
        int flatCommitted = flatRooms.stream().mapToInt(FlatmateRoom::getOccupants).sum();
        return flatRooms.stream()
                .map(room -> mapper.toDto(room, new FlatmateMapper.RoomView(
                        flatCommitted, hostName(room.getHostId()), null)))
                .toList();
    }

    /**
     * {@code POST /flatmates/rooms} — offer a spare room.
     *
     * <p>Seat-model by construction: a standalone room has one seat, because the person posting it
     * is describing one vacancy in the flat they live in. The occupancy ledger belongs to split
     * rooms, which are created by {@code POST /properties/{id}/split} instead.
     */
    @Transactional
    public FlatmateRoomDto createRoom(AuthPrincipal caller, FlatmateRoomCreateRequest body) {
        String hostRole = FlatmateVocabulary.orDefault(
                body.hostRole(), FlatmateVocabulary.HOST_ROLE, "tenant", "host role");
        boolean declared = Boolean.TRUE.equals(body.agreementDeclared());

        String tier = deriveTier(caller, hostRole, null, declared);
        var address = new FlatmateGuardrails.Address(
                null, body.society(), body.locality(), null);
        var eligibility = guardrails.evaluate(caller.userId(), tier, address);
        if (eligibility.blocked()) {
            throw new HostBlockedException(eligibility);
        }

        FlatmateRoom room = new FlatmateRoom(
                caller.userId(),
                FlatmateVocabulary.require(body.roomType(), FlatmateVocabulary.ROOM_TYPE, "room type"),
                body.locality().strip(),
                body.rentShare());
        // Everything the client is allowed to say. The mapper's allowlist decides what that is.
        mapper.applyTo(body, room);

        // Everything the client is not. These four are the trust decision, kept here rather than in
        // the mapper so they stay reviewable as a block (api-standards 8.1).
        room.setHostRole(hostRole);
        room.setAgreementDeclared(declared);
        room.setAddressFingerprint(eligibility.fingerprint());
        room.setFlagForReview(eligibility.flagForReview());
        room.setVerificationTier(tier);
        // The badge follows the tier, and only the owner tier earns it outright. A tenant's claim
        // is a claim until Ops has read the document.
        room.setVerified(FlatmateVocabulary.TIER_OWNER.equals(tier));
        // One seat: this is one vacancy in a flat somebody already lives in.
        room.setSeatsTotal(1);
        room.setSeatsOpen(1);

        FlatmateRoom saved = rooms.saveAndFlush(room);
        enqueueReviewIfNeeded(caller, "room", saved.getId(), null, tier,
                eligibility.flagForReview(), body.agreementDoc(),
                addressLabel(saved.getSociety(), saved.getLocality()),
                FlatmateVocabulary.blankToNull(body.ownerConsentMobile()) != null);
        return mapper.toDto(saved, ownView(caller, 0));
    }

    /**
     * {@code PATCH /flatmates/rooms/{id}/seats} — reopen or close a seat.
     *
     * <p>The verification tier is preserved, so re-listing a room needs no re-verification: the flat
     * did not stop being the flat because somebody moved out.
     */
    @Transactional
    public FlatmateRoomDto setSeats(AuthPrincipal caller, UUID roomId, int seatsOpen) {
        FlatmateRoom room = ownedRoom(caller, roomId);
        if (!room.isSeatBased()) {
            throw new ConflictException(
                    "This room tracks occupants rather than seats — record how many people live "
                            + "there instead. (not_seat_based)");
        }
        if (seatsOpen < 0 || seatsOpen > room.getSeatsTotal()) {
            throw new BadRequestException(
                    "Seats open must be between 0 and " + room.getSeatsTotal() + ".");
        }
        room.setSeatsOpen(seatsOpen);
        FlatmateRoom saved = rooms.saveAndFlush(room);
        return mapper.toDto(saved, ownView(caller, committedInFlat(saved)));
    }

    /**
     * {@code PATCH /flatmates/rooms/{id}/occupants} — record how many people live in a room.
     *
     * <p><strong>Clamped server-side and the clamped value echoed back.</strong> The ceiling is a
     * property of the whole flat, so a host editing one room could otherwise exceed a society's cap
     * by walking around the sibling rooms one at a time. The clamp is
     * {@code min(3, maxOccupants - siblings)}.
     */
    @Transactional
    public FlatmateRoomDto setOccupants(AuthPrincipal caller, UUID roomId, int occupants) {
        FlatmateRoom room = ownedRoom(caller, roomId);
        if (!room.isSplitRoom()) {
            throw new ForbiddenException(
                    "Only rooms created by splitting a flat track occupants.");
        }
        if (occupants < 0) {
            throw new BadRequestException("Occupants cannot be negative.");
        }
        int siblings = committedInFlat(room) - room.getOccupants();
        int ceiling = Math.max(0, Math.min(MAX_PER_ROOM, room.getMaxOccupants() - siblings));
        room.setOccupants(Math.min(occupants, ceiling));
        FlatmateRoom saved = rooms.saveAndFlush(room);
        return mapper.toDto(saved, ownView(caller, committedInFlat(saved)));
    }

    /**
     * {@code POST /flatmates/rooms/{id}/agreement/reissue} — a room changed hands.
     *
     * <p>One agreement covers the owner and every flatmate in the flat, so a room changing hands
     * invalidates it for everyone. Recorded as a notification to the host rather than silently
     * filed, because the reissue is a real-world errand somebody has to run.
     */
    @Transactional
    public void reissueAgreement(AuthPrincipal caller, UUID roomId) {
        FlatmateRoom room = ownedRoom(caller, roomId);
        if (!room.isSplitRoom()) {
            throw new ForbiddenException(
                    "Only a flat let room by room has a joint agreement to reissue.");
        }
        Notification note = new Notification(
                caller.userId(),
                "flatmate.agreement.reissue",
                "Joint rent agreement reissue started",
                "A room in this flat changed hands, so the joint agreement covering everyone needs "
                        + "reissuing. Our team will be in touch to arrange it.");
        note.setLink("/flatmates");
        notifications.saveAndFlush(note);
        audit.record(caller, "flatmate.agreement.reissue", "flatmateRoom", room.getId().toString(),
                "propertyId", String.valueOf(room.getPropertyId()));
    }

    /** {@code POST /flatmates/rooms/{id}/interest} — enquire about a room. */
    @Transactional
    public void roomInterest(AuthPrincipal caller, UUID roomId, String share, String message) {
        FlatmateRoom room = rooms.findVisible(roomId)
                .orElseThrow(() -> NotFoundException.of("Room"));
        if (room.getHostId().equals(caller.userId())) {
            throw new ForbiddenException("You cannot enquire about your own room.");
        }
        String intent = FlatmateVocabulary.orDefault(
                share, FlatmateVocabulary.SHARE_INTENT, "solo", "share intent");
        record(caller, "room", room.getId(), room.getHostId(), "request", intent,
                roomPitch(message, intent), "your room in " + room.getLocality());
    }

    // =======================================================================================
    // Groups
    // =======================================================================================

    /** {@code GET /flatmates/groups} — public. */
    @Transactional(readOnly = true)
    public Page<FlatmateGroupDto> groupFeed(String locality, Pageable pageable) {
        return groups.feed(FlatmateVocabulary.blankToNull(locality), pageable)
                .map(g -> mapper.toDto(g,
                        FlatmateMapper.PartyView.anonymous(hostName(g.getHostId()))));
    }

    /** {@code POST /flatmates/groups} — start a group. */
    @Transactional
    public FlatmateGroupDto createGroup(AuthPrincipal caller, FlatmateGroupCreateRequest body) {
        String hostRole = FlatmateVocabulary.orDefault(
                body.role(), FlatmateVocabulary.HOST_ROLE, "tenant", "role");
        boolean declared = Boolean.TRUE.equals(body.agreement());
        UUID propertyId = Ids.parseUuid(body.propertyId()).orElse(null);

        String tier = deriveTier(caller, hostRole, propertyId, declared);
        String locality = body.locality() == null || body.locality().isBlank()
                ? "Baner" : body.locality().strip();

        var address = new FlatmateGuardrails.Address(
                FlatmateVocabulary.TIER_OWNER.equals(tier) ? propertyId : null,
                null, locality, body.title());
        var eligibility = guardrails.evaluate(caller.userId(), tier, address);
        if (eligibility.blocked()) {
            throw new HostBlockedException(eligibility);
        }

        FlatmateGroup group = new FlatmateGroup(
                caller.userId(), body.title().strip(), locality, body.rent());
        mapper.applyTo(body, group);
        if (group.getSeatsOpen() > group.getSeatsTotal()) {
            throw new BadRequestException("A group cannot have more seats open than it has seats.");
        }

        // The trust decision, again kept out of the mapper.
        group.setHostRole(hostRole);
        group.setVerificationTier(tier);
        group.setAgreementDeclared(declared);
        group.setAddressFingerprint(eligibility.fingerprint());
        group.setFlagForReview(eligibility.flagForReview());
        // Only honoured when the tier actually came out as owner — see deriveTier.
        group.setPropertyId(FlatmateVocabulary.TIER_OWNER.equals(tier) ? propertyId : null);
        // The creator is the first member, and their badge is the one on the token.
        group.addMember(new FlatmateGroupMember(
                body.name().strip(), caller.userId(), caller.aadhaarVerified()));

        FlatmateGroup saved = groups.saveAndFlush(group);
        enqueueReviewIfNeeded(caller, "group", null, saved.getId(), tier,
                eligibility.flagForReview(), body.agreementDoc(),
                addressLabel(null, saved.getLocality()), saved.isOwnerConsent());
        return mapper.toDto(saved, ownParty(caller));
    }

    /** {@code DELETE /flatmates/groups/{id}} — remove a group I created. Soft. */
    @Transactional
    public void deleteGroup(AuthPrincipal caller, UUID groupId) {
        FlatmateGroup group = groups.findById(groupId)
                .filter(g -> !g.isArchived())
                .orElseThrow(() -> NotFoundException.of("Group"));
        if (!group.getHostId().equals(caller.userId())) {
            throw new ForbiddenException("You can only remove a group you created.");
        }
        group.archive("removed by the host");
        groups.saveAndFlush(group);
    }

    /** {@code PATCH /flatmates/groups/{id}/seats} — reopen or close a seat. */
    @Transactional
    public FlatmateGroupDto setGroupSeats(AuthPrincipal caller, UUID groupId, int seatsOpen) {
        FlatmateGroup group = groups.findById(groupId)
                .filter(g -> !g.isArchived())
                .orElseThrow(() -> NotFoundException.of("Group"));
        if (!group.getHostId().equals(caller.userId())) {
            throw new ForbiddenException("You can only change seats on a group you created.");
        }
        if (seatsOpen < 0 || seatsOpen > group.getSeatsTotal()) {
            throw new BadRequestException(
                    "Seats open must be between 0 and " + group.getSeatsTotal() + ".");
        }
        group.setSeatsOpen(seatsOpen);
        return mapper.toDto(groups.saveAndFlush(group), ownParty(caller));
    }

    /**
     * {@code POST /flatmates/groups/{id}/join} — ask to join.
     *
     * <p>An open-policy group ({@code any}) auto-accepts; every other policy files a pending request
     * for the host. Both produce an inbox row, because a host wants to see who arrived either way.
     */
    @Transactional
    public FlatmateRequestDto join(AuthPrincipal caller, UUID groupId, String share, String message) {
        FlatmateGroup group = groups.findVisible(groupId)
                .orElseThrow(() -> NotFoundException.of("Group"));
        if (group.getHostId().equals(caller.userId())) {
            throw new ForbiddenException("You cannot ask to join your own group.");
        }
        if (group.openSeats() <= 0) {
            throw new ConflictException("This group is full. (group_full)");
        }
        String intent = FlatmateVocabulary.orDefault(
                share, FlatmateVocabulary.SHARE_INTENT, "solo", "share intent");
        boolean open = FlatmateVocabulary.POLICY_OPEN.equals(group.getPolicy());

        FlatmateRequest saved = record(caller, "group", group.getId(), group.getHostId(),
                open ? "join" : "request", intent,
                FlatmateVocabulary.blankToNull(message) == null
                        ? "Hi! I'd like to join this group." : message.strip(),
                group.getTitle());

        if (open) {
            // Auto-accepted, so the seat is genuinely taken and the member is real.
            User joiner = users.findById(caller.userId())
                    .orElseThrow(() -> NotFoundException.of("User"));
            group.addMember(new FlatmateGroupMember(
                    joiner.getName(), joiner.getId(), caller.aadhaarVerified()));
            group.setSeatsOpen(Math.max(0, group.openSeats() - 1));
            groups.saveAndFlush(group);
        }
        User requester = users.findById(caller.userId()).orElse(null);
        return FlatmateRequestDto.of(saved, group.getTitle(), group.getLocality(),
                requester == null ? null : requester.getName(),
                requester == null ? null : requester.getMobile());
    }

    /**
     * {@code POST /flatmates/groups/{id}/owner-consent} — request, then record, the flat owner's
     * consent.
     *
     * <p><strong>Called twice.</strong> Without {@code otp} it sends a code to the owner; with it,
     * it records an auditable consent. Two calls rather than one because the thing being recorded is
     * that <em>the owner acted</em> — a single call could only ever record that the tenant claimed
     * they would.
     *
     * <p>The consent is keyed on (owner mobile, tenant) rather than on the group, so a tenant who
     * reopens the form is not made to re-OTP an owner who already agreed. It is a fact about two
     * people, not about one post.
     */
    @Transactional
    public boolean ownerConsent(AuthPrincipal caller, UUID groupId, String ownerMobile, String otp) {
        FlatmateGroup group = groups.findById(groupId)
                .filter(g -> !g.isArchived())
                .orElseThrow(() -> NotFoundException.of("Group"));
        if (!group.getHostId().equals(caller.userId())) {
            throw new ForbiddenException("You can only request consent for a group you created.");
        }
        // Shape is validated at the edge (Formats.MOBILE on OwnerConsentRequest), so all that is
        // left here is the rule the edge cannot know: whose number it is.
        String mobile = FlatmateVocabulary.blankToNull(ownerMobile);
        if (mobile == null) {
            throw new BadRequestException("Enter the owner's mobile number.");
        }
        // A tenant cannot be their own landlord for this purpose: self-consent would make the
        // record worthless, and it is the one shortcut somebody would certainly try.
        User self = users.findById(caller.userId())
                .orElseThrow(() -> NotFoundException.of("User"));
        if (mobile.equals(self.getMobile())) {
            throw new BadRequestException(
                    "That is your own number. Consent has to come from the flat's owner.");
        }

        if (FlatmateVocabulary.blankToNull(otp) == null) {
            otpService.sendCode(mobile, OtpCode.PURPOSE_OWNER_CONSENT);
            group.setOwnerConsentMobile(mobile);
            groups.saveAndFlush(group);
            return false;
        }

        // Throws 401 on a wrong code and 429 once the attempt cap is spent — the same primitive
        // that guards login, scoped to its own purpose so neither flow can be used against the other.
        otpService.verifyCode(mobile, otp.strip(), OtpCode.PURPOSE_OWNER_CONSENT);

        consents.findByOwnerMobileAndGrantedBy(mobile, caller.userId())
                .orElseGet(() -> consents.saveAndFlush(
                        new FlatmateOwnerConsent(mobile, caller.userId(), groupId)));
        group.setOwnerConsent(true);
        group.setOwnerConsentMobile(mobile);
        groups.saveAndFlush(group);

        audit.record(caller, "flatmate.ownerConsent", "flatmateGroup", groupId.toString(),
                "ownerMobile", mobile);
        return true;
    }

    // =======================================================================================
    // internals
    // =======================================================================================

    /**
     * The one place a verification tier is decided.
     *
     * <p>Reads the caller's actual relationship to a real listing rather than anything they sent:
     *
     * <ul>
     *   <li><strong>owner</strong> — the caller owns the named property <em>and</em> Ops has
     *       approved it. Both halves matter: owning a pending listing proves nothing has been
     *       checked yet.</li>
     *   <li><strong>tenant</strong> — the caller declared a registered rent agreement. A claim,
     *       which buys a review-queue entry rather than a badge.</li>
     *   <li><strong>identity</strong> — the floor. Signed in, and nothing more asserted.</li>
     * </ul>
     */
    private String deriveTier(AuthPrincipal caller, String hostRole, UUID propertyId,
            boolean agreementDeclared) {
        if (FlatmateVocabulary.ROLE_OWNER.equals(hostRole) && propertyId != null) {
            Optional<Property> parent = properties.findById(propertyId);
            boolean ownsApproved = parent
                    .filter(p -> p.getOwner() != null
                            && p.getOwner().getId().equals(caller.userId()))
                    .filter(p -> PropertyStatus.APPROVED.equals(p.getStatus()) && !p.isArchived())
                    .isPresent();
            if (ownsApproved) {
                return FlatmateVocabulary.TIER_OWNER;
            }
        }
        return agreementDeclared ? FlatmateVocabulary.TIER_TENANT : FlatmateVocabulary.TIER_IDENTITY;
    }

    /**
     * Queue an Ops review when the post makes a claim a human has to check.
     *
     * <p>Owner-tier posts never enter the queue — they were vetted through the parent listing's own
     * documents, and reviewing the same evidence twice costs Ops real time for nothing.
     */
    private void enqueueReviewIfNeeded(AuthPrincipal caller, String kind, UUID roomId, UUID groupId,
            String tier, boolean flagged, Map<String, Object> agreementDoc, String address,
            boolean ownerConsent) {
        if (FlatmateVocabulary.TIER_OWNER.equals(tier)) {
            return;
        }
        boolean needsReview = FlatmateVocabulary.TIER_TENANT.equals(tier) || flagged;
        if (!needsReview) {
            return;
        }
        reviews.saveAndFlush(new FlatmateReview(kind, roomId, groupId, caller.userId(), address,
                tier, flagged, ownerConsent, agreementDoc));
    }

    /** File an inbox row, rate-limited and idempotent per (kind, target, requester). */
    private FlatmateRequest record(AuthPrincipal caller, String kind, UUID targetId, UUID hostId,
            String action, String intent, String message, String targetLabel) {
        String body = message == null || message.length() <= MAX_MESSAGE
                ? message : message.substring(0, MAX_MESSAGE);

        Optional<FlatmateRequest> existing =
                requests.findByKindAndTargetIdAndRequesterId(kind, targetId, caller.userId());
        if (existing.isPresent()) {
            FlatmateRequest already = existing.get();
            already.rewrite(body, intent);
            return requests.saveAndFlush(already);
        }
        if (requests.countByRequesterIdAndCreatedAtAfter(
                caller.userId(), Instant.now().minus(RATE_WINDOW)) >= MAX_INTERESTS) {
            throw new RateLimitedException(
                    "You have contacted a lot of hosts in the last hour. Try again shortly.",
                    (int) RATE_WINDOW.toSeconds());
        }

        FlatmateRequest saved = requests.saveAndFlush(
                new FlatmateRequest(kind, targetId, hostId, caller.userId(), action, intent, body));

        User requester = users.findById(caller.userId())
                .orElseThrow(() -> NotFoundException.of("User"));
        Notification note = new Notification(
                hostId,
                "flatmate." + kind + ".interest",
                requester.getName() + " is interested in " + targetLabel,
                body + "\n\nReach them on " + requester.getMobile() + ".");
        note.setLink("/flatmates");
        notifications.saveAndFlush(note);
        audit.record(caller, "flatmate." + kind + ".interest", "flatmate" + kind,
                targetId.toString(), "host", hostId.toString());
        return saved;
    }

    /** People living across every sibling room of this flat. Standalone rooms have no siblings. */
    private int committedInFlat(FlatmateRoom room) {
        if (!room.isSplitRoom()) {
            return room.getOccupants();
        }
        return rooms.findByPropertyIdAndArchivedFalse(room.getPropertyId()).stream()
                .mapToInt(FlatmateRoom::getOccupants)
                .sum();
    }

    private FlatmateRoom ownedRoom(AuthPrincipal caller, UUID roomId) {
        FlatmateRoom room = rooms.findById(roomId)
                .filter(r -> !r.isArchived())
                .orElseThrow(() -> NotFoundException.of("Room"));
        if (!room.getHostId().equals(caller.userId())) {
            throw new ForbiddenException("You can only change a room you posted.");
        }
        return room;
    }

    private String hostName(UUID hostId) {
        return users.findById(hostId).map(User::getName).orElse(null);
    }

    /**
     * The caller's own view of their own row: name and number both present.
     *
     * <p>Safe, and only here — it is their number, on a request they authenticated. Every anonymous
     * surface builds its view through {@code RoomView.anonymous} / {@code PartyView.anonymous}
     * instead, which have no parameter to pass a number to.
     */
    private FlatmateMapper.RoomView ownView(AuthPrincipal caller, int flatCommitted) {
        return new FlatmateMapper.RoomView(
                flatCommitted, hostName(caller.userId()), callerMobile(caller));
    }

    private FlatmateMapper.PartyView ownParty(AuthPrincipal caller) {
        return new FlatmateMapper.PartyView(hostName(caller.userId()), callerMobile(caller));
    }

    private String callerMobile(AuthPrincipal caller) {
        return users.findById(caller.userId()).map(User::getMobile).orElse(null);
    }

    private static String addressLabel(String society, String locality) {
        return society == null || society.isBlank() ? locality : society + ", " + locality;
    }

    private static String roomPitch(String message, String intent) {
        String supplied = FlatmateVocabulary.blankToNull(message);
        if (supplied != null) {
            return supplied;
        }
        return switch (intent) {
            case "bring" -> "Hi! There are two of us — could we take this room together?";
            case "match" -> "Hi! I'd take this room and am happy to share it with someone.";
            default -> "Hi! Is this room still available?";
        };
    }

    /**
     * 409 carrying the eligibility result, so the client can explain the refusal rather than
     * guessing. The contract declares {@code HostEligibility} as the 409 body for both creates.
     */
    public static class HostBlockedException extends ConflictException {

        private final transient FlatmateGuardrails.HostEligibility eligibility;

        HostBlockedException(FlatmateGuardrails.HostEligibility eligibility) {
            super(eligibility.reason());
            this.eligibility = eligibility;
        }

        public FlatmateGuardrails.HostEligibility eligibility() {
            return eligibility;
        }
    }
}
