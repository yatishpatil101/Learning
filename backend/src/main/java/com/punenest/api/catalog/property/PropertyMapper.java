package com.punenest.api.catalog.property;

import com.punenest.api.common.trust.ContactVisibility;
import com.punenest.api.identity.user.User;
import java.util.UUID;
import org.mapstruct.Context;
import org.mapstruct.Mapper;
import org.mapstruct.ReportingPolicy;

/**
 * Entity→wire mapper for the catalogue (MapStruct-generated implementation, wired as a Spring bean).
 * Replaces the hand-written {@code PropertyResponse.from}/{@code PropertySummary.from} factories: the
 * {@code Property} detail shape is ~43 near-1:1 fields, exactly where a manual constructor call is
 * both tedious and a silent transcription-error hazard. Generating it gives compile-time
 * unmapped-target checking as the DTOs evolve.
 *
 * <p><strong>Security carve-out (ADR-019, badge-not-gate):</strong> owner-contact masking is
 * <em>not</em> generated — {@link #toOwner(User, ContactVisibility)} is hand-written and explicit so
 * the single most important trust rule on this surface (never emit a raw owner mobile before the
 * contact gate) stays visible in code review rather than buried in a generated
 * {@code @Mapping(expression=...)}. The mechanical fields are generated; the trust decision is
 * authored. {@code PropertySummary} carries no owner contact at all, so its card mapping is fully
 * mechanical.
 */
// Why ERROR: an unmapped response field is a silent contract hole - the UI would receive null with
// no build signal. Failing the compile forces every new DTO field to be mapped or explicitly ignored.
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface PropertyMapper {

    /** Card projection for search/lists — fully mechanical, no owner contact by construction. */
    PropertySummary toSummary(Property property);

    /**
     * Full detail projection. The {@code owner} field is shaped by {@link #toOwner(User,
     * ContactVisibility)} according to the caller's contact-gate decision.
     *
     * <p>The visibility is a required argument rather than an overload defaulting to masked, on
     * purpose: every call site must state which trust posture it is rendering under, so adding a new
     * detail endpoint cannot accidentally inherit "reveal".
     */
    PropertyResponse toResponse(Property property, @Context ContactVisibility visibility);

    /**
     * Hand-written owner projection embedded in the detail — the trust boundary. Masked
     * ({@code 98XXXXX210}) unless the caller's gate status for this listing is {@code owner} or
     * {@code approved}, which is exactly what {@link ContactVisibility#REVEALED} encodes. Kept
     * explicit (not generated) so the masking cannot be silently lost in a DTO refactor, and so the
     * reveal condition is a single readable line rather than a generated expression.
     */
    default PropertyResponse.Owner toOwner(User owner, @Context ContactVisibility visibility) {
        if (owner == null) {
            return null;
        }
        String mobile = visibility == ContactVisibility.REVEALED
                ? owner.getMobile()
                : maskMobile(owner.getMobile());
        return new PropertyResponse.Owner(
                owner.getId().toString(), owner.getName(), mobile, owner.isVerified());
    }

    /** Opaque-id convention: the wire exposes the UUID as a string. Shared by every id field here. */
    default String map(UUID value) {
        return value == null ? null : value.toString();
    }

    /**
     * Mask a 10-digit mobile to the contract form {@code 98XXXXX210} — first two + last three digits
     * kept, the middle five replaced by {@code X}. Defensive: anything not a clean 10-digit number is
     * returned as {@code null} rather than leaking a partial value. {@code private} so MapStruct never
     * mistakes it for an implicit {@code String→String} mapping and applies it to other fields.
     */
    private String maskMobile(String mobile) {
        if (mobile == null) {
            return null;
        }
        String digits = mobile.replaceAll("\\D", "");
        if (digits.length() != 10) {
            return null;
        }
        return digits.substring(0, 2) + "XXXXX" + digits.substring(7);
    }
}
