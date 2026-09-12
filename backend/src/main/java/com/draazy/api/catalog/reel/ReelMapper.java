package com.draazy.api.catalog.reel;

import org.mapstruct.Mapper;
import org.mapstruct.ReportingPolicy;

/**
 * {@link Reel} to the contract's {@code Reel} record. Every name matches, so MapStruct writes the
 * whole thing; nothing on a published clip is private, so there is no carve-out.
 */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface ReelMapper {

    ReelResponse toResponse(Reel reel);
}
