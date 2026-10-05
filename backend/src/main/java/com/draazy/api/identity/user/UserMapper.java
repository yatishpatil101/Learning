package com.draazy.api.identity.user;

import java.util.UUID;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.ReportingPolicy;

// Why ERROR: an unmapped response field is a silent contract hole - the UI would receive null with
// no build signal. Failing the compile forces every new DTO field to be mapped or explicitly ignored.
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface UserMapper {

    // permissions is ignored because it is resolved by SelfProfile, not stored on User.
    @Mapping(target = "permissions", ignore = true)
    @Mapping(target = "desks", ignore = true)
    @Mapping(target = "flagged", ignore = true)
    @Mapping(target = "flagReason", ignore = true)
    @Mapping(target = "badgeSource", ignore = true)
    UserResponse toResponse(User user);

    /** Opaque-id convention: the wire exposes the UUID as a string. Shared by every id field here. */
    default String map(UUID value) {
        return value == null ? null : value.toString();
    }
}
