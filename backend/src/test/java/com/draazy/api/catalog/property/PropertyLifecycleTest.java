package com.draazy.api.catalog.property;

import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.identity.user.User;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class PropertyLifecycleTest {
    private final AccountPermissions permissions = mock(AccountPermissions.class);
    private final PropertyLifecycle lifecycle =
            new PropertyLifecycle(permissions, mock(ApplicationEventPublisher.class),
                    (actor, property, secondApprovalSatisfied) -> {
                    });
    private final AuthPrincipal staff = new AuthPrincipal(UUID.randomUUID(), "staff", null, true, false);
    private Property property;

    @BeforeEach void setup() {
        User owner = mock(User.class);
        when(owner.getId()).thenReturn(UUID.randomUUID());
        when(permissions.granted(eq(staff), anyString())).thenReturn(true);
        property = new Property(owner, "Home", "rent", "Flat", 20000L, "Baner", "Pune");
        property.setLocalitySlug("baner");
    }

    @Test void staffListingCannotPublishUntilTheOwnerConfirms() {
        property.markPostedOnBehalf(UUID.randomUUID().toString());
        assertThatThrownBy(() -> lifecycle.publish(staff, property))
                .isInstanceOfSatisfying(ConflictException.class,
                        e -> assertThat(e.getCode()).isEqualTo("owner_not_confirmed"));
        assertThat(property.getStatus()).isEqualTo(PropertyStatus.PENDING);
        property.confirmByOwner();
        lifecycle.publish(staff, property);
        assertThat(property.getStatus()).isEqualTo(PropertyStatus.APPROVED);
    }

    @Test void ownerListingPublishesWithoutConfirmation() {
        lifecycle.publish(staff, property);
        assertThat(property.getStatus()).isEqualTo(PropertyStatus.APPROVED);
        assertThat(property.getOwnerConfirmedAt()).isNull();
    }

    @Test void archivedListingCannotPublish() {
        property.archive("Removed");
        assertThatThrownBy(() -> lifecycle.publish(staff, property)).isInstanceOf(ConflictException.class);
    }

    @Test void startStampsReviewOnceAndReentryClearsIt() {
        lifecycle.start(staff, property);
        var started = property.getReviewStartedAt();
        assertThat(started).isNotNull();
        lifecycle.start(staff, property);
        assertThat(property.getReviewStartedAt()).isEqualTo(started);
        lifecycle.reenterPending(staff, property);
        assertThat(property.getReviewStartedAt()).isNull();
    }

    @Test void clarificationThenOwnerReplyKeepsTheListingInReview() {
        AuthPrincipal owner = new AuthPrincipal(property.getOwner().getId(), "owner", null, true, false);
        lifecycle.message(staff, property, true);
        assertThat(property.isAwaitingOwnerInfo()).isTrue();
        assertThat(property.getReviewStartedAt()).isNotNull();
        lifecycle.message(owner, property, false);
        assertThat(property.isAwaitingOwnerInfo()).isFalse();
        assertThat(property.getReviewStartedAt()).isNotNull();
        assertThat(property.getStatus()).isEqualTo(PropertyStatus.PENDING);
    }

    @Test void clarificationIsRefusedOnALiveListing() {
        lifecycle.publish(staff, property);
        assertThatThrownBy(() -> lifecycle.message(staff, property, true)).isInstanceOf(ConflictException.class);
        assertThat(property.isAwaitingOwnerInfo()).isFalse();
    }

    @Test void ownerMessageDoesNotReopenRejectedListing() {
        AuthPrincipal owner = new AuthPrincipal(property.getOwner().getId(), "owner", null, true, false);
        property.setStatus(PropertyStatus.REJECTED);
        lifecycle.message(owner, property, false);
        assertThat(property.getStatus()).isEqualTo(PropertyStatus.REJECTED);
    }

    @Test void revokedWriteGrantCannotPublishOrStart() {
        when(permissions.granted(staff, "properties:moderate")).thenReturn(false);
        when(permissions.granted(staff, "properties:verify")).thenReturn(false);
        assertThatThrownBy(() -> lifecycle.publish(staff, property)).isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> lifecycle.start(staff, property)).isInstanceOf(ForbiddenException.class);
    }
}
