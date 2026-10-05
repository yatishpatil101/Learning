package com.draazy.api.content;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.persistence.SoftDeleteEntity;
import com.draazy.api.common.web.Ids;
import com.draazy.api.security.AuthPrincipal;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AdminContentService {

    // These stay bare arrays because they are editor-curated reference data (api-standards.md §5.1).
    static final int MAX_ITEMS = 500;

    private static final Sort NEWEST_FIRST = Sort.by(Sort.Direction.DESC, "createdAt");

    private final AnnouncementRepository announcements;
    private final CmsServiceRepository services;
    private final FaqRepository faqs;
    private final BannerRepository banners;
    private final AuditService audit;

    public AdminContentService(AnnouncementRepository announcements, CmsServiceRepository services,
            FaqRepository faqs, BannerRepository banners, AuditService audit) {
        this.announcements = announcements;
        this.services = services;
        this.faqs = faqs;
        this.banners = banners;
        this.audit = audit;
    }

    @Transactional(readOnly = true)
    public List<ContentItem> list(String type) {
        PageRequest capped = PageRequest.of(0, MAX_ITEMS, NEWEST_FIRST);
        List<? extends SoftDeleteEntity> rows = switch (require(type)) {
            case ContentTypes.ANNOUNCEMENTS -> announcements.findAll(capped).getContent();
            case ContentTypes.SERVICES -> services.findAll(capped).getContent();
            case ContentTypes.FAQS -> faqs.findAll(capped).getContent();
            default -> banners.findAll(capped).getContent();
        };
        return rows.stream().map(ContentItem::from).toList();
    }

    @Transactional
    public ContentItem create(AuthPrincipal caller, String type, ContentWrite write) {
        String kind = require(type);
        requireFor(kind, write);
        checkSeverity(kind, write);
        SoftDeleteEntity saved = switch (kind) {
            case ContentTypes.ANNOUNCEMENTS -> {
                AnnouncementEntity e = new AnnouncementEntity();
                e.apply(write);
                yield announcements.save(e);
            }
            case ContentTypes.SERVICES -> {
                CmsServiceEntity e = new CmsServiceEntity();
                e.apply(write);
                yield services.save(e);
            }
            case ContentTypes.FAQS -> {
                FaqEntity e = new FaqEntity();
                e.apply(write);
                yield faqs.save(e);
            }
            default -> {
                BannerEntity e = new BannerEntity();
                e.apply(write);
                yield banners.save(e);
            }
        };
        audit.record(caller, "content.create", kind, saved.getId().toString());
        return ContentItem.from(saved);
    }

    @Transactional
    public ContentItem update(AuthPrincipal caller, String type, String id, ContentWrite write) {
        String kind = require(type);
        checkSeverity(kind, write);
        SoftDeleteEntity entity = load(kind, id);
        applyTo(entity, write);
        audit.record(caller, "content.update", kind, entity.getId().toString());
        return ContentItem.from(entity);
    }

    @Transactional
    public ContentItem archive(AuthPrincipal caller, String type, String id) {
        String kind = require(type);
        SoftDeleteEntity entity = load(kind, id);

        // Idempotent on purpose: two ops clicking Archive on the same row is not a conflict, and a
        // 409 here would only teach them to reload and click again.
        if (!entity.isArchived()) {
            entity.archive("Archived by " + caller.role());
            audit.record(caller, "content.archive", kind, entity.getId().toString());
        }
        return ContentItem.from(entity);
    }

    @Transactional
    public ContentItem restore(AuthPrincipal caller, String type, String id) {
        String kind = require(type);
        SoftDeleteEntity entity = load(kind, id);
        if (entity.isArchived()) {
            entity.restore();
            audit.record(caller, "content.restore", kind, entity.getId().toString());
        }
        return ContentItem.from(entity);
    }

    private static void applyTo(SoftDeleteEntity entity, ContentWrite write) {
        switch (entity) {
            case AnnouncementEntity a -> a.apply(write);
            case CmsServiceEntity s -> s.apply(write);
            case FaqEntity f -> f.apply(write);
            case BannerEntity b -> b.apply(write);
            default -> throw new IllegalStateException("Not a CMS entity");
        }
    }

    private SoftDeleteEntity load(String kind, String id) {
        Optional<UUID> parsed = Ids.parseUuid(id);
        if (parsed.isEmpty()) {
            throw NotFoundException.of("Content item");
        }
        UUID key = parsed.get();
        Optional<? extends SoftDeleteEntity> found = switch (kind) {
            case ContentTypes.ANNOUNCEMENTS -> announcements.findById(key);
            case ContentTypes.SERVICES -> services.findById(key);
            case ContentTypes.FAQS -> faqs.findById(key);
            default -> banners.findById(key);
        };
        return found.orElseThrow(() -> NotFoundException.of("Content item"));
    }

    // The one field each type cannot be created without.
    private static void requireFor(String kind, ContentWrite w) {
        String missing = switch (kind) {
            case ContentTypes.ANNOUNCEMENTS -> blank(w.title()) ? "title" : null;
            case ContentTypes.SERVICES -> blank(w.name()) ? "name" : null;
            case ContentTypes.FAQS -> blank(w.question()) ? "question" : null;
            default -> blank(w.image()) ? "image" : null;
        };
        if (missing != null) {
            throw new BadRequestException("A " + kind + " item needs '" + missing + "'");
        }
    }

    // The spec and this check both describe the DB constraint, not each other.
    // These are not a Java enum because the column is `text` with a `CHECK` constraint (the migration).
    private static final Set<String> SEVERITIES = Set.of("info", "success", "warning");

    // Null passes, because null means "leave alone" on PATCH and "no severity" on POST, and the column is nullable.
    private static void checkSeverity(String kind, ContentWrite w) {
        if (!ContentTypes.ANNOUNCEMENTS.equals(kind) || w.severity() == null) {
            return;
        }
        if (!SEVERITIES.contains(w.severity())) {
            throw new BadRequestException(
                    "severity must be one of info, success, warning");
        }
    }

    /** Reject an unknown {@code {type}} before it can silently fall through to banners. */
    private static String require(String type) {
        return switch (type) {
            case ContentTypes.ANNOUNCEMENTS, ContentTypes.SERVICES, ContentTypes.FAQS,
                    ContentTypes.BANNERS -> type;
            case null, default -> throw new NotFoundException("Unknown content type: " + type);
        };
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
