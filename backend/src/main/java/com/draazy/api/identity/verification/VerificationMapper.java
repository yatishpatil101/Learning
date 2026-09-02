package com.draazy.api.identity.verification;

import org.mapstruct.Mapper;
import org.mapstruct.ReportingPolicy;

/**
 * Entity→wire mapper for the identity badge (MapStruct-generated, wired as a Spring bean).
 *
 * <p>Fully mechanical, and deliberately so: unlike the contact surfaces there is <em>no</em> trust
 * carve-out here, because nothing on this shape needs masking at read time — the sensitive value was
 * already reduced to a last-4 before it was written, and the raw Aadhaar never existed on our side at
 * all. Masking at rest rather than at render is what makes this mapper safe to generate.
 *
 * <p>{@code unmappedTargetPolicy = ERROR} so a new field on {@link AadhaarVerificationResponse}
 * cannot ship silently null.
 *
 * <p>The "no row" shape is {@link AadhaarVerificationResponse#none()} and lives on the DTO, not here:
 * MapStruct adopts any no-argument method returning the target type as an object factory and routes
 * the real mapping through it, which would blank out every verified badge.
 */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface VerificationMapper {

    /** Project a stored verification row. */
    AadhaarVerificationResponse toResponse(IdentityVerification verification);
}
