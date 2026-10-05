package com.draazy.api.common.trust;

import java.util.Optional;
import java.util.UUID;

public interface FlatmateRequestParties {

    Optional<UUID> acceptedCounterparty(UUID requestId, UUID userId);
}
