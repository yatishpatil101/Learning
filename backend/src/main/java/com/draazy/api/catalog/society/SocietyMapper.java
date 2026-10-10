package com.draazy.api.catalog.society;

import java.math.BigDecimal;
import java.util.List;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.ReportingPolicy;

/** Counts and ratings arrive as arguments: they are computed over the merge family, not read off the row. */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface SocietyMapper {

    @Mapping(target = "listingCount", source = "listingCount")
    @Mapping(target = "avgRating", source = "avgRating")
    @Mapping(target = "reviewCount", source = "reviewCount")
    SocietyResponse toResponse(Society society, long listingCount, BigDecimal avgRating, long reviewCount);

    @Mapping(target = "listingCount", source = "stats.live")
    @Mapping(target = "forSale", source = "stats.forSale")
    @Mapping(target = "forRent", source = "stats.forRent")
    @Mapping(target = "psf", source = "stats.psf")
    @Mapping(target = "rentAvg", source = "stats.rentAvg")
    @Mapping(target = "homes", source = "homes")
    SocietyDetailResponse toDetail(Society society, SocietyHomeStats stats, List<SocietyHome> homes);

    @Mapping(target = "avgRating", source = "avgRating")
    @Mapping(target = "reviewCount", source = "reviewCount")
    SocietyBrief toBrief(Society society, BigDecimal avgRating, long reviewCount);

    SocietyCandidateResponse toCandidate(Society society);
}