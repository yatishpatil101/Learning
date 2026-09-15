package com.draazy.api.engagement.flatmate;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.catalog.society.SocietyReference;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.common.persistence.ConstraintViolations;
import com.draazy.api.common.persistence.RateLimitLock;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.OtpSender;
import com.draazy.api.security.AuthPrincipal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Rooms and groups — the supply side of the flatmates market. Every create runs anti-broker
 * guardrails and trust tiers are derived. See docs/flows/consumer/flatmates.md#supply-side-rationale-moved-from-backend-javadoc.
 */
@Service
public class FlatmateSupplyService {

    private static final Logger log = LoggerFactory.getLogger(FlatmateSupplyService.class);

    /** Enquiries one account may send per {@link #RATE_WINDOW}. Same reasoning as seeker interest. */
    private static final int MAX_INTERESTS = 10;

    private static final Duration RATE_WINDOW = Duration.ofHours(1);

    private static final int MAX_MESSAGE = 4000;

    /** V27's {@code (kind, target_id, requester_id)} unique index — one request per (target, requester). */
    private static final String ONE_PER_TARGET_INDEX = "uq_flatmate_requests_target_requester";

    /** People allowed in one room, anywhere on the platform. Above this it is a dormitory. */
    private static final int MAX_PER_ROOM = 3;

    private final FlatmateRoomRepository rooms;
    private final FlatmateGroupRepository groups;
    private final FlatmateRequestRepository requests;
    /** Owner-consent fact keyed by (owner mobile, tenant) — outlives any one group. */
    private final FlatmateOwnerConsentService consentService;
    private final FlatmateGuardrails guardrails;
    /** Whether a written or edited post lands on the board or in the review backlog. */
    private final FlatmatePublication publication;
    private final FlatmateMapper mapper;
    /** Room rows → room cards: host-name and occupancy joins, batched once per window. */
    private final FlatmateRoomCards cards;
    private final PropertyRepository properties;
    /** Refuses a room's optional {@code societyId} when it names no society. */
    private final SocietyReference societyReference;
    private final UserRepository users;
    private final Notifier notifier;
    private final AuditService audit;
    /** Makes the per-requester interest budget atomic with the insert it guards. */
    private final RateLimitLock locks;
    /** The Ops verdict behind a group's tier badge, batched once per window. */
    private final FlatmateReviewStatuses reviewStatuses;

    public FlatmateSupplyService(FlatmateRoomRepository rooms, FlatmateGroupRepository groups,
            FlatmateRequestRepository requests,
            FlatmateGuardrails guardrails,
            FlatmateOwnerConsentService consentService,
            FlatmatePublication publication,
            FlatmateMapper mapper, PropertyRepository properties, UserRepository users,
            Notifier notifier, AuditService audit,
            RateLimitLock locks, FlatmateRoomCards cards, SocietyReference societyReference,
            FlatmateReviewStatuses reviewStatuses) {
        this.rooms = rooms;
        this.groups = groups;
        this.requests = requests;
        this.consentService = consentService;
        this.guardrails = guardrails;
        this.publication = publication;
        this.mapper = mapper;
        this.properties = properties;
        this.users = users;
        this.notifier = notifier;
        this.audit = audit;
        this.locks = locks;
        this.cards = cards;
        this.societyReference = societyReference;
        this.reviewStatuses = reviewStatuses;
    }

    // Rooms

    /** {@code GET /flatmates/rooms} — public, card projection. */
    @Transactional(readOnly = true)
    public Page<FlatmateRoomFeedDto> roomFeed(RoomFacets facets, Pageable pageable) {
        return cards.render(rooms.feed(
                FlatmateVocabulary.blankToNull(facets.locality()),
                FlatmateVocabulary.facetOrNull(facets.gender()),
                FlatmateVocabulary.facetOrNull(facets.food()),
                FlatmateVocabulary.blankToNull(facets.roomType()),
                FlatmateVocabulary.blankToNull(facets.furnishing()),
                FlatmateVocabulary.blankToNull(facets.bhk()),
                facets.minBudget(), facets.maxBudget(), facets.verifiedOnly(), pageable));
    }

    /**
     * {@code GET /properties/{id}/rooms} — public card projection filtered via {@link FlatmateRoom#isVisible()}
     * on the stream (the finder must stay wide for the ledger, {@code already_split} and {@code unsplit}).
     */
    @Transactional(readOnly = true)
    public List<FlatmateRoomFeedDto> roomsInFlat(UUID propertyId) {
        return cards.render(rooms.findByPropertyIdAndArchivedFalse(propertyId).stream()
                .filter(FlatmateRoom::isVisible)
                .toList());
    }

    /**
     * {@code POST /flatmates/rooms} — offer a spare room. Seat-model by construction (one seat);
     * the occupancy ledger belongs to split rooms via {@code POST /properties/{id}/split}.
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
        // Checked before the mapper binds it, because the mapper cannot refuse anything: it turns a
        // malformed id into null and files the room attached to nothing. See SocietyReference.
        societyReference.require(body.societyId());
        // Everything the client is allowed to say. The mapper's allowlist decides what that is.
        mapper.applyTo(body, room);

        // Everything the client is not. These four are the trust decision, kept here rather than in
        // the mapper so they stay reviewable as a block (api-standards 8.1).
        room.setHostRole(hostRole);
        room.setAgreementDeclared(declared);
        room.setAddressFingerprint(eligibility.fingerprint());
        room.setFlagForReview(eligibility.flagForReview());
        room.setVerificationTier(tier);
        // Board or backlog: the tier already ranks what the gate was guessing at.
        room.setModStatus(publication.stateFor(tier, eligibility.flagForReview()));
        // The badge follows the tier, and only the owner tier earns it outright. A tenant's claim
        // is a claim until Ops has read the document.
        room.setVerified(FlatmateVocabulary.TIER_OWNER.equals(tier));
        // One seat: this is one vacancy in a flat somebody already lives in.
        room.setSeatsTotal(1);
        room.setSeatsOpen(1);

        FlatmateRoom saved = rooms.saveAndFlush(room);
        publication.enqueueReviewIfNeeded(caller, "room", saved.getId(), null, tier,
                eligibility.flagForReview(), body.agreementDoc(),
                addressLabel(saved.getSociety(), saved.getLocality()),
                FlatmateVocabulary.blankToNull(body.ownerConsentMobile()) != null);
        return mapper.toDto(saved, ownView(caller, 0));
    }

    /**
     * {@code PATCH /flatmates/rooms/{id}/seats} — reopen or close a seat. Tier is preserved:
     * the flat did not stop being the flat because somebody moved out.
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
     * {@code PATCH /flatmates/rooms/{id}/occupants} — record occupancy, clamped to
     * {@code min(3, maxOccupants - siblings)} so a host cannot exceed the flat cap room-by-room.
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
     * {@code POST /flatmates/rooms/{id}/agreement/reissue} — one agreement covers the whole flat,
     * so a room changing hands invalidates it for everyone; recorded as a notification errand.
     */
    @Transactional
    public void reissueAgreement(AuthPrincipal caller, UUID roomId) {
        FlatmateRoom room = ownedRoom(caller, roomId);
        if (!room.isSplitRoom()) {
            throw new ForbiddenException(
                    "Only a flat let room by room has a joint agreement to reissue.");
        }
        notifier.notify(
                caller.userId(),
                "flatmate.agreement.reissue",
                "Joint rent agreement reissue started",
                "A room in this flat changed hands, so the joint agreement covering everyone needs "
                        + "reissuing. Our team will be in touch to arrange it.",
                "/flatmates");
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

    // Groups

    /** {@code GET /flatmates/groups} — public, card projection. */
    @Transactional(readOnly = true)
    public Page<FlatmateGroupFeedDto> groupFeed(GroupFacets facets, Pageable pageable) {
        Page<FlatmateGroup> page = groups.feed(
                FlatmateVocabulary.blankToNull(facets.locality()),
                FlatmateVocabulary.facetOrNull(facets.policy()),
                facets.minRent(), facets.maxRent(), facets.verifiedOnly(), pageable);
        // Batched for the window, like the host names above it — the tier badge on every card here
        // is the Ops verdict, and per-row it would be one query each.
        Map<UUID, String> verdicts = reviewStatuses.forGroups(page.getContent());
        return page.map(g -> mapper.toFeedDto(g,
                FlatmateMapper.PartyView.anonymous(
                        hostName(g.getHostId()), verdicts.get(g.getId()))));
    }

    /** {@code POST /flatmates/groups} — start a group. */    @Transactional
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
        // Consent flag decided here by asking the consent table; client cannot set it.
        group.setOwnerConsent(
                consentService.has(group.getOwnerConsentMobile(), caller.userId()));
        group.setAddressFingerprint(eligibility.fingerprint());
        group.setFlagForReview(eligibility.flagForReview());
        group.setModStatus(publication.stateFor(tier, eligibility.flagForReview()));
        // Only honoured when the tier actually came out as owner — see deriveTier.
        group.setPropertyId(FlatmateVocabulary.TIER_OWNER.equals(tier) ? propertyId : null);
        // The creator is the first member, and their badge is the one on the token.
        group.addMember(new FlatmateGroupMember(
                body.name().strip(), caller.userId(), caller.verified()));

        FlatmateGroup saved = groups.saveAndFlush(group);
        publication.enqueueReviewIfNeeded(caller, "group", null, saved.getId(), tier,
                eligibility.flagForReview(), body.agreementDoc(),
                addressLabel(null, saved.getLocality()), saved.isOwnerConsent());
        return mapper.toDto(saved, ownParty(caller));
    }

    /**
     * {@code PATCH /flatmates/rooms/{id}} — edit a room. Full body (same shape as POST) so
     * "absent" and "cleared" stay distinguishable. Split rooms are refused (address belongs to the flat).
     */
    @Transactional
    public FlatmateRoomDto updateRoom(AuthPrincipal caller, UUID roomId,
            FlatmateRoomCreateRequest body) {
        FlatmateRoom room = rooms.findById(roomId)
                .filter(r -> !r.isArchived())
                .orElseThrow(() -> NotFoundException.of("Room"));
        if (!room.getHostId().equals(caller.userId())) {
            throw new ForbiddenException("You can only edit a room you posted.");
        }
        if (room.isSplitRoom()) {
            throw new ConflictException(FlatmateConflicts.mark(
                    "This room came from splitting a flat, so its address is the flat's. "
                            + "Edit the property instead.",
                    FlatmateConflicts.SPLIT_ROOM));
        }

        String hostRole = FlatmateVocabulary.orDefault(
                body.hostRole(), FlatmateVocabulary.HOST_ROLE, "tenant", "host role");
        boolean declared = Boolean.TRUE.equals(body.agreementDeclared());
        String tier = deriveTier(caller, hostRole, null, declared);

        societyReference.require(body.societyId());
        mapper.applyTo(body, room);
        // Constructor invariants, editable here because a wrong locality is the commonest fix.
        room.setRoomType(FlatmateVocabulary.require(
                body.roomType(), FlatmateVocabulary.ROOM_TYPE, "room type"));
        room.setLocality(body.locality().strip());
        // `budget` is the column behind the contract's `rentShare` — the asking price for the seat.
        room.setBudget(body.rentShare());

        publication.reapplyAfterEdit(caller, tier, room::setAddressFingerprint, room::setFlagForReview,
                room::setModStatus,
                new FlatmateGuardrails.Address(null, body.society(), body.locality(), null));
        room.setHostRole(hostRole);
        room.setAgreementDeclared(declared);
        room.setVerificationTier(tier);
        room.setVerified(FlatmateVocabulary.TIER_OWNER.equals(tier));

        FlatmateRoom saved = rooms.saveAndFlush(room);
        publication.enqueueReviewIfNeeded(caller, "room", saved.getId(), null, tier,
                saved.isFlagForReview(), body.agreementDoc(),
                addressLabel(saved.getSociety(), saved.getLocality()),
                FlatmateVocabulary.blankToNull(body.ownerConsentMobile()) != null);
        return mapper.toDto(saved, ownView(caller, 0));
    }

    /**
     * {@code PATCH /flatmates/groups/{id}} — edit a group. {@code seatsTotal} can move here only,
     * and never below the members already in the group (an eviction, which no route means).
     */
    @Transactional
    public FlatmateGroupDto updateGroup(AuthPrincipal caller, UUID groupId,
            FlatmateGroupCreateRequest body) {
        FlatmateGroup group = groups.findById(groupId)
                .filter(g -> !g.isArchived())
                .orElseThrow(() -> NotFoundException.of("Group"));
        if (!group.getHostId().equals(caller.userId())) {
            throw new ForbiddenException("You can only edit a group you created.");
        }

        String hostRole = FlatmateVocabulary.orDefault(
                body.role(), FlatmateVocabulary.HOST_ROLE, "tenant", "role");
        boolean declared = Boolean.TRUE.equals(body.agreement());
        UUID propertyId = Ids.parseUuid(body.propertyId()).orElse(null);
        String tier = deriveTier(caller, hostRole, propertyId, declared);
        String locality = body.locality() == null || body.locality().isBlank()
                ? "Baner" : body.locality().strip();

        mapper.applyTo(body, group);
        group.setTitle(body.title().strip());
        group.setLocality(locality);
        group.setRent(body.rent());

        int taken = group.getMembers().size();
        if (group.getSeatsTotal() < taken) {
            throw new BadRequestException("This group already has " + taken
                    + " members, so it cannot be resized below that.");
        }
        if (group.getSeatsOpen() > group.getSeatsTotal()) {
            throw new BadRequestException("A group cannot have more seats open than it has seats.");
        }

        publication.reapplyAfterEdit(caller, tier, group::setAddressFingerprint, group::setFlagForReview,
                group::setModStatus,
                new FlatmateGuardrails.Address(
                        FlatmateVocabulary.TIER_OWNER.equals(tier) ? propertyId : null,
                        null, locality, body.title()));
        group.setHostRole(hostRole);
        group.setAgreementDeclared(declared);
        group.setVerificationTier(tier);
        group.setPropertyId(FlatmateVocabulary.TIER_OWNER.equals(tier) ? propertyId : null);

        FlatmateGroup saved = groups.saveAndFlush(group);
        publication.enqueueReviewIfNeeded(caller, "group", null, saved.getId(), tier,
                saved.isFlagForReview(), body.agreementDoc(),
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
     * {@code POST /flatmates/groups/{id}/join} — ask to join. Open-policy auto-accepts; every
     * other policy files a pending request. Both produce an inbox row for the host.
     */
    @Transactional
    public FlatmateRequestDto join(AuthPrincipal caller, UUID groupId, String share, String message) {
        FlatmateGroup group = groups.findVisible(groupId)
                .orElseThrow(() -> NotFoundException.of("Group"));
        if (group.getHostId().equals(caller.userId())) {
            throw new ForbiddenException("You cannot ask to join your own group.");
        }
        if (group.openSeats() <= 0) {
            throw FlatmateConflicts.groupFull("This group is full.");
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
            // `users.name` and `flatmate_group_members.name` are both nullable; member card renders its own fallback.
            group.addMember(new FlatmateGroupMember(
                    FlatmateVocabulary.blankToNull(joiner.getName()),
                    joiner.getId(), caller.verified()));
            group.setSeatsOpen(Math.max(0, group.openSeats() - 1));
            groups.saveAndFlush(group);
        }
        User requester = users.findById(caller.userId()).orElse(null);
        return FlatmateRequestDto.of(saved, group.getTitle(), group.getLocality(),
                requester == null ? null : requester.getName(),
                requester == null ? null : requester.getMobile());
    }

    /**
     * {@code POST /flatmates/groups/{id}/owner-consent} — send an OTP (no {@code otp}) or record consent.
     * {@code noRollbackFor} keeps a failed send from refunding the budget on a stranger-typed number.
     */
    @Transactional(noRollbackFor = OtpSender.DeliveryFailedException.class)
    public boolean ownerConsent(AuthPrincipal caller, UUID groupId, String ownerMobile, String otp) {
        FlatmateGroup group = groups.findById(groupId)
                .filter(g -> !g.isArchived())
                .orElseThrow(() -> NotFoundException.of("Group"));
        if (!group.getHostId().equals(caller.userId())) {
            throw new ForbiddenException("You can only request consent for a group you created.");
        }
        // Normalisation and self-consent refusal live in FlatmateOwnerConsentService for both routes.
        String mobile = consentService.normalise(caller, ownerMobile);

        if (FlatmateVocabulary.blankToNull(otp) == null) {
            consentService.send(mobile);
            group.setOwnerConsentMobile(mobile);
            groups.saveAndFlush(group);
            return false;
        }

        consentService.record(caller, mobile, otp, groupId);
        group.setOwnerConsent(true);
        group.setOwnerConsentMobile(mobile);
        groups.saveAndFlush(group);
        return true;
    }

    // internals

    /**
     * The one place a verification tier is decided; reads the caller's real relationship to a
     * listing (owner requires ownership + Ops approval; tenant is a claim; identity is the floor).
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
     * File an inbox row; refused with 409 {@code already_interested} if this requester already asked.
     * See {@link FlatmateSeekerService#express} for the room / group-join half.
     */
    private FlatmateRequest record(AuthPrincipal caller, String kind, UUID targetId, UUID hostId,
            String action, String intent, String message, String targetLabel) {
        String body = message == null || message.length() <= MAX_MESSAGE
                ? message : message.substring(0, MAX_MESSAGE);

        // Shared budget with FlatmateSeekerService.express: one ten-per-hour across both doors.
        locks.holdUntilCommit(RateLimitLock.Limit.FLATMATE_INTEREST, caller.userId().toString());

        // Existence check AFTER the lock: under READ COMMITTED the double-press loser sees the row.
        // Ahead of rate-limit on purpose — a repeat ask is not a delivery.
        if (requests.findByKindAndTargetIdAndRequesterId(kind, targetId, caller.userId())
                .isPresent()) {
            throw alreadyInterested();
        }

        if (requests.countByRequesterIdAndCreatedAtAfter(
                caller.userId(), Instant.now().minus(RATE_WINDOW)) >= MAX_INTERESTS) {
            throw new RateLimitedException(
                    "You have contacted a lot of hosts in the last hour. Try again shortly.",
                    (int) RATE_WINDOW.toSeconds());
        }

        FlatmateRequest saved;
        try {
            saved = requests.saveAndFlush(new FlatmateRequest(
                    kind, targetId, hostId, caller.userId(), action, intent, body));
        } catch (DataIntegrityViolationException raced) {
            // V27's unique index is the backstop for repeatable-read sessions; only that index is
            // translated to 409 — other integrity violations propagate untranslated.
            if (!isDuplicateInterest(raced)) {
                throw raced;
            }
            // Reaching this line means the re-read did not do its job; caller sees the same 409.
            log.debug("duplicate flatmate interest reached the index: kind={} target={} requester={}",
                    kind, targetId, caller.userId());
            throw alreadyInterested();
        }

        User requester = users.findById(caller.userId())
                .orElseThrow(() -> NotFoundException.of("User"));
        // `users.name` is nullable (OTP sign-in with no profile); "Someone" beats concatenating null.
        String requesterName = FlatmateVocabulary.blankToNull(requester.getName());
        notifier.notify(
                hostId,
                "flatmate." + kind + ".interest",
                (requesterName == null ? "Someone" : requesterName) + " is interested in " + targetLabel,
                body + "\n\nReach them on " + requester.getMobile() + ".",
                "/flatmates");
        audit.record(caller, "flatmate." + kind + ".interest", "flatmate" + kind,
                targetId.toString(), "host", hostId.toString());
        return saved;
    }

    /** Whether this violation is the one-per-target rule; matched via {@link ConstraintViolations}. */
    private static boolean isDuplicateInterest(DataIntegrityViolationException violation) {
        return ConstraintViolations.isOn(violation, ONE_PER_TARGET_INDEX);
    }

    /**
     * 409 {@code already_interested} for both {@code flatmateRoomInterest} and {@code flatmateGroupJoin}.
     * See {@link FlatmateConflicts} — the marker is appended after, so nothing follows it by accident.
     */
    private static ConflictException alreadyInterested() {
        return FlatmateConflicts.alreadyInterested(
                "You have already sent this host a request — your earlier message is with them.");
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

    /** Caller's own view — name and number both present; safe only here, on an authenticated request. */
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
            super(FlatmateConflicts.mark(eligibility.reason(),
                    FlatmateConflicts.guardrailSubCode(eligibility.overCap(),
                            eligibility.duplicate())));
            this.eligibility = eligibility;
        }

        public FlatmateGuardrails.HostEligibility eligibility() {
            return eligibility;
        }
    }
}
