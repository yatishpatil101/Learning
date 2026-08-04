package com.punenest.api.engagement.notification;

import java.util.UUID;
import org.mapstruct.Mapper;
import org.mapstruct.ReportingPolicy;

/** Entity→wire mapper for notifications. Fully mechanical — no trust shaping needed. */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface NotificationMapper {

    NotificationResponse toResponse(Notification entity);

    default String map(UUID value) {
        return value == null ? null : value.toString();
    }
}
