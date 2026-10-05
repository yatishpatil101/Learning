package com.draazy.api.catalog.locality;

import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.ReportingPolicy;

/** Listing counts stay outside the entity because the cached DB column is not trusted. */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface LocalityMapper {

    @Mapping(target = "listingCount", source = "listingCount")
    LocalityResponse toResponse(Locality locality, long listingCount);
}
