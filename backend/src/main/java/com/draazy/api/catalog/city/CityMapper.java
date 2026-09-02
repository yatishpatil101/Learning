package com.draazy.api.catalog.city;

import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.ReportingPolicy;

/**
 * {@link City} to the contract's {@code City} record.
 *
 * <p>Two sources, because a city row cannot answer the whole question: {@code slug}, {@code name} and
 * {@code live} are the row's own, while {@code listingCount} is computed from the properties table
 * (see {@code catalog.property.ListingCounts}) rather than read from the unmaintained
 * {@code cities.listing_count} column. The second parameter is what stops that column being reachable
 * from here at all.
 */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface CityMapper {

    @Mapping(target = "listingCount", source = "listingCount")
    CityResponse toResponse(City city, long listingCount);
}
