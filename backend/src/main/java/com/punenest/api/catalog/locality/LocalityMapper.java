package com.punenest.api.catalog.locality;

import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.ReportingPolicy;

/**
 * {@link Locality} to the contract's {@code Locality} / {@code LocalityDetail} records.
 *
 * <p>Both methods take the listing count as a second argument rather than reading it from the
 * entity, because the entity deliberately does not map {@code localities.listing_count} — see
 * {@code catalog.property.ListingCounts} for why that column is not trusted.
 */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface LocalityMapper {

    @Mapping(target = "listingCount", source = "listingCount")
    LocalityResponse toResponse(Locality locality, long listingCount);

    @Mapping(target = "listingCount", source = "listingCount")
    LocalityDetailResponse toDetail(Locality locality, long listingCount);
}
