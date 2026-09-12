package com.draazy.api.moderation.note;

import java.util.UUID;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.ReportingPolicy;

/**
 * {@link InternalNote} to {@link InternalNoteResponse}.
 *
 * <p>Two sources, because one of the response's fields is not on the entity: {@code authorName} is
 * resolved from {@code users} by the service and handed in beside the row. It is not a column on
 * {@code internal_notes} on purpose — a denormalised name copy is wrong the day the account is
 * renamed, and the note is the last place anybody would look for the stale copy.
 *
 * <p>{@code unmappedTargetPolicy = ERROR}, as everywhere. That is load-bearing here rather than
 * decorative: this note is editable, so it carries an {@code updatedAt} the immutable note types
 * before it did not, and a target field nobody fills is a build failure instead of a null on an
 * admin screen.
 */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface InternalNoteMapper {

    @Mapping(target = "authorName", source = "authorName")
    InternalNoteResponse toResponse(InternalNote note, String authorName);

    default String map(UUID value) {
        return value == null ? null : value.toString();
    }
}
