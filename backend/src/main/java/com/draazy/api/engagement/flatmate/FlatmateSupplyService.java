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

    private static final Logger log = LoggerFactory.getLogger(FlatmateSupplyService.class);

    /** Enquiries one account may send per {@link #RATE_WINDOW}. Same reasoning as seeker interest. */
    private static final int MAX_INTERESTS = 10;

    private static final Duration RATE_WINDOW = Duration.ofHours(1);

    private static final int MAX_MESSAGE = 4000;

    /**
     * V27's {@code (kind, target_id, requester_id)} unique index — one request per person per
     * target, and the only thing that can settle two presses that arrive together.
     *
     * <p>Shared with {@link FlatmateSeekerService}, which writes the same table through the seeker
     * post door. Named here rather than centrally because the constant is only useful next to the
     * catch block that reads it.
     */
    private static final String ONE_PER_TARGET_INDEX = "uq_flatmate_requests_target_requester";

    /** People allowed in one room, anywhere on the platform. Above this it is a dormitory. */
    private static final int MAX_PER_ROOM = 3;

    private final FlatmateRoomRepository rooms;
    private final FlatmateGroupRepository groups;
    private final FlatmateRequestRepository requests;
    /**
     * The owner-consent fact, which outlives and pre-dates any one group.
     *
     * <p>This is the only way in: the {@code FlatmateOwnerConsentRepository} used to be injected
     * alongside it and is not any more. Both readings of consent — "has this owner already agreed"
     * and "verify the OTP that records the agreement" — belong to the service, and holding the
     * repository here as well offered a second, unguarded route to the same rows.
     */
    private final FlatmateOwnerConsentService consentService;
    private final FlatmateGuardrails guardrails;
    /** Whether a written or edited post lands on the board or in the D72 backlog. */
    private final FlatmatePublication publication;
    private final FlatmateMapper mapper;
    /** Room rows → room cards: the host-name and occupancy joins, batched once per window (D212). */
    private final FlatmateRoomCards cards;
    private final PropertyRepository properties;
    /** Refuses a room's optional {@code societyId} when it names no society. */
    private final SocietyReference societyReference;
    private final UserRepository users;
    private final Notifier notifier;
    private final AuditService audit;
    /** Makes the per-requester interest budget atomic with the insert it guards (D73). */
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

    // =======================================================================================
    // Rooms
    // =======================================================================================

    /** {@code GET /flatmates/rooms} — public, card projection (D80). */
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
     * {@code GET /properties/{id}/rooms} — the rooms a flat has been split into, public.
     *
     * <p>Declared in the contract since the flatmates slice and served by nothing until now: a
     * client generated from the spec got a 404 from an operation the document promised.
     *
     * <p><strong>Anonymous view, like every other public room read.</strong> The host's number is
     * reached by expressing interest, so this returns the card projection
     * ({@link FlatmateRoomFeedDto}, D80) rather than the full room: "detail" here describes the
     * <em>flat</em>, not the room row. The projection has no {@code ownerMobile} field at all, so
     * the rule is structural rather than a line somebody has to remember.
     *
     * <p><strong>Only rooms Ops has cleared (D210).</strong> The same rule the other two public
     * room reads express in JPQL, borrowed as {@link FlatmateRoom#isVisible()} rather than
     * restated, so there is one definition of "visible" and not two. Note where the filter sits:
     * on the returned stream, not in the finder — {@code findByPropertyIdAndArchivedFalse} also
     * feeds {@code committedInFlat}, the {@code already_split} check and {@code unsplit}, all of
     * which must keep seeing every non-archived row. A room awaiting moderation still occupies the
     * flat and must still block a re-split, so it stays in the ledger while dropping out of the
     * response, and a freshly split flat reads empty here until Ops clears it.
     */
    @Transactional(readOnly = true)
    public List<FlatmateRoomFeedDto> roomsInFlat(UUID propertyId) {
        return cards.render(rooms.findByPropertyIdAndArchivedFalse(propertyId).stream()
                .filter(FlatmateRoom::isVisible)
                .toList());
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
        // On the board, or in the D72 backlog. See FlatmatePublication — the tier already ranks the thing
        // the gate was guessing at, so a host who proved something does not wait behind one who
        // proved nothing.
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

    // =======================================================================================
    // Groups
    // =======================================================================================

    /** {@code GET /flatmates/groups} — public, card projection (D211). */
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
        // Consent taken before this group existed. The mapper has already normalised `consentMobile`
        // into `ownerConsentMobile`; `ownerConsent` itself stays un-settable by the client, so the
        // flag is decided here by asking the consent table whether this owner actually agreed to
        // this tenant. Without this the tenant's OTP round-trip was discarded at the door: the chip
        // never rendered, and the Ops review entry below said consent was absent.
        group.setOwnerConsent(
                consentService.has(group.getOwnerConsentMobile(), caller.userId()));
        group.setAddressFingerprint(eligibility.fingerprint());
        group.setFlagForReview(eligibility.flagForReview());
        group.setModStatus(publication.stateFor(tier, eligibility.flagForReview()));
        // Only honoured when the tier actually came out as owner — see deriveTier.
        group.setPropertyId(FlatmateVocabulary.TIER_OWNER.equals(tier) ? propertyId : null);
        // The creator is the first member, and their badge is the one on the token.
        group.addMember(new FlatmateGroupMember(
                body.name().strip(), caller.userId(), caller.aadhaarVerified()));

        FlatmateGroup saved = groups.saveAndFlush(group);
        publication.enqueueReviewIfNeeded(caller, "group", null, saved.getId(), tier,
                eligibility.flagForReview(), body.agreementDoc(),
                addressLabel(null, saved.getLocality()), saved.isOwnerConsent());
        return mapper.toDto(saved, ownParty(caller));
    }

    /**
     * {@code PATCH /flatmates/rooms/{id}} — edit a room I posted.
     *
     * <p>Until this existed the only way to correct a room was to delete it and post it again, which
     * costs the host every reply the old ad had collected: the interest rows point at the dead id.
     * A typo in the rent was a choice between leaving it wrong and throwing away the leads.
     *
     * <p><strong>A full body, not a sparse one</strong> — the same shape {@code POST} takes, and the
     * same shape {@code PATCH /flatmates/posts/{id}} has always taken. A partial body would need a
     * second request record whose every field is nullable, and then "absent" and "cleared" become
     * the same wire value for {@code note}, {@code deposit} and {@code availableFrom}. The verb is
     * {@code PATCH} rather than {@code PUT} because the server still owns fields the client cannot
     * send \u2014 tier, fingerprint, moderation state \u2014 so this is not a replacement of the resource.
     *
     * <p><strong>Split rooms are refused.</strong> Their locality, society and flat number are the
     * parent listing's facts, not this row's; letting a room disagree with the flat it is part of
     * would make the occupancy ledger describe two different addresses. Editing those belongs on the
     * property.
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
        // The three the mapper leaves alone because they are the constructor's invariants. They are
        // editable here for the same reason everything else is: a room in the wrong locality is the
        // single most common thing a host needs to fix, and it is exactly what the allowlist cannot
        // reach.
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
     * {@code PATCH /flatmates/groups/{id}} — edit a group I started.
     *
     * <p>The group counterpart of {@link #updateRoom}, on the same terms and for the same reason:
     * delete-and-repost was the only correction available, and it discards the members who have
     * already joined along with everyone who asked to.
     *
     * <p><strong>{@code seatsTotal} can move here, and only here.</strong> {@code PATCH
     * .../seats} adjusts how many of the existing seats are open; this is the flat getting bigger or
     * smaller. It cannot drop below the people already in the group \u2014 that is not an edit, it is an
     * eviction, and there is no route that means that.
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
            // why: `users.name` is nullable — an OTP sign-in sets no name until the person fills in
            // their profile — and since V55 so is `flatmate_group_members.name`, so the null goes
            // through untouched. It used to be substituted with the literal "Member" to satisfy a
            // NOT NULL the schema had no business asserting; that stored a name the platform made
            // up and then showed it to other people as this person's. Absent is not the same claim
            // as "called Member", and only one of the two is true. The member card renders its own
            // fallback for the absent case (D118).
            group.addMember(new FlatmateGroupMember(
                    FlatmateVocabulary.blankToNull(joiner.getName()),
                    joiner.getId(), caller.aadhaarVerified()));
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
     *
     * <p><strong>{@code noRollbackFor} has to be named here, not just on {@code OtpService.sendCode}</strong>
     * (which explains why the budget must survive a failed send). That advice only <em>participates</em>
     * in the transaction this method owns, and cannot stop an outer advice from rolling back on its own
     * rules — which would refund the send budget on the one route whose recipient is a stranger's number
     * the caller typed in. Safe, because the send runs before the group is touched.
     */
    @Transactional(noRollbackFor = OtpSender.DeliveryFailedException.class)
    public boolean ownerConsent(AuthPrincipal caller, UUID groupId, String ownerMobile, String otp) {
        FlatmateGroup group = groups.findById(groupId)
                .filter(g -> !g.isArchived())
                .orElseThrow(() -> NotFoundException.of("Group"));
        if (!group.getHostId().equals(caller.userId())) {
            throw new ForbiddenException("You can only request consent for a group you created.");
        }
        // Normalisation and the self-consent refusal belong to the consent fact itself, not to the
        // group it is being attached to, so both live in FlatmateOwnerConsentService and both routes
        // get them identically.
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
     * File an inbox row, rate-limited and refused if this requester already asked.
     *
     * <p>One request per (kind, target, requester), and a second ask is <strong>refused</strong>
     * with the 409 the contract declares for both doors rather than quietly rewriting the first
     * message. It used to depend on timing (D175) — see
     * {@link FlatmateSeekerService#express} for the argument, which is the same one; this method is
     * the room and group-join half of it.
     */
    private FlatmateRequest record(AuthPrincipal caller, String kind, UUID targetId, UUID hostId,
            String action, String intent, String message, String targetLabel) {
        String body = message == null || message.length() <= MAX_MESSAGE
                ? message : message.substring(0, MAX_MESSAGE);

        // Same lock, same key, same counter as FlatmateSeekerService.express (D73). A room enquiry
        // and a seeker interest are two entrances to one ten-an-hour budget; locking them separately
        // would leave the burst a second door to walk through.
        locks.holdUntilCommit(RateLimitLock.Limit.FLATMATE_INTEREST, caller.userId().toString());

        // Read AFTER the lock (D175), and it is the only existence check there is. The loser of a
        // double press reaches this line only once the winner has committed and released the lock,
        // so under READ COMMITTED it sees the row and gets the same 409 the unique index would have
        // given it. Reading before the lock — as this method used to — is a stale read by
        // construction, and it answered 201 to the press that arrived a moment late.
        //
        // Ahead of the rate-limit count on purpose: a repeat ask is not a delivery, so telling
        // somebody they have contacted too many hosts would be both unhelpful and untrue.
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
            // why: the backstop, and it should now be unreachable. The re-read above closes the
            // window under READ COMMITTED, but the isolation level is a property of the datasource
            // rather than of this method, and a repeatable-read session would carry its pre-lock
            // snapshot past the check and arrive here believing it is the first. V27's unique index
            // is what actually refuses that, and without this the caller got a 500 for pressing a
            // button twice.
            //
            // Only that index is translated (D170). The same insert can trip the host or requester
            // foreign key, or a check constraint on kind or action, and answering one of those with
            // "you have already asked" would dress a defect up as the system working: the requester
            // believes their message was delivered, the host never sees it, and nothing reaches the
            // error log. Anything else goes up untouched and becomes a 500.
            if (!isDuplicateInterest(raced)) {
                throw raced;
            }
            // Logged because reaching this line means the re-read did not do its job, and the caller
            // cannot tell the difference — they get the same 409 either way (D175).
            log.debug("duplicate flatmate interest reached the index: kind={} target={} requester={}",
                    kind, targetId, caller.userId());
            throw alreadyInterested();
        }

        User requester = users.findById(caller.userId())
                .orElseThrow(() -> NotFoundException.of("User"));
        // why: `users.name` is nullable for exactly the caller most likely to be here — someone who
        // signed in by OTP to answer an ad and has not filled in a profile yet (D118, and see the
        // join path above). Java concatenates a null reference as the four letters "null", so the
        // host was told "null is interested in Master bedroom" by a system that knew perfectly well
        // it did not have a name. "Someone" is what this codebase already says in the same spot
        // (`OfferService`, `ConversationService`): it is honestly indefinite rather than a name the
        // platform invented, and it reads as a sentence. The body is unaffected — `users.mobile` is
        // the login identity and is NOT NULL, so the host can always reach them either way.
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

    /**
     * Whether this violation is the one-per-target rule rather than a genuine bug.
     *
     * <p>Matched on the index name in the driver's own message; the match itself lives in
     * {@link ConstraintViolations}, which several services share against their own index names
     * (D170). Named so the catch block reads as the rule it is enforcing rather than as a string
     * comparison.
     */
    private static boolean isDuplicateInterest(DataIntegrityViolationException violation) {
        return ConstraintViolations.isOn(violation, ONE_PER_TARGET_INDEX);
    }

    /**
     * The 409 the contract declares for {@code flatmateRoomInterest} and {@code flatmateGroupJoin}
     * — {@code already_interested}.
     *
     * <p>One message for both doors, because the row they collide on is the same row and the
     * requester's question after a refused press is the same either way: did the host hear me the
     * first time. They did.
     *
     * <p>Only the sentence is written here. {@link FlatmateConflicts} appends the marker the client
     * routes on, so nothing can be added after it by accident — see that class for why the position
     * matters (D182).
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
