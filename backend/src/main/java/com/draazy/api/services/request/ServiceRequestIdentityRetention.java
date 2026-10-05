package com.draazy.api.services.request;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class ServiceRequestIdentityRetention {

    static final Duration IDLE = Duration.ofDays(60);

    // Counted from the last write: a resubmission replaces the rows, so it restarts this clock.
    static final Duration HELD = Duration.ofDays(180);

    private static final Logger log = LoggerFactory.getLogger(ServiceRequestIdentityRetention.class);

    private final ServiceRequestIdentityRepository identities;
    private final ServiceRequestIdentityService identityService;
    private final ServiceRequestRepository requests;
    private final ServiceRequestEventRepository events;
    private final TransactionTemplate perRequest;

    ServiceRequestIdentityRetention(ServiceRequestIdentityRepository identities,
            ServiceRequestIdentityService identityService, ServiceRequestRepository requests,
            ServiceRequestEventRepository events, PlatformTransactionManager transactions) {
        this.identities = identities;
        this.identityService = identityService;
        this.requests = requests;
        this.events = events;
        this.perRequest = new TransactionTemplate(transactions);
    }

    public int purgeNow() {
        return purgeAsOf(Instant.now());
    }

    public int purgeAsOf(Instant now) {
        Instant idleSince = now.minus(IDLE);
        Instant heldSince = now.minus(HELD);
        int purged = 0;
        for (UUID requestId : identities.findOpenRequestIdsHoldingNumbersPast(idleSince, heldSince)) {
            try {
                if (Boolean.TRUE.equals(perRequest.execute(tx -> purgeOne(requestId, idleSince, heldSince)))) {
                    purged++;
                }
            } catch (RuntimeException e) {
                log.warn("Retention could not blank identity numbers on service request {}", requestId, e);
            }
        }
        if (purged > 0) {
            log.info("Retention blanked identity numbers on {} open service request(s)", purged);
        }
        return purged;
    }

    private boolean purgeOne(UUID requestId, Instant idleSince, Instant heldSince) {
        requests.findByIdForUpdate(requestId);
        if (!identities.isPastRetention(requestId, idleSince, heldSince)
                || identityService.purgeFor(requestId) == 0) {
            return false;
        }
        events.save(new ServiceRequestEvent(requestId, ServiceRequestIdentityService.PURGED, null));
        return true;
    }
}
