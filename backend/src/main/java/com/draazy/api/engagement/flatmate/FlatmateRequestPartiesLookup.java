package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.trust.FlatmateRequestParties;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
@Transactional(readOnly = true)
class FlatmateRequestPartiesLookup implements FlatmateRequestParties {

    private final FlatmateRequestRepository requests;

    FlatmateRequestPartiesLookup(FlatmateRequestRepository requests) {
        this.requests = requests;
    }

    @Override
    public Optional<UUID> acceptedCounterparty(UUID requestId, UUID userId) {
        return requests.findById(requestId)
                .filter(r -> FlatmateVocabulary.STATUS_ACCEPTED.equals(r.getStatus()))
                .filter(r -> userId.equals(r.getRequesterId()) || userId.equals(r.getHostId()))
                .map(r -> userId.equals(r.getHostId()) ? r.getRequesterId() : r.getHostId());
    }
}
