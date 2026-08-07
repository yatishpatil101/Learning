package com.punenest.api.catalog.society;

import com.punenest.api.catalog.property.PropertySummary;
import java.math.BigDecimal;
import java.util.List;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.ReportingPolicy;

/**
 * {@link Society} to the contract's {@code Society} / {@code SocietyDetail} records.
 *
 * <p>Everything the row cannot answer for itself arrives as an argument: the two counts (computed,
 * because the stored columns are not maintained), whether the caller follows it (a property of the
 * caller, not of the society), and the detail aggregates. {@code unmappedTargetPolicy = ERROR} means
 * a field added to either record without a source breaks the build instead of shipping a silent
 * {@code null}.
 */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface SocietyMapper {

    @Mapping(target = "listingCount", source = "listingCount")
    @Mapping(target = "followerCount", source = "followerCount")
    @Mapping(target = "followedByMe", source = "followedByMe")
    @Mapping(target = "avgRating", source = "avgRating")
    @Mapping(target = "reviewCount", source = "reviewCount")
    SocietyResponse toResponse(Society society, long listingCount, long followerCount,
            boolean followedByMe, BigDecimal avgRating, long reviewCount);

    @Mapping(target = "listingCount", source = "listingCount")
    @Mapping(target = "followerCount", source = "followerCount")
    @Mapping(target = "followedByMe", source = "followedByMe")
    @Mapping(target = "avgRating", source = "avgRating")
    @Mapping(target = "reviewCount", source = "reviewCount")
    @Mapping(target = "homes", source = "homes")
    @Mapping(target = "reviews", source = "reviews")
    SocietyDetailResponse toDetail(Society society, long listingCount, long followerCount,
            boolean followedByMe, BigDecimal avgRating, long reviewCount,
            List<PropertySummary> homes, List<Object> reviews);
}
