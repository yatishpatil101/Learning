package com.draazy.api.engagement.society;

import com.draazy.api.catalog.society.SocietyRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SocietyQueueSummaryService {

    public record Summary(long candidates) {
    }

    private final SocietyRepository societies;

    public SocietyQueueSummaryService(SocietyRepository societies) {
        this.societies = societies;
    }

    @Transactional(readOnly = true)
    public Summary summary() {
        return new Summary(societies.countCandidates());
    }
}
