package com.punenest.api.identity.user;

import java.util.UUID;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.ReportingPolicy;

/**
 * Entity→wire mapper for the identity slice (MapStruct-generated implementation, wired as a Spring
 * bean). Replaces a hand-written {@code UserResponse.from} factory: with ~16 near-1:1 fields, a
 * generated mapper removes the transcription-error risk of a long manual constructor call and, more
 * importantly, makes the build <em>fail</em> if a new {@link UserResponse} field is left unmapped —
 * the compile-time safety net that a hand-map silently lacks.
 *
 * <p>There is no trust-sensitive shaping here (a user reading their own profile sees their own
 * unmasked data), so the whole mapping is mechanical and safe to generate. Contrast
 * {@code PropertyMapper}, where owner-contact masking is deliberately kept hand-written.
 */
// Why ERROR: an unmapped response field is a silent contract hole - the UI would receive null with
// no build signal. Failing the compile forces every new DTO field to be mapped or explicitly ignored.
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface UserMapper {

    /**
     * Map the persistence entity onto its contract-shaped public view ({@code User} schema).
     *
     * <p>{@code permissions} is ignored here rather than mapped, and the explicit ignore is doing
     * real work: it is not a column on the entity, it is a <em>resolution</em> — the account's
     * stored document intersected with its role baseline — and only the route that serves the
     * caller their own profile has any business computing it. {@code MeController} layers it on
     * after the fact. Left unlisted, the {@code ERROR} policy above would fail
     * the build; silently mapped, every directory read would start claiming to answer a question it
     * never asked the permission model.
     *
     * <p>{@code flagged} and {@code flagReason} are ignored for the mirror-image reason. They
     * <em>are</em> columns, and mapping them would compile and look tidy — which is the trap. This
     * mapper serves {@code GET /auth/me} and every profile read, so a mechanical mapping would put
     * a moderator's private note onto the wire that goes to the person it is about. Only
     * {@code moderation.user.UserAdminService} copies them across, on the routes whose whole
     * audience is the back office.
     */
    @Mapping(target = "permissions", ignore = true)
    @Mapping(target = "flagged", ignore = true)
    @Mapping(target = "flagReason", ignore = true)
    UserResponse toResponse(User user);

    /** Opaque-id convention: the wire exposes the UUID as a string. Shared by every id field here. */
    default String map(UUID value) {
        return value == null ? null : value.toString();
    }
}
