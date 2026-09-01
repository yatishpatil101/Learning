package com.draazy.api.moderation.report;

import java.util.UUID;
import org.mapstruct.Mapper;
import org.mapstruct.ReportingPolicy;

/**
 * Entity→wire mapper for reports (api-standards.md §8.1).
 *
 * <p>A plain generated mapping with no hand-written carve-out: every field on
 * {@link ReportResponse} is a direct copy, and the one field that must <em>not</em> cross the wire
 * ({@code reporterId}) is absent from the target record, so {@code unmappedTargetPolicy = ERROR}
 * cannot be satisfied by accident — adding it to the response would be a deliberate act, not a
 * generated one.
 */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface ReportMapper {

    ReportResponse toResponse(Report entity);

    default String map(UUID value) {
        return value == null ? null : value.toString();
    }
}
