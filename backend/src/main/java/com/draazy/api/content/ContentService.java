package com.draazy.api.content;

import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ContentService {

    private final FaqRepository faqs;
    private final ContentMapper mapper;

    public ContentService(FaqRepository faqs, ContentMapper mapper) {
        this.faqs = faqs;
        this.mapper = mapper;
    }

    /** Non-archived FAQs, by category. */
    @Transactional(readOnly = true)
    public List<FaqResponse> listFaqs() {
        return faqs.findByArchivedFalseOrderByCategoryAscCreatedAtAscIdAsc().stream()
                .map(mapper::toResponse)
                .toList();
    }
    }