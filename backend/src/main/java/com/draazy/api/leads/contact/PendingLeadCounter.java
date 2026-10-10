package com.draazy.api.leads.contact;

import com.draazy.api.common.trust.PendingLeadLookup;
import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
class PendingLeadCounter implements PendingLeadLookup {

    private final ContactRequestRepository requests;

    PendingLeadCounter(ContactRequestRepository requests) {
        this.requests = requests;
    }

    @Override
    public Map<UUID, Integer> pendingFor(Collection<UUID> propertyIds) {
        Map<UUID, Integer> counts = new HashMap<>();
        if (propertyIds.isEmpty()) {
            return counts;
        }
        Instant liveSince = Instant.now().minus(ContactRequestStatuses.PENDING_TTL);
        for (Object[] row : requests.countPendingByProperty(propertyIds, ContactRequestStatuses.PENDING, liveSince)) {
            counts.put((UUID) row[0], ((Number) row[1]).intValue());
        }
        return counts;
    }
}
