package com.draazy.api.content;

import com.draazy.api.common.web.Routes;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

// These are public because anonymous visitors need the marketing surface before login.
// `SecurityConfig` already permits GET on these route constants.
@RestController
public class ContentController {

    private final ContentService contentService;

    public ContentController(ContentService contentService) {
        this.contentService = contentService;
    }

    @GetMapping(Routes.Content.FAQS)
    public List<FaqResponse> faqs() {
        return contentService.listFaqs();
    }
    }