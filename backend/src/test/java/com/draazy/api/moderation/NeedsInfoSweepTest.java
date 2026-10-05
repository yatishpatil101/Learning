package com.draazy.api.moderation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.moderation.verification.NeedsInfoSweepService;
import com.draazy.api.security.Roles;
import com.draazy.api.security.Teams;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

@DisplayName("Needs-info sweep — reminders and timeout archive")
class NeedsInfoSweepTest extends AbstractApiTest {

    private static final Instant BASE = Instant.parse("2026-09-01T00:00:00Z");

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    NeedsInfoSweepService sweep;
    @Autowired
    AdjustableClock clock;

    private final List<String> autoArchivedListings = new ArrayList<>();

    @BeforeEach
    void pinClock() {
        clock.set(BASE);
    }

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        autoArchivedListings.forEach(id -> jdbc.update(
                "delete from audit_log where action = 'property.needs_info.timeout_archive' and entity_id = ?",
                id));
        autoArchivedListings.clear();
    }

    @Test
    @DisplayName("day 3 and day 7 reminders are idempotent, and day 14 archives without deleting")
    void remindersAndArchiveFollowTheSilentNeedsInfoSchedule() throws Exception {
        NeedsInfoCase row = needsInfoListing("9820000701", "9820000702", BASE);

        clock.set(BASE.plus(1, ChronoUnit.DAYS));
        assertThat(sweep.sweep()).isEqualTo(new NeedsInfoSweepService.SweepResult(0, 0));
        assertThat(notifications(row.owner(), "listing.needs_info_reminder")).isZero();

        clock.set(BASE.plus(2, ChronoUnit.DAYS));
        assertThat(sweep.sweep()).isEqualTo(new NeedsInfoSweepService.SweepResult(0, 0));
        assertThat(notifications(row.owner(), "listing.needs_info_reminder")).isZero();

        clock.set(BASE.plus(3, ChronoUnit.DAYS));
        assertThat(sweep.sweep()).isEqualTo(new NeedsInfoSweepService.SweepResult(1, 0));
        assertThat(notifications(row.owner(), "listing.needs_info_reminder")).isEqualTo(1);

        assertThat(sweep.sweep()).isEqualTo(new NeedsInfoSweepService.SweepResult(0, 0));
        assertThat(notifications(row.owner(), "listing.needs_info_reminder")).isEqualTo(1);

        clock.set(BASE.plus(7, ChronoUnit.DAYS));
        assertThat(sweep.sweep()).isEqualTo(new NeedsInfoSweepService.SweepResult(1, 0));
        assertThat(notifications(row.owner(), "listing.needs_info_reminder")).isEqualTo(2);

        clock.set(BASE.plus(13, ChronoUnit.DAYS));
        assertThat(sweep.sweep()).isEqualTo(new NeedsInfoSweepService.SweepResult(0, 0));
        assertThat(archived(row.listing())).isFalse();

        clock.set(BASE.plus(14, ChronoUnit.DAYS));
        assertThat(sweep.sweep()).isEqualTo(new NeedsInfoSweepService.SweepResult(0, 1));
        autoArchivedListings.add(row.listing().getId().toString());
        assertThat(archived(row.listing())).isTrue();
        assertThat(notifications(row.owner(), "listing.needs_info_timeout")).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from properties where id = ?",
                Integer.class, row.listing().getId())).isEqualTo(1);
    }

    @Test
    @DisplayName("an owner reply clears needs_info, so the sweep skips the old deadline")
    void ownerReplyClearsNeedsInfoBeforeTheSweepSeesIt() throws Exception {
        NeedsInfoCase row = needsInfoListing("9820000703", "9820000704", BASE);

        mvc.perform(post(path(row.listing(), "/messages")).header(HttpHeaders.AUTHORIZATION, bearer(row.owner()))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"I uploaded the new photos.\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("in_review"));

        clock.set(BASE.plus(14, ChronoUnit.DAYS));
        assertThat(sweep.sweep()).isEqualTo(new NeedsInfoSweepService.SweepResult(0, 0));
        assertThat(archived(row.listing())).isFalse();
        assertThat(notifications(row.owner(), "listing.needs_info_timeout")).isZero();
    }

    private NeedsInfoCase needsInfoListing(String ownerMobile, String staffMobile, Instant needsInfoAt)
            throws Exception {
        User owner = user(ownerMobile, Roles.Wire.OWNER);
        User staff = user(staffMobile, Roles.Wire.STAFF);
        Property listing = listing(owner);

        mvc.perform(post(path(listing, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        mvc.perform(post(path(listing, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(staff))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"needs_info\",\"reasonCode\":\"photos_not_real\","
                        + "\"note\":\"Use current photos.\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("needs_info"));
        jdbc.update("update property_reviews set decided_at = ? where property_id = ?",
                Timestamp.from(needsInfoAt), listing.getId());
        jdbc.update("update properties set info_requested_at = ? where id = ?",
                Timestamp.from(needsInfoAt), listing.getId());
        return new NeedsInfoCase(owner, listing);
    }

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("User " + mobile);
        u.setMobileVerified(true);
        if (Roles.Wire.STAFF.equals(role)) {
            u.setTeam(Teams.RENTAL);
        }
        User saved = users.saveAndFlush(u);
        if (Roles.Wire.STAFF.equals(role)) {
            jdbc.update("""
                    INSERT INTO back_office_permissions (user_id, permissions)
                    VALUES (?::uuid, ?::jsonb)
                    ON CONFLICT (user_id) DO UPDATE SET permissions = EXCLUDED.permissions
                    """, saved.getId().toString(), "[\"propertyVerification\",\"desk:rental\"]");
        }
        return saved;
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "2BHK in Wakad", "rent", "apartment", 32000L, "Wakad", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("900"));
        p.setStatus(PropertyStatus.PENDING);
        return properties.saveAndFlush(p);
    }

    private String path(Property p, String suffix) {
        return "/properties/" + p.getId() + "/verification" + suffix;
    }

    private int notifications(User owner, String type) {
        return jdbc.queryForObject("select count(*) from notifications where user_id = ? and type = ?",
                Integer.class, owner.getId(), type);
    }

    private boolean archived(Property listing) {
        return jdbc.queryForObject("select archived from properties where id = ?",
                Boolean.class, listing.getId());
    }

    private record NeedsInfoCase(User owner, Property listing) {
    }

    @TestConfiguration
    static class ClockConfig {
        @Bean
        @Primary
        AdjustableClock adjustableClock() {
            return new AdjustableClock(BASE);
        }
    }

    static final class AdjustableClock extends Clock {
        private Instant instant;

        private AdjustableClock(Instant instant) {
            this.instant = instant;
        }

        void set(Instant instant) {
            this.instant = instant;
        }

        @Override
        public ZoneId getZone() {
            return ZoneId.of("UTC");
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}
