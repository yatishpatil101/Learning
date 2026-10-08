package com.draazy.api.engagement.follow;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyPublished;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/** Not transactional: the alert runs only once the publishing transaction has really committed. */
@SpringBootTest
@DisplayName("Society listing alerts — after the approval commits")
class SocietyListingAlertsAfterCommitTest {

    private static final String PREFIX = "98681000";
    private static final String TYPE = "match.society-listing";

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired JdbcTemplate jdbc;
    @Autowired ApplicationEventPublisher events;
    @Autowired TransactionTemplate tx;

    @BeforeEach
    @AfterEach
    void clean() {
        String mine = "(select id from users where mobile like '" + PREFIX + "%')";
        jdbc.update("delete from notifications where user_id in " + mine);
        jdbc.update("delete from society_follows where user_id in " + mine);
        jdbc.update("delete from notification_preferences where user_id in " + mine);
        jdbc.update("delete from properties where owner_id in " + mine);
        jdbc.update("delete from societies where slug like 'alc-%'");
        jdbc.update("delete from users where mobile like '" + PREFIX + "%'");
    }

    private User user(String suffix) {
        User u = new User(PREFIX + suffix, Roles.Wire.OWNER);
        u.setName("Alc " + suffix);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private UUID society(String slug, String name, String placeId) {
        return jdbc.queryForObject("insert into societies (slug, name, source, place_id) "
                + "values (?, ?, 'community', ?) returning id", UUID.class, slug, name, placeId);
    }

    private void follow(User user, UUID societyId) {
        jdbc.update("insert into society_follows (user_id, society_id) values (?, ?)", user.getId(), societyId);
    }

    private int alerts(User user) {
        return jdbc.queryForObject("select count(*) from notifications where user_id = ? and type = ?",
                Integer.class, user.getId(), TYPE);
    }

    private Property listing(User owner, UUID societyId) {
        Property p = new Property(owner, "Alert flat", "rent", "apartment", 30000L, "Kothrud", "Pune");
        p.setSocietyId(societyId);
        return properties.saveAndFlush(p);
    }

    private void publish(UUID propertyId) {
        tx.executeWithoutResult(status -> events.publishEvent(new PropertyPublished(propertyId)));
    }

    @Test
    @DisplayName("followers of the society, and of what was merged into it, hear once; the owner and anyone opted out do not")
    void followersAreToldOnce() {
        User owner = user("10");
        User follower = user("11");
        User mergedFollower = user("12");
        User bystander = user("13");
        User optedOut = user("14");
        UUID survivor = society("alc-towers", "Alc Towers", "alc-p-1");
        UUID retired = society("alc-twin", "Alc Twin", "alc-p-2");
        jdbc.update("update societies set merged_into = ?, merged_at = now(), merged_by = ? where id = ?",
                survivor, owner.getId(), retired);
        follow(owner, survivor);
        follow(follower, survivor);
        follow(mergedFollower, retired);
        follow(optedOut, survivor);
        jdbc.update("insert into notification_preferences (user_id, match_alerts) values (?, false)",
                optedOut.getId());
        Property listing = listing(owner, survivor);

        publish(listing.getId());
        publish(listing.getId());

        assertThat(List.of(alerts(follower), alerts(mergedFollower), alerts(owner), alerts(bystander),
                alerts(optedOut))).containsExactly(1, 1, 0, 0, 0);
    }

    @Test
    @DisplayName("nothing is sent while the approval is still uncommitted, or after it rolls back")
    void rolledBackApprovalSendsNothing() {
        User owner = user("20");
        User follower = user("21");
        UUID society = society("alc-rollback", "Alc Rollback", "alc-p-3");
        follow(follower, society);
        Property listing = listing(owner, society);

        tx.executeWithoutResult(status -> {
            events.publishEvent(new PropertyPublished(listing.getId()));
            assertThat(alerts(follower)).isZero();
            status.setRollbackOnly();
        });

        assertThat(alerts(follower)).isZero();
    }

    @Test
    @DisplayName("a listing with no society alerts nobody, and a retired society is silent")
    void noSocietyOrRetiredSociety() {
        User owner = user("30");
        User follower = user("31");
        UUID retired = society("alc-retired", "Alc Retired", null);
        jdbc.update("update societies set archived_at = now() where id = ?", retired);
        follow(follower, retired);

        publish(listing(owner, null).getId());
        publish(listing(owner, retired).getId());

        assertThat(alerts(follower)).isZero();
    }

    @Test
    @DisplayName("a failing fan-out is logged and never reaches the publisher")
    void failureDoesNotPropagate() {
        publish(null);
    }
}
