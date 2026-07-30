package com.punenest.api.identity.user;

import java.util.UUID;
import org.mapstruct.Mapper;
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

    /** Map the persistence entity onto its contract-shaped public view ({@code User} schema). */
    UserResponse toResponse(User user);

    /** Opaque-id convention: the wire exposes the UUID as a string. Shared by every id field here. */
    default String map(UUID value) {
        return value == null ? null : value.toString();
    }
}
