package com.draazy.api.catalog.locality;

import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.ReportingPolicy;

@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface LocalityMapper {

    @Mapping(target = "liveListings", source = "stats.live")
    @Mapping(target = "indexable", expression = "java(stats.indexable())")
    @Mapping(target = "avgRent", source = "stats.avgRent")
    @Mapping(target = "ratePerSqft", source = "stats.ratePerSqft")
    @Mapping(target = "fromPrice", source = "stats.fromPrice")
    LocalityResponse toResponse(Locality locality, LocalityStats stats);
}
