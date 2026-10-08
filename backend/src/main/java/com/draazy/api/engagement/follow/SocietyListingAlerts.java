package com.draazy.api.engagement.follow;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyPublished;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.society.Society;
import com.draazy.api.catalog.society.SocietyRepository;
import com.draazy.api.common.trust.Notifier;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

/** Runs after the approval commits, in its own transaction, so a slow or failing fan-out can neither hold the approval open nor undo it. */
@Component
class SocietyListingAlerts {

    static final String TYPE = "match.society-listing";

    private static final Logger log = LoggerFactory.getLogger(SocietyListingAlerts.class);

    private final PropertyRepository properties;
    private final SocietyRepository societies;
    private final SocietyFollowRepository follows;
    private final Notifier notifier;
    private final TransactionTemplate fresh;

    SocietyListingAlerts(PropertyRepository properties, SocietyRepository societies,
            SocietyFollowRepository follows, Notifier notifier, PlatformTransactionManager txManager) {
        this.properties = properties;
        this.societies = societies;
        this.follows = follows;
        this.notifier = notifier;
        this.fresh = new TransactionTemplate(txManager);
        this.fresh.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    void onPublished(PropertyPublished event) {
        try {
            fresh.executeWithoutResult(status -> fanOut(event.propertyId()));
        } catch (RuntimeException e) {
            log.warn("Society listing alert failed for property {}", event.propertyId(), e);
        }
    }

    private void fanOut(UUID propertyId) {
        Property listing = properties.findById(propertyId).orElse(null);
        if (listing == null || listing.getSocietyId() == null) {
            return;
        }
        Society society = societies.findById(listing.getSocietyId()).orElse(null);
        if (society == null || society.getArchivedAt() != null) {
            return;
        }
        String link = "/property/" + listing.getId();
        for (UUID follower : follows.findUnalertedFollowerIds(societies.familyIds(society.getId()),
                listing.getOwner().getId(), TYPE, link)) {
            notifier.notify(follower, TYPE, "New listing in " + society.getName(), listing.getTitle(), link);
        }
    }
}
