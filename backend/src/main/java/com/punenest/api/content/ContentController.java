package com.punenest.api.content;

import com.punenest.api.common.web.Routes;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /announcements}, {@code /services}, {@code /faqs}, {@code /banners} — public editorial
 * content reads.
 *
 * <p>All four are {@code security: []} in the contract: they render the marketing surface an
 * anonymous visitor sees before signing in. {@code SecurityConfig} already permits GET on these
 * route constants.
 */
@RestController
public class ContentController {

    private final ContentService contentService;

    public ContentController(ContentService contentService) {
        this.contentService = contentService;
    }

    /** {@code GET /announcements} (contract {@code listAnnouncements}) — active, in window. */
    @GetMapping(Routes.Content.ANNOUNCEMENTS)
    public List<AnnouncementResponse> announcements() {
        return contentService.listAnnouncements();
    }

    /** {@code GET /services} (contract {@code listCmsServices}) — non-archived. */
    @GetMapping(Routes.Content.SERVICES)
    public List<CmsServiceResponse> services() {
        return contentService.listServices();
    }

    /** {@code GET /faqs} (contract {@code listFaqs}) — non-archived. */
    @GetMapping(Routes.Content.FAQS)
    public List<FaqResponse> faqs() {
        return contentService.listFaqs();
    }

    /** {@code GET /banners} (contract {@code listBanners}) — non-archived, ordered by position. */
    @GetMapping(Routes.Content.BANNERS)
    public List<BannerResponse> banners() {
        return contentService.listBanners();
    }
}
