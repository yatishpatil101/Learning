package com.punenest.api.content;

import java.util.UUID;
import org.mapstruct.Mapper;
import org.mapstruct.ReportingPolicy;

/**
 * Entity→wire mapper for the four CMS features. Fully mechanical — no trust shaping needed,
 * these are public read-only surfaces of editor-curated rows.
 */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface ContentMapper {

    AnnouncementResponse toResponse(AnnouncementEntity entity);

    CmsServiceResponse toResponse(CmsServiceEntity entity);

    FaqResponse toResponse(FaqEntity entity);

    BannerResponse toResponse(BannerEntity entity);

    default String map(UUID value) {
        return value == null ? null : value.toString();
    }
}
