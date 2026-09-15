package com.draazy.api.catalog.property;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.identity.user.User;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class PropertyLifecycleTest {
    private final AccountPermissions permissions = mock(AccountPermissions.class);
    private final PropertyLifecycle lifecycle = new PropertyLifecycle(permissions);
    private final AuthPrincipal staff = new AuthPrincipal(UUID.randomUUID(), "staff", null, true, false);
    private Property property;

    @BeforeEach void setup() {
        User owner = mock(User.class);
        when(owner.getId()).thenReturn(UUID.randomUUID());
        when(permissions.granted(eq(staff), anyString())).thenReturn(true);
        property = new Property(owner, "Home", "rent", "Flat", 20000L, "Baner", "Pune");
        property.setLocalitySlug("baner");
    }

    @ParameterizedTest
    @ValueSource(strings = {"flagged", "rejected", "sold", "rented", "archived"})
    void verificationAndManualStagesCannotReviveInactiveStatuses(String status) {
        property.setStatus(status);
        assertThatThrownBy(() -> lifecycle.verify(staff, property)).isInstanceOf(ConflictException.class);
        assertThatThrownBy(() -> lifecycle.correct(staff, property, "live")).isInstanceOf(ConflictException.class);
        assertThatThrownBy(() -> lifecycle.correct(staff, property, "in_review")).isInstanceOf(ConflictException.class);
        assertThat(property.getStatus()).isEqualTo(status);
        assertThat(property.getLifecycleStage()).isNull();
    }

    @Test void archiveAndRestoreRequireFreshVerification() {
        lifecycle.verify(staff, property);
        lifecycle.publish(staff, property, true);
        property.archive("Removed");
        assertThat(property.getLifecycleStage()).isNull();
        assertThatThrownBy(() -> lifecycle.publish(staff, property, false)).isInstanceOf(ConflictException.class);
        property.restore();
        property.revertToPending();
        assertThat(property.getLifecycleStage()).isEqualTo("submitted");
        assertThatThrownBy(() -> lifecycle.publish(staff, property, true)).isInstanceOf(ConflictException.class);
    }

    @Test void staffTrackCanBeVerifiedWithoutInventingAnOwnerStage() {
        property.markPostedOnBehalf(UUID.randomUUID().toString());
        assertThat(property.getLifecycleStage()).isNull();
        property.recordLifecycleMedia();
        lifecycle.verify(staff, property);
        assertThat(property.getLifecycleStage()).isEqualTo("photos_docs");
        assertThat(property.getStatus()).isEqualTo("pending");
        assertThatThrownBy(() -> lifecycle.correct(staff, property, "verified")).isInstanceOf(BadRequestException.class);
        lifecycle.publish(staff, property, true);
        property.recordLifecycleMedia();
        assertThat(property.getLifecycleStage()).isEqualTo("live");
    }

    @Test void resettingStatusInvalidatesThePublicationPrerequisite() {
        lifecycle.verify(staff, property);
        property.revertToPending();
        assertThat(property.getLifecycleVerifiedAt()).isNull();
        assertThatThrownBy(() -> lifecycle.publish(staff, property, true)).isInstanceOf(ConflictException.class);
    }

    @Test void revokedWriteGrantCannotVerifyPublishOrCorrect() {
        when(permissions.granted(staff, "properties:write")).thenReturn(false);
        assertThatThrownBy(() -> lifecycle.verify(staff, property)).isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> lifecycle.publish(staff, property, false)).isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> lifecycle.correct(staff, property, "in_review")).isInstanceOf(ForbiddenException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"link_sent", "opened", "photos_docs"})
    void manualStaffStagesAreStoredWithoutPublishing(String stage) {
        property.markPostedOnBehalf(UUID.randomUUID().toString());
        lifecycle.correct(staff, property, stage);
        assertThat(property.getLifecycleStage()).isEqualTo(stage);
        assertThat(property.getStatus()).isEqualTo("pending");
    }
}