package com.draazy.api.content;

import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Public CMS reads — announcements, services directory, FAQs, and banners. All four are small
 * editor-maintained lists that do not grow with the platform, so every one is returned as a bare
 * array (api-standards.md §5.1).
 */
@Service
public class ContentService {

    private final AnnouncementRepository announcements;
    private final CmsServiceRepository services;
    private final FaqRepository faqs;
    private final BannerRepository banners;
    private final ContentMapper mapper;

    public ContentService(AnnouncementRepository announcements, CmsServiceRepository services,
            FaqRepository faqs, BannerRepository banners, ContentMapper mapper) {
        this.announcements = announcements;
        this.services = services;
        this.faqs = faqs;
        this.banners = banners;
        this.mapper = mapper;
    }

    /** Active announcements currently in window. */
    @Transactional(readOnly = true)
    public List<AnnouncementResponse> listAnnouncements() {
        return announcements.findActive(Instant.now()).stream()
                .map(mapper::toResponse)
                .toList();
    }

    /** Non-archived services. */
    @Transactional(readOnly = true)
    public List<CmsServiceResponse> listServices() {
        return services.findByArchivedFalse().stream()
                .map(mapper::toResponse)
                .toList();
    }

    /** Non-archived FAQs. */
    @Transactional(readOnly = true)
    public List<FaqResponse> listFaqs() {
        return faqs.findByArchivedFalse().stream()
                .map(mapper::toResponse)
                .toList();
    }

    /** Non-archived banners, ordered by position. */
    @Transactional(readOnly = true)
    public List<BannerResponse> listBanners() {
        return banners.findByArchivedFalseOrderByPositionAsc().stream()
                .map(mapper::toResponse)
                .toList();
    }
}
