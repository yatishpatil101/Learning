package com.draazy.api.engagement.notification;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Notification-preference access. The primary key <em>is</em> the user id, so every method on
 * {@link JpaRepository} is already caller-scoped and there is no finder here that could be handed
 * somebody else's identifier by mistake.
 */
public interface NotificationPreferenceRepository extends JpaRepository<NotificationPreference, UUID> {
}
