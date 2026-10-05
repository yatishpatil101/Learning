package com.draazy.api.services.request;

import com.draazy.api.documents.vault.Document;
import com.draazy.api.documents.vault.DocumentRepository;
import java.time.Instant;
import java.util.UUID;

public final class DocumentReviewFixture {

    private DocumentReviewFixture() {
    }

    public static void verifyAll(ServiceRequestRepository requests, DocumentRepository documents,
            ServiceRequestDocumentReviewRepository reviews, UUID id) {
        ServiceRequest request = requests.findById(id).orElseThrow();
        if (!ServiceRequestTypes.RENT_AGREEMENT.equals(request.getType())) {
            return;
        }
        for (String category : ServiceRequestChecklist.itemsFor(request).keySet()) {
            Document filed = documents.saveAndFlush(new Document(request.getPropertyId(), id, category,
                    category + ".png", "documents/service-requests/" + id + "/" + UUID.randomUUID(), 1L,
                    "image/png"));
            ServiceRequestDocumentReview review = new ServiceRequestDocumentReview(id, filed.getId());
            review.decide(ServiceRequestDocumentReview.VERIFIED, null, null, Instant.now());
            reviews.saveAndFlush(review);
        }
    }
}
