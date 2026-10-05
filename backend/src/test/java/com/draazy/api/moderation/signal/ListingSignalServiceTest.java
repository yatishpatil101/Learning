package com.draazy.api.moderation.signal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyPhotoHash;
import com.draazy.api.catalog.property.PropertyPhotoHashRepository;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

@DisplayName("Moderation — listing broker and duplicate signals")
class ListingSignalServiceTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    PropertyPhotoHashRepository photoHashes;
    @Autowired
    ListingSignalService signals;

    private User user(String mobile, String role, String name) {
        User user = new User(mobile, role);
        user.setName(name);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    private Property listing(User owner, String title, String locality, String description) {
        Property property = new Property(owner, title, "rent", "apartment", 30000L, locality, "Pune");
        property.setBhk(new BigDecimal("2"));
        property.setCarpetArea(new BigDecimal("800"));
        property.setLocalitySlug(locality.toLowerCase());
        property.setDescription(description);
        property.setStatus(PropertyStatus.PENDING);
        return properties.saveAndFlush(property);
    }

    @Test
    @DisplayName("broker wording, copied description and many-locality signals combine into possible broker")
    void softSignals() {
        User owner = user("9822220101", "owner", "Prime Realty Associates");
        User other = user("9822220102", "owner", "Other Owner");
        String description = "Spacious home with two balconies near the park and metro, ideal for a family stay.";
        Property target = listing(owner, "Multiple options with zero commission", "Baner", description);
        listing(other, "Family flat", "Aundh", description);
        listing(owner, "One", "Kothrud", "short");
        listing(owner, "Two", "Wakad", "short");
        jdbc.update("update properties set created_at = ? where owner_id = ?",
                Timestamp.from(Instant.now()), owner.getId());

        ListingSignals got = signals.forProperties(List.of(target)).get(target.getId());

        assertThat(got.possibleBroker()).isTrue();
        assertThat(got.hardBlock()).isFalse();
        assertThat(got.items()).extracting(ListingSignals.Item::code)
                .contains("broker_wording", "copied_description", "many_localities_30d");
    }

    @Test
    @DisplayName("photo matches and brokerage reports are hard signals")
    void hardSignals() {
        User owner = user("9822220103", "owner", "Owner");
        User other = user("9822220104", "owner", "Other");
        User reporter = user("9822220105", "buyer", "Reporter");
        Property target = listing(owner, "Plain flat", "Baner", "Plain family listing.");
        Property match = listing(other, "Other flat", "Aundh", "Different listing.");
        photoHashes.saveAndFlush(new PropertyPhotoHash(target.getId(), 0x1111111111111111L));
        photoHashes.saveAndFlush(new PropertyPhotoHash(match.getId(), 0x1111111111111111L));
        jdbc.update("""
                insert into reports (target_type, target_id, reporter_id, reason, details, status)
                values ('user', ?, ?, 'brokerage', 'broker', 'open'),
                       ('user', ?, ?, 'brokerage', 'broker', 'actioned')
                """, owner.getId().toString(), reporter.getId(), owner.getId().toString(), reporter.getId());

        ListingSignals got = signals.forProperties(List.of(target)).get(target.getId());

        assertThat(got.possibleBroker()).isTrue();
        assertThat(got.hardBlock()).isTrue();
        assertThat(signals.hasHardSignal(target.getId())).isTrue();
        assertThat(got.items()).extracting(ListingSignals.Item::code)
                .contains("photo_match_other_account", "brokerage_reports");
    }

    @Test
    @DisplayName("duplicate conflicts require override even though the wire hardBlock stays unchanged")
    void duplicateConflictCountsForApprovalGate() {
        User owner = user("9822220111", "owner", "Owner");
        User other = user("9822220112", "owner", "Other");
        Property target = listing(owner, "Plain flat", "Baner", "Plain family listing.");
        Property duplicate = listing(other, "Other flat", "Aundh", "Different listing.");
        target.setElectricityMeterKey("duplicate-meter");
        duplicate.setElectricityMeterKey("duplicate-meter");
        properties.saveAndFlush(target);
        properties.saveAndFlush(duplicate);

        ListingSignals got = signals.forProperties(List.of(target)).get(target.getId());

        assertThat(got.conflict()).isTrue();
        assertThat(got.hardBlock()).isFalse();
        assertThat(signals.hasHardSignal(target.getId())).isTrue();
        assertThat(got.items()).extracting(ListingSignals.Item::code)
                .contains("duplicate_conflict");
    }

    @Test
    @DisplayName("admin list has signals, public and owner reads do not")
    void staffOnlyVisibility() throws Exception {
        User owner = user("9822220106", "owner", "Owner");
        User staff = user("9822220107", "staff", "Ops");
        Property target = listing(owner, "Agent flat", "Baner", "Multiple options and one month rent.");

        mvc.perform(get("/admin/properties").header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].signals.possibleBroker").exists());

        mvc.perform(get("/properties/{id}", target.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.signals").doesNotExist());

        mvc.perform(get("/me/listings").header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].signals").doesNotExist());
    }

    @Test
    @DisplayName("batching returns entries for every listing and leaves clean rows clean")
    void batchSignals() {
        User owner = user("9822220108", "owner", "Owner");
        Property hit = listing(owner, "Consultant flat", "Baner", "Multiple options near schools.");
        Property clean = listing(owner, "Family flat", "Aundh", "A normal owner listing.");

        Map<UUID, ListingSignals> got = signals.forProperties(List.of(hit, clean));

        assertThat(got).containsKeys(hit.getId(), clean.getId());
        assertThat(got.get(hit.getId()).items()).extracting(ListingSignals.Item::code)
                .contains("broker_wording");
        assertThat(got.get(clean.getId()).items()).isEmpty();
    }
}
