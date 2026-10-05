package com.draazy.api.content;

import com.draazy.api.common.persistence.SoftDeleteEntity;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record ContentItem(
        UUID id,
        String type,
        boolean archived,
        Instant createdAt,
        String title,
        String body,
        String severity,
        Instant startsAt,
        Instant endsAt,
        Boolean active,
        String name,
        String icon,
        String description,
        String link,
        String question,
        String answer,
        String category,
        String image,
        String headline,
        Integer position,
        Map<String, Map<String, String>> translations) {

    static ContentItem from(SoftDeleteEntity entity) {
        return switch (entity) {
            case AnnouncementEntity a -> new ContentItem(a.getId(), ContentTypes.ANNOUNCEMENTS,
                    a.isArchived(), a.getCreatedAt(), a.getTitle(), a.getBody(), a.getSeverity(),
                    a.getStartsAt(), a.getEndsAt(), a.isActive(),
                    null, null, null, null, null, null, null, null, null, null,
                    a.getTranslations());
            case CmsServiceEntity s -> new ContentItem(s.getId(), ContentTypes.SERVICES,
                    s.isArchived(), s.getCreatedAt(), null, null, null, null, null, null,
                    s.getName(), s.getIcon(), s.getDescription(), s.getLink(),
                    null, null, null, null, null, null,
                    s.getTranslations());
            case FaqEntity f -> new ContentItem(f.getId(), ContentTypes.FAQS,
                    f.isArchived(), f.getCreatedAt(), null, null, null, null, null, null,
                    null, null, null, null, f.getQuestion(), f.getAnswer(), f.getCategory(),
                    null, null, null,
                    f.getTranslations());
            case BannerEntity b -> new ContentItem(b.getId(), ContentTypes.BANNERS,
                    b.isArchived(), b.getCreatedAt(), null, null, null, null, null, null,
                    null, null, null, b.getLink(), null, null, null,
                    b.getImage(), b.getHeadline(), b.getPosition(),
                    b.getTranslations());
            default -> throw new IllegalStateException(
                    "Not a CMS entity: " + entity.getClass().getName());
        };
    }
}
