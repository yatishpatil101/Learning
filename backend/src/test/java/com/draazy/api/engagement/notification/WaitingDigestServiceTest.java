package com.draazy.api.engagement.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.DecisionMessenger;
import com.draazy.api.support.AbstractApiTest;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@DisplayName("Daily WhatsApp digest of requests waiting on the user")
class WaitingDigestServiceTest extends AbstractApiTest {

    private static final Instant NOW = Instant.parse("2026-10-10T04:30:00Z");

    @MockitoBean
    DecisionMessenger messenger;

    @Autowired
    WaitingDigestService digest;

    @Autowired
    UserRepository users;

    @Autowired
    PropertyRepository properties;

    @Autowired
    NotificationPreferenceRepository preferences;

    @BeforeEach
    void vendorAccepts() {
        when(messenger.sendWaitingDigest(anyString(), anyString())).thenReturn(true);
    }

    private User user(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("User " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private UUID listing(User owner, String status) {
        Property p = new Property(owner, "Digest flat", "rent", "apartment", 25000L, "Baner", "Pune");
        p.setStatus(status);
        return properties.saveAndFlush(p).getId();
    }

    private void contactRequest(UUID property, User requester, String status, Instant at) {
        jdbc.update("insert into contact_requests (property_id, requester_id, status, created_at) values (?, ?, ?, ?)",
                property, requester.getId(), status, Timestamp.from(at));
    }

    private void lastActive(User u, Instant at) {
        jdbc.update("update users set last_active = ? where id = ?", Timestamp.from(at), u.getId());
    }

    private Instant hoursAgo(long hours) {
        return NOW.minus(Duration.ofHours(hours));
    }

    @Test
    @DisplayName("a pending request that arrived while the owner was away is announced once")
    void pendingRequestIsAnnounced() {
        User owner = user("9810100001");
        User buyer = user("9810100002");
        contactRequest(listing(owner, "approved"), buyer, "pending", hoursAgo(3));

        assertThat(digest.sendDue(NOW)).isEqualTo(1);

        verify(messenger).sendWaitingDigest("9810100001", "1 request");
        assertThat(digest.sendDue(NOW.plusSeconds(60))).isZero();
        verify(messenger, times(1)).sendWaitingDigest(anyString(), anyString());
    }

    @Test
    @DisplayName("contact, offer, document and visit requests add up to one message")
    void kindsAreCountedTogether() {
        User owner = user("9810100011");
        User buyer = user("9810100012");
        UUID property = listing(owner, "approved");
        contactRequest(property, buyer, "pending", hoursAgo(5));
        jdbc.update("insert into offers (property_id, from_user_id, amount, created_at) values (?, ?, 900000, ?)",
                property, buyer.getId(), Timestamp.from(hoursAgo(4)));
        jdbc.update("insert into document_requests (property_id, requester_id, created_at) values (?, ?, ?)",
                property, buyer.getId(), Timestamp.from(hoursAgo(3)));
        jdbc.update("insert into visits (property_id, visitor_id, slot, created_at) values (?, ?, ?, ?)",
                property, buyer.getId(), Timestamp.from(NOW.plus(Duration.ofDays(1))), Timestamp.from(hoursAgo(2)));

        digest.sendDue(NOW);

        verify(messenger).sendWaitingDigest("9810100011", "4 requests");
    }

    @Test
    @DisplayName("an owner who opened the app after the request arrived hears nothing")
    void openedAppSinceIsSkipped() {
        User owner = user("9810100021");
        User buyer = user("9810100022");
        contactRequest(listing(owner, "approved"), buyer, "pending", hoursAgo(3));
        lastActive(owner, hoursAgo(1));

        assertThat(digest.sendDue(NOW)).isZero();
        verify(messenger, never()).sendWaitingDigest(anyString(), anyString());
    }

    @Test
    @DisplayName("only requests that arrived after the app was last open are counted")
    void onlyRequestsSinceLastOpenCount() {
        User owner = user("9810100031");
        User buyer = user("9810100032");
        User other = user("9810100033");
        UUID property = listing(owner, "approved");
        contactRequest(property, buyer, "pending", hoursAgo(10));
        contactRequest(property, other, "pending", hoursAgo(2));
        lastActive(owner, hoursAgo(6));

        digest.sendDue(NOW);

        verify(messenger).sendWaitingDigest("9810100031", "1 request");
    }

    @Test
    @DisplayName("answered requests, other people's listings and listings that are not live are ignored")
    void onlyUnansweredRequestsOnLiveListings() {
        User owner = user("9810100041");
        User buyer = user("9810100042");
        contactRequest(listing(owner, "approved"), buyer, "approved", hoursAgo(3));
        contactRequest(listing(owner, "paused"), buyer, "pending", hoursAgo(3));
        contactRequest(listing(owner, "archived"), buyer, "pending", hoursAgo(3));

        assertThat(digest.sendDue(NOW)).isZero();
        verify(messenger, never()).sendWaitingDigest(anyString(), anyString());
    }

    @Test
    @DisplayName("a visit whose slot has passed is no longer waiting")
    void pastVisitIsIgnored() {
        User owner = user("9810100051");
        User buyer = user("9810100052");
        jdbc.update("insert into visits (property_id, visitor_id, slot, created_at) values (?, ?, ?, ?)",
                listing(owner, "approved"), buyer.getId(), Timestamp.from(hoursAgo(1)), Timestamp.from(hoursAgo(3)));

        assertThat(digest.sendDue(NOW)).isZero();
    }

    @Test
    @DisplayName("the WhatsApp preference toggle switches the digest off")
    void whatsappToggleIsRespected() {
        User owner = user("9810100061");
        User buyer = user("9810100062");
        contactRequest(listing(owner, "approved"), buyer, "pending", hoursAgo(3));
        NotificationPreference row = new NotificationPreference(owner.getId());
        row.replace(true, false, false, true, false, "22:00", "07:00", "en");
        preferences.saveAndFlush(row);

        assertThat(digest.sendDue(NOW)).isZero();
        verify(messenger, never()).sendWaitingDigest(anyString(), anyString());
    }

    @Test
    @DisplayName("a request already covered by an earlier digest is not announced again")
    void earlierDigestCoversOlderRequests() {
        User owner = user("9810100071");
        User buyer = user("9810100072");
        User other = user("9810100073");
        UUID property = listing(owner, "approved");
        contactRequest(property, buyer, "pending", hoursAgo(30));
        jdbc.update("update users set waiting_digest_at = ? where id = ?", Timestamp.from(hoursAgo(25)), owner.getId());
        assertThat(digest.sendDue(NOW)).isZero();

        contactRequest(property, other, "pending", hoursAgo(2));
        digest.sendDue(NOW);

        verify(messenger).sendWaitingDigest(eq("9810100071"), eq("1 request"));
    }

    @Test
    @DisplayName("at most one digest per day even when new requests keep arriving")
    void oncePerDay() {
        User owner = user("9810100081");
        User buyer = user("9810100082");
        User other = user("9810100083");
        UUID property = listing(owner, "approved");
        contactRequest(property, buyer, "pending", hoursAgo(3));
        digest.sendDue(NOW);

        contactRequest(property, other, "pending", Instant.parse("2026-10-10T05:00:00Z"));

        assertThat(digest.sendDue(NOW.plus(Duration.ofHours(2)))).isZero();
        assertThat(digest.sendDue(NOW.plus(Duration.ofHours(24)))).isEqualTo(1);
    }

    @Test
    @DisplayName("a suspended account is not messaged")
    void suspendedAccountIsSkipped() {
        User owner = user("9810100091");
        User buyer = user("9810100092");
        contactRequest(listing(owner, "approved"), buyer, "pending", hoursAgo(3));
        jdbc.update("update users set status = 'suspended' where id = ?", owner.getId());

        assertThat(digest.sendDue(NOW)).isZero();
    }

    @Test
    @DisplayName("a taken-down listing and an archived owner are not announced")
    void archivedListingAndOwnerAreIgnored() {
        User owner = user("9810100101");
        User archivedOwner = user("9810100103");
        User buyer = user("9810100102");
        UUID takenDown = listing(owner, "approved");
        jdbc.update("update properties set archived = true where id = ?", takenDown);
        contactRequest(takenDown, buyer, "pending", hoursAgo(3));
        contactRequest(listing(archivedOwner, "approved"), buyer, "pending", hoursAgo(3));
        jdbc.update("update users set archived = true where id = ?", archivedOwner.getId());

        assertThat(digest.sendDue(NOW)).isZero();
    }

    @Test
    @DisplayName("a digest the vendor did not accept is retried, not counted as covering the request")
    void failedSendIsRetried() {
        User owner = user("9810100111");
        User buyer = user("9810100112");
        contactRequest(listing(owner, "approved"), buyer, "pending", hoursAgo(3));
        when(messenger.sendWaitingDigest(anyString(), anyString())).thenReturn(false);

        assertThat(digest.sendDue(NOW)).isZero();

        when(messenger.sendWaitingDigest(anyString(), anyString())).thenReturn(true);
        assertThat(digest.sendDue(NOW.plusSeconds(60))).isEqualTo(1);
        verify(messenger, times(2)).sendWaitingDigest("9810100111", "1 request");
    }
}
