package com.draazy.api.moderation.verification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.draazy.api.common.audit.AuditService;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("Review checklist — a ticked checklist read back in another row order keeps its ticks")
class VerificationCasesChecklistOrderTest {

    @Test
    void reorderedRowsAreNotMistakenForALegacyChecklist() {
        UUID propertyId = UUID.randomUUID();
        PropertyReview review = new PropertyReview(propertyId);
        List.of(VerificationCases.CHECKLIST.get(2), VerificationCases.CHECKLIST.get(0),
                VerificationCases.CHECKLIST.get(1))
                .forEach(review::addChecklistItem);
        review.getChecklist().forEach(item -> item.mark(true, UUID.randomUUID()));

        PropertyReviewRepository reviews = mock(PropertyReviewRepository.class);
        when(reviews.findByPropertyId(propertyId)).thenReturn(Optional.of(review));

        PropertyReview ensured = new VerificationCases(reviews, mock(AuditService.class)).ensure(propertyId, "rent");

        assertThat(ensured.getChecklist()).hasSize(VerificationCases.CHECKLIST.size())
                .allMatch(ReviewChecklistItem::isPass);
    }
}
