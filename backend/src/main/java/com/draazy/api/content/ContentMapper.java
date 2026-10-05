package com.draazy.api.content;

import java.util.UUID;
import org.mapstruct.Mapper;
import org.mapstruct.ReportingPolicy;

@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface ContentMapper {

    FaqResponse toResponse(FaqEntity entity);

    default String map(UUID value) {
        return value == null ? null : value.toString();
    }
}