package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.common.validation.IndianMobile;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Rooms and groups — the supply side (contract tag {@code Engagement}). Lists are public, writes
 * authenticated; creates are consumer-role-gated because a host is somebody who lives there.
 */
@RestController
public class FlatmateSupplyController {

    private final FlatmateSupplyService service;
    private final FlatmateOwnerConsentService consentService;

    public FlatmateSupplyController(FlatmateSupplyService service,
            FlatmateOwnerConsentService consentService) {
        this.service = service;
        this.consentService = consentService;
    }

    // ---- rooms ----

    /** {@code GET /flatmates/rooms} (contract {@code listFlatmateRooms}) — public. */
    @GetMapping(Routes.Flatmates.ROOMS)
    public PageResponse<FlatmateRoomFeedDto> rooms(
            @RequestParam(required = false) String locality,
            @RequestParam(required = false) String gender,
            @RequestParam(required = false) String food,
            @RequestParam(required = false) String roomType,
            @RequestParam(required = false) String furnishing,
            @RequestParam(required = false) String bhk,
            @RequestParam(required = false) Long minBudget,
            @RequestParam(required = false) Long maxBudget,
            @RequestParam(required = false) Boolean verifiedOnly,
            @PageableDefault(size = 20) Pageable pageable) {
        RoomFacets facets = new RoomFacets(
                locality, gender, food, roomType, furnishing, bhk, minBudget, maxBudget,
                verifiedOnly);
        return PageResponse.of(
                service.roomFeed(facets, Pageables.unsorted(pageable)), dto -> dto);
    }

    /** {@code POST /flatmates/rooms} (contract {@code createFlatmateRoom}). */
    @PostMapping(Routes.Flatmates.ROOMS)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAnyRole('" + Roles.BUYER + "', '" + Roles.OWNER + "')")
    public FlatmateRoomDto createRoom(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody FlatmateRoomCreateRequest body) {
        return service.createRoom(principal, body);
    }

    /**
     * {@code PATCH /flatmates/rooms/{id}} (contract {@code updateFlatmateRoom}). Same role guard as
     * the create: an account that may not write a flatmate ad may not rewrite one.
     */
    @PatchMapping(Routes.Flatmates.ROOM_BY_ID)
    @PreAuthorize("hasAnyRole('" + Roles.BUYER + "', '" + Roles.OWNER + "')")
    public FlatmateRoomDto updateRoom(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody FlatmateRoomCreateRequest body) {
        return service.updateRoom(principal, id, body);
    }

    /** {@code PATCH /flatmates/rooms/{id}/seats} (contract {@code setRoomSeats}). */
    @PatchMapping(Routes.Flatmates.ROOM_SEATS)
    public FlatmateRoomDto setRoomSeats(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody SeatsRequest body) {
        return service.setSeats(principal, id, body.seatsOpen());
    }

    /** {@code PATCH /flatmates/rooms/{id}/occupants} (contract {@code setRoomOccupants}). */
    @PatchMapping(Routes.Flatmates.ROOM_OCCUPANTS)
    public FlatmateRoomDto setRoomOccupants(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody OccupantsRequest body) {
        return service.setOccupants(principal, id, body.occupants());
    }

    /**
     * {@code POST /flatmates/rooms/{id}/agreement/reissue} (contract
     * {@code reissueJointAgreement}) — 202, because the reissue is an errand rather than a record.
     */
    @PostMapping(Routes.Flatmates.ROOM_AGREEMENT_REISSUE)
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void reissue(@CurrentUser AuthPrincipal principal, @PathVariable UUID id) {
        service.reissueAgreement(principal, id);
    }

    /** {@code POST /flatmates/rooms/{id}/interest} (contract {@code flatmateRoomInterest}) — 201. */
    @PostMapping(Routes.Flatmates.ROOM_INTEREST)
    @ResponseStatus(HttpStatus.CREATED)
    public void roomInterest(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody(required = false) FlatmateSeekerController.InterestRequest body) {
        service.roomInterest(principal, id,
                body == null ? null : body.share(),
                body == null ? null : body.message());
    }

    // ---- groups ----

    /** {@code GET /flatmates/groups} (contract {@code listFlatmateGroups}) — public, cards. */
    @GetMapping(Routes.Flatmates.GROUPS)
    public PageResponse<FlatmateGroupFeedDto> groups(
            @RequestParam(required = false) String locality,
            @RequestParam(required = false) String policy,
            @RequestParam(required = false) Long minRent,
            @RequestParam(required = false) Long maxRent,
            @RequestParam(required = false) Boolean verifiedOnly,
            @PageableDefault(size = 20) Pageable pageable) {
        GroupFacets facets = new GroupFacets(locality, policy, minRent, maxRent, verifiedOnly);
        return PageResponse.of(
                service.groupFeed(facets, Pageables.unsorted(pageable)), dto -> dto);
    }

    /** {@code POST /flatmates/groups} (contract {@code createFlatmateGroup}). */
    @PostMapping(Routes.Flatmates.GROUPS)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAnyRole('" + Roles.BUYER + "', '" + Roles.OWNER + "')")
    public FlatmateGroupDto createGroup(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody FlatmateGroupCreateRequest body) {
        return service.createGroup(principal, body);
    }

    /** {@code DELETE /flatmates/groups/{id}} (contract {@code deleteFlatmateGroup}) — 204. */
    @DeleteMapping(Routes.Flatmates.GROUP_BY_ID)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteGroup(@CurrentUser AuthPrincipal principal, @PathVariable UUID id) {
        service.deleteGroup(principal, id);
    }

    /**
     * {@code PATCH /flatmates/groups/{id}} (contract {@code updateFlatmateGroup}) — the whole group.
     * {@link #setGroupSeats} stays: one-tap "a seat just went" should not resend title, rent, policy.
     */
    @PatchMapping(Routes.Flatmates.GROUP_BY_ID)
    @PreAuthorize("hasAnyRole('" + Roles.BUYER + "', '" + Roles.OWNER + "')")
    public FlatmateGroupDto updateGroup(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody FlatmateGroupCreateRequest body) {
        return service.updateGroup(principal, id, body);
    }

    /** {@code PATCH /flatmates/groups/{id}/seats} (contract {@code setGroupSeats}). */
    @PatchMapping(Routes.Flatmates.GROUP_SEATS)
    public FlatmateGroupDto setGroupSeats(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody SeatsRequest body) {
        return service.setGroupSeats(principal, id, body.seatsOpen());
    }

    /** {@code POST /flatmates/groups/{id}/join} (contract {@code flatmateGroupJoin}) — 201. */    @PostMapping(Routes.Flatmates.GROUP_JOIN)
    @ResponseStatus(HttpStatus.CREATED)
    public FlatmateRequestDto join(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody(required = false) FlatmateSeekerController.InterestRequest body) {
        return service.join(principal, id,
                body == null ? null : body.share(),
                body == null ? null : body.message());
    }

    /**
     * {@code POST /flatmates/groups/{id}/owner-consent} (contract {@code requestOwnerConsent}). 200
     * for both calls; the body says which happened, since the client renders a different next step.
     */
    @PostMapping(Routes.Flatmates.GROUP_OWNER_CONSENT)
    public ConsentResult ownerConsent(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody OwnerConsentRequest body) {
        boolean recorded = service.ownerConsent(principal, id, body.ownerMobile(), body.otp());
        return recorded ? ConsentResult.recorded() : ConsentResult.sent(resendAfterSeconds());
    }

    /**
     * {@code POST /flatmates/owner-consent} (contract {@code requestStandaloneOwnerConsent}) — the
     * group-less twin of {@link #ownerConsent}: docs/flows/consumer/flatmates.md §5.
     */
    @PostMapping(Routes.Flatmates.OWNER_CONSENT)
    public ConsentResult ownerConsent(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody OwnerConsentRequest body) {
        String mobile = consentService.normalise(principal, body.ownerMobile());
        if (body.otp() == null || body.otp().isBlank()) {
            consentService.send(mobile);
            return ConsentResult.sent(resendAfterSeconds());
        }
        consentService.record(principal, mobile, body.otp(), null);
        return ConsentResult.recorded();
    }

    /**
     * The gap before another code may be sent. Reported rather than guessed: a timer the client
     * picks is wrong in every environment whose cooldown differs.
     */
    private int resendAfterSeconds() {
        return consentService.resendCooldownSeconds();
    }

    /**
     * Contract's inline owner-consent body. {@code otp} absent means "send one"; present means
     * "record the consent".
     */
    public record OwnerConsentRequest(
            @NotBlank
            @IndianMobile
            String ownerMobile,
            @Size(min = 6, max = 6) String otp) {
    }

    /**
     * @param consentRecorded false when a code was just sent, true once the owner confirmed
     * @param resendAfterSeconds null once consent is recorded — nothing left to resend
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ConsentResult(boolean consentRecorded, Integer resendAfterSeconds) {

        /** A code is on its way; the client counts {@code resendAfterSeconds} down before offering another. */
        static ConsentResult sent(int resendAfterSeconds) {
            return new ConsentResult(false, resendAfterSeconds);
        }

        /** The owner confirmed. */
        static ConsentResult recorded() {
            return new ConsentResult(true, null);
        }
    }

    /** The contract's inline seats body, shared by the room and group seat operations. */
    public record SeatsRequest(@NotNull @Min(0) Integer seatsOpen) {
    }

    /** The contract's inline occupants body. The server clamps and echoes the clamped value. */
    public record OccupantsRequest(@NotNull @Min(0) Integer occupants) {
    }
}
