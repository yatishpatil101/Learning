package com.draazy.api.catalog.listing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.draazy.api.catalog.locality.LocalityResolver;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.society.SocietyRepository;
import com.draazy.api.identity.user.User;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.Test;

class ListingOwnershipRecheckTest {
    private final ListingEditRules rules = new ListingEditRules(
            mock(LocalityResolver.class), mock(SocietyRepository.class));

    private Property verifiedRental() {
        Property property = new Property(new User("9812345678", "owner"),
                "Ownership recheck", "rent", "Flat", 31000L, "Baner", "Pune");
        Instant now = Instant.now();
        property.verifyOwnership(now, now.plus(30, ChronoUnit.DAYS));
        return property;
    }

    @Test
    void changingTheDealWithdrawsTheOldEvidenceVerdict() {
        Property property = verifiedRental();
        ListingUpdate update = mock(ListingUpdate.class);
        when(update.deal()).thenReturn("buy");

        rules.apply(property, update);

        assertThat(property.getDeal()).isEqualTo("buy");
        assertThat(property.isOwnershipVerified()).isFalse();
        assertThat(property.getOwnershipVerifiedAt()).isNull();
        assertThat(property.getOwnershipVerifiedUntil()).isNull();
    }

    @Test
    void resendingTheSameDealOrEditingTheDescriptionKeepsTheVerdict() {
        Property property = verifiedRental();
        Instant granted = property.getOwnershipVerifiedAt();
        ListingUpdate update = mock(ListingUpdate.class);
        when(update.deal()).thenReturn("rent");
        when(update.description()).thenReturn("Updated description");

        rules.apply(property, update);

        assertThat(property.isOwnershipVerified()).isTrue();
        assertThat(property.getOwnershipVerifiedAt()).isEqualTo(granted);
        assertThat(property.getDescription()).isEqualTo("Updated description");
    }
}