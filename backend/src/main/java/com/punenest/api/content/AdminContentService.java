package com.punenest.api.content;

import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.persistence.SoftDeleteEntity;
import com.punenest.api.common.web.Ids;
import com.punenest.api.security.AuthPrincipal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * CMS authoring — the write side of the four lists {@link ContentService} publishes.
 *
 * <p><strong>Why one polymorphic service instead of four.</strong> The contract puts all four
 * behind {@code /admin/content/{type}}, and the operations really are identical: list, create,
 * patch, archive, restore. Four controllers would be four copies of the same five methods
 * differing only in a repository reference. The per-type knowledge that genuinely differs — which
 * fields exist, which are required — lives in exactly two places: each entity's {@code apply}, and
 * {@link #requireFor}.
 *
 * <p><strong>Everything here is audited.</strong> CMS copy is the platform speaking in its own
 * voice: a banner is a promise about price, an FAQ is a statement about what the platform does with
 * a tenant's money. "Who published this and when" is not bookkeeping, it is the answer to a
 * complaint.
 */
@Service
public class AdminContentService {

    /**
     * Ceiling on a CMS list response.
     *
     * <p>These stay bare arrays because they are editor-curated reference data (api-standards.md
     * §5.1), but an array response must have a bound: nothing stops ops adding a thousand FAQs, and
     * "small in practice" is a measurement rather than a guarantee.
     */
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

    /** {@code GET /admin/content/{type}} — newest first, archived rows included. */
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

    /** {@code POST /admin/content/{type}}. */
    @Transactional
    public ContentItem create(AuthPrincipal caller, String type, ContentWrite write) {
        String kind = require(type);
        requireFor(kind, write);
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

    /** {@code PATCH /admin/content/{type}/{id}} — absent fields are left unchanged. */
    @Transactional
    public ContentItem update(AuthPrincipal caller, String type, String id, ContentWrite write) {
        String kind = require(type);
        SoftDeleteEntity entity = load(kind, id);
        applyTo(entity, write);
        audit.record(caller, "content.update", kind, entity.getId().toString());
        return ContentItem.from(entity);
    }

    /** {@code POST /admin/content/{type}/{id}/archive} — soft delete; the public list drops it. */
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

    /** {@code POST /admin/content/{type}/{id}/restore}. */
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

    /** Dispatch {@code apply} to the concrete type — the entities do not share a write interface. */
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

    /**
     * The one field each type cannot be created without.
     *
     * <p>Checked here rather than left to the database's not-null constraint so the caller gets a
     * 400 naming the field instead of a 409 naming an index.
     */
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
