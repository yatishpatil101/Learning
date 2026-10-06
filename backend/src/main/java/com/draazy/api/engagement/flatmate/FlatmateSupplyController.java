package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.settings.PhotoLimit;
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

/** Rooms and groups — the supply side (contract tag {@code Engagement}). Lists are public, writes
 * authenticated; creates are consumer-role-gated because a host is somebody who lives there. */
@RestController
public class FlatmateSupplyController {

    private final FlatmateSupplyService service;
    private final FlatmateOwnerConsentService consentService;
    private final PhotoLimit photoLimit;

    public FlatmateSupplyController(FlatmateSupplyService service,
            FlatmateOwnerConsentService consentService, PhotoLimit photoLimit) {
        this.service = service;
        this.consentService = consentService;
        this.photoLimit = photoLimit;
    }

    @PostMapping(Routes.Flatmates.ROOMS)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAnyRole('" + Roles.BUYER + "', '" + Roles.OWNER + "')")
    public FlatmateRoomDto createRoom(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody FlatmateRoomCreateRequest body) {
        photoLimit.require("A room", body.photos());
        return service.createRoom(principal, body);
    }

    /** Same role guard as the create: an account that may not write a flatmate ad may not rewrite
     * one. */
    @PatchMapping(Routes.Flatmates.ROOM_BY_ID)
    @PreAuthorize("hasAnyRole('" + Roles.BUYER + "', '" + Roles.OWNER + "')")
    public FlatmateRoomDto updateRoom(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody FlatmateRoomCreateRequest body) {
        photoLimit.require("A room", body.photos());
        return service.updateRoom(principal, id, body);
    }

    @PatchMapping(Routes.Flatmates.ROOM_SEATS)
    public FlatmateRoomDto setRoomSeats(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody SeatsRequest body) {
        return service.setSeats(principal, id, body.seatsOpen());
    }

    @PatchMapping(Routes.Flatmates.ROOM_OCCUPANTS)
    public FlatmateRoomDto setRoomOccupants(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody OccupantsRequest body) {
        return service.setOccupants(principal, id, body.occupants());
    }

    @PostMapping(Routes.Flatmates.ROOM_INTEREST)
    @ResponseStatus(HttpStatus.CREATED)
    public void roomInterest(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody(required = false) FlatmateSeekerController.InterestRequest body) {
        service.roomInterest(principal, id,
                body == null ? null : body.share(),
                body == null ? null : body.message());
    }

    @PostMapping(Routes.Flatmates.GROUPS)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAnyRole('" + Roles.BUYER + "', '" + Roles.OWNER + "')")
    public FlatmateGroupDto createGroup(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody FlatmateGroupCreateRequest body) {
        return service.createGroup(principal, body);
    }

    @DeleteMapping(Routes.Flatmates.GROUP_BY_ID)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteGroup(@CurrentUser AuthPrincipal principal, @PathVariable UUID id) {
        service.deleteGroup(principal, id);
    }

    /** Contract {@code updateFlatmateGroup}. {@link #setGroupSeats} stays: one-tap "a seat just
     * went" should not resend title, rent, policy. */
    @PatchMapping(Routes.Flatmates.GROUP_BY_ID)
    @PreAuthorize("hasAnyRole('" + Roles.BUYER + "', '" + Roles.OWNER + "')")
    public FlatmateGroupDto updateGroup(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody FlatmateGroupCreateRequest body) {
        return service.updateGroup(principal, id, body);
    }

    @PatchMapping(Routes.Flatmates.GROUP_SEATS)
    public FlatmateGroupDto setGroupSeats(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody SeatsRequest body) {
        return service.setGroupSeats(principal, id, body.seatsOpen());
    }

         @PostMapping(Routes.Flatmates.GROUP_JOIN)
    @ResponseStatus(HttpStatus.CREATED)
    public FlatmateRequestDto join(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody(required = false) FlatmateSeekerController.InterestRequest body) {
        return service.join(principal, id,
                body == null ? null : body.share(),
                body == null ? null : body.message());
    }

    /** 200 for both calls; the body says which happened. Role-guarded like the creates it serves:
     * the consent flow spends a send budget against a third party's number. */
    @PostMapping(Routes.Flatmates.OWNER_CONSENT)
    @PreAuthorize("hasAnyRole('" + Roles.BUYER + "', '" + Roles.OWNER + "')")
    public ConsentResult ownerConsent(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody OwnerConsentRequest body) {
        boolean recorded = consentService.ownerConsent(principal, body.title(), body.society(),
                body.locality(), body.ownerMobile(), body.otp());
        return recorded ? ConsentResult.recorded() : ConsentResult.sent(resendAfterSeconds());
    }

    /** Reported rather than guessed: a timer the client picks is wrong in every environment whose
     * cooldown differs. */
    private int resendAfterSeconds() {
        return consentService.resendCooldownSeconds();
    }

    /** {@code otp} absent means "send one". The address fields are deliberately not {@code @NotBlank}:
     * the rule is about the composed address, enforced in {@code FlatmateGuardrails.fingerprint}. */
    public record OwnerConsentRequest(
            @NotBlank
            @IndianMobile
            String ownerMobile,
            @Size(min = 6, max = 6) String otp,
            @Size(max = 120) String title,
            @Size(max = 120) String society,
            @Size(max = 80) String locality) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ConsentResult(boolean consentRecorded, Integer resendAfterSeconds) {

        /** A code is on its way; the client counts {@code resendAfterSeconds} down before offering another. */
        static ConsentResult sent(int resendAfterSeconds) {
            return new ConsentResult(false, resendAfterSeconds);
        }

        static ConsentResult recorded() {
            return new ConsentResult(true, null);
        }
    }

    public record SeatsRequest(@NotNull @Min(0) Integer seatsOpen) {
    }

    public record OccupantsRequest(@NotNull @Min(0) Integer occupants) {
    }
}
