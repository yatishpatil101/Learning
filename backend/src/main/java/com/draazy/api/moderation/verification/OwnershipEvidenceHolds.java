package com.draazy.api.moderation.verification;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.trust.BadgeEvidenceLookup;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Answers the documents vault's one question about the ownership gate: is this file holding up a
 * badge? Its own class because it serves a delete in another context, not the ops desk's review.
 */
@Service
public class OwnershipEvidenceHolds implements BadgeEvidenceLookup {

    private final OwnershipEvidenceRepository evidence;
    private final PropertyRepository properties;

    public OwnershipEvidenceHolds(OwnershipEvidenceRepository evidence, PropertyRepository properties) {
        this.evidence = evidence;
        this.properties = properties;
    }

    /**
     * Two reads rather than one query because the badge is derived from a clock comparison no column
     * holds. Any citation counts, else a document turns deletable through an edit made elsewhere.
     */
    @Override
    @Transactional(readOnly = true)
    public Hold holdOn(UUID documentId) {
        if (documentId == null) {
            return Hold.NONE;
        }
        return evidence.findFirstByDocumentId(documentId)
                .map(cited -> properties.findById(cited.getPropertyId())
                        .filter(Property::isOwnershipVerified)
                        .isPresent() ? Hold.LIVE_BADGE : Hold.CITED)
                .orElse(Hold.NONE);
    }
}
