package com.draazy.api.engagement.search;

import java.time.Instant;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class SavedSearchMatchCounter {

    private final SavedSearchMatcher matcher;

    SavedSearchMatchCounter(SavedSearchMatcher matcher) {
        this.matcher = matcher;
    }

    @Transactional(readOnly = true)
    public int count(SavedSearch search, Instant baseline) {
        return matcher.count(search, baseline);
    }
}
