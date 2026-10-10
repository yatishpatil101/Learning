package com.draazy.api.content;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.security.AuthPrincipal;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AdminContentService {

    // Bare arrays because FAQs are editor-curated reference data (api-standards.md §5.1).
    static final int MAX_ITEMS = 500;

    private static final Sort NEWEST_FIRST = Sort.by(Sort.Direction.DESC, "createdAt");

    private final FaqRepository faqs;
    private final AuditService audit;

    public AdminContentService(FaqRepository faqs, AuditService audit) {
        this.faqs = faqs;
        this.audit = audit;
    }

    /** {@code archived} null lists both; {@code translations} opts the authoring map in. */
    @Transactional(readOnly = true)
    public List<ContentItem> list(String type, Boolean archived, boolean translations) {
        requireFaqs(type);
        PageRequest capped = PageRequest.of(0, MAX_ITEMS, NEWEST_FIRST);
        List<FaqEntity> rows = (archived == null
                ? faqs.findAll(capped) : faqs.findByArchived(archived, capped)).getContent();
        return rows.stream().map(ContentItem::from)
                .map(item -> translations ? item : item.withoutTranslations()).toList();
    }

    @Transactional
    public ContentItem create(AuthPrincipal caller, String type, ContentWrite write) {
        requireFaqs(type);
        if (write.question() == null || write.question().isBlank()) {
            throw new BadRequestException("A faqs item needs 'question'");
        }
        FaqEntity faq = new FaqEntity();
        faq.apply(write);
        FaqEntity saved = faqs.save(faq);
        audit.record(caller, "content.create", ContentTypes.FAQS, saved.getId().toString());
        return ContentItem.from(saved);
    }

    @Transactional
    public ContentItem update(AuthPrincipal caller, String type, String id, ContentWrite write) {
        requireFaqs(type);
        FaqEntity faq = load(id);
        faq.apply(write);
        audit.record(caller, "content.update", ContentTypes.FAQS, faq.getId().toString());
        return ContentItem.from(faq);
    }

    @Transactional
    public ContentItem archive(AuthPrincipal caller, String type, String id) {
        requireFaqs(type);
        FaqEntity faq = load(id);

        // Idempotent on purpose: two ops clicking Archive on the same row is not a conflict, and a
        // 409 here would only teach them to reload and click again.
        if (!faq.isArchived()) {
            faq.archive("Archived by " + caller.role());
            audit.record(caller, "content.archive", ContentTypes.FAQS, faq.getId().toString());
        }
        return ContentItem.from(faq);
    }

    @Transactional
    public ContentItem restore(AuthPrincipal caller, String type, String id) {
        requireFaqs(type);
        FaqEntity faq = load(id);
        if (faq.isArchived()) {
            faq.restore();
            audit.record(caller, "content.restore", ContentTypes.FAQS, faq.getId().toString());
        }
        return ContentItem.from(faq);
    }

    private FaqEntity load(String id) {
        return Ids.parseUuid(id).flatMap(faqs::findById)
                .orElseThrow(() -> NotFoundException.of("Content item"));
    }

    private static void requireFaqs(String type) {
        if (!ContentTypes.FAQS.equals(type)) {
            throw new NotFoundException("Unknown content type: " + type);
        }
    }
}