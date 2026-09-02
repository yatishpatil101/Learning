package com.draazy.api.leads.contact;

import com.draazy.api.common.trust.ContactVisibility;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.identity.user.User;
import java.util.Set;
import java.util.UUID;
import org.mapstruct.Context;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.ReportingPolicy;

/**
 * Entity→wire mapper for the contacts feature (MapStruct-generated, wired as a Spring bean).
 *
 * <p>The mechanical half — id, propertyId, status, createdAt — is generated, with
 * {@code unmappedTargetPolicy = ERROR} so a new field on {@link ContactRequestResponse} cannot ship
 * silently null.
 *
 * <p><strong>Security carve-out (ADR-019).</strong> Both mobile-bearing projections are hand-written
 * {@code default} methods, exactly as {@code PropertyMapper} does for the owner mobile: the rule that
 * a requester's number is masked until the owner approves is the whole point of this surface, and it
 * belongs in code a reviewer reads, not in a generated {@code @Mapping(expression = ...)}. The
 * masking helper is {@code private} so MapStruct can never adopt it as an implicit
 * {@code String→String} converter and apply it to some unrelated field — or, far worse, stop applying
 * it here after a refactor.
 */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface ContactMapper {

    /**
     * Project one stored request for the owner's inbox.
     *
     * <p>Two sources by design: the row knows the status and timestamps, but the requester's identity
     * lives in {@code identity.user} and is resolved once per inbox page by the service — passing the
     * loaded {@link User} in keeps this mapper free of a repository and the read N+1-safe.
     *
     * @param request    the stored row
     * @param requester  the asking user, already loaded
     * @param visibility {@link ContactVisibility#REVEALED} only when {@code request.status} is
     *                   {@code approved}; the service derives it via
     *                   {@link ContactStatuses#revealsContact} so there is one reveal rule, not two
     */
    @Mapping(target = "id", source = "request.id")
    @Mapping(target = "propertyId", source = "request.propertyId")
    @Mapping(target = "status", source = "request.status")
    @Mapping(target = "createdAt", source = "request.createdAt")
    @Mapping(target = "requester", source = "requester")
    @Mapping(target = "contact", source = "requester")
    ContactRequestResponse toResponse(ContactRequest request, User requester,
            @Context ContactVisibility visibility, @Context Set<UUID> verifiedIds);

    /**
     * The always-masked side of the request. Hand-written and unconditional: there is no argument that
     * can make this emit a raw number, which is the property we want a reviewer to be able to confirm
     * by reading five lines.
     *
     * <p>{@code verifiedIds} arrives as a context rather than being looked up here because the badge
     * is a batched, id-keyed answer computed once per page — asking per party would reintroduce the
     * N+1 this surface already avoids for the users themselves.
     */
    default ContactRequestResponse.Party toParty(User requester, @Context Set<UUID> verifiedIds) {
        if (requester == null) {
            return null;
        }
        return new ContactRequestResponse.Party(
                requester.getName(), maskMobile(requester.getMobile()), "buyer",
                verifiedIds != null && verifiedIds.contains(requester.getId()));
    }

    /**
     * The revealed side. Returns {@code null} — which serializes as the contract's absent
     * {@code contact} object — for every visibility other than
     * {@link ContactVisibility#REVEALED}, so the default of this method is "reveal nothing".
     */
    default ContactRequestResponse.Contact toContact(User requester,
            @Context ContactVisibility visibility) {
        if (requester == null || visibility != ContactVisibility.REVEALED) {
            return null;
        }
        return new ContactRequestResponse.Contact(requester.getName(), requester.getMobile());
    }

    /** Opaque-id convention: the wire exposes the UUID as a string. */
    default String map(UUID value) {
        return value == null ? null : value.toString();
    }

    /**
     * Mask a 10-digit mobile to the contract form {@code 98XXXXX210}. Delegates to
     * {@link MobileMask} — the single definition shared with every other trust surface, extracted in
     * slice 4 when this rule was about to acquire a sixth copy. The UI's prettier {@code maskPhone}
     * rendering is applied client-side to whatever string it receives.
     *
     * <p>Kept as a {@code private} wrapper rather than calling {@link MobileMask} inline from the
     * mapping methods: a {@code String→String} method visible to MapStruct can be adopted as an
     * implicit converter and applied to unrelated string fields (§8.1).
     */
    private String maskMobile(String mobile) {
        return MobileMask.mask(mobile);
    }
}
