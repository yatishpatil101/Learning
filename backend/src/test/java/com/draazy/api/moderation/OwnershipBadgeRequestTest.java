package com.draazy.api.moderation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.documents.vault.Document;
import com.draazy.api.documents.vault.DocumentRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.security.Teams;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

@DisplayName("Verified badge request — asked from the vault, answered by the desk")
class OwnershipBadgeRequestTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    DocumentRepository documents;

    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("User " + mobile);
        u.setMobileVerified(true);
        if (Roles.Wire.STAFF.equals(role)) u.setTeam(Teams.RENTAL);
        User saved = users.saveAndFlush(u);
        if (Roles.Wire.STAFF.equals(role)) {
            jdbc.update("""
                    INSERT INTO back_office_permissions (user_id, permissions)
                    VALUES (?::uuid, ?::jsonb)
                    ON CONFLICT (user_id) DO UPDATE SET permissions = EXCLUDED.permissions
                    """, saved.getId().toString(), "[\"propertyVerification\",\"desk:rental\"]");
        }
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private Property listing(User owner, String status) {
        Property p = new Property(owner, "2BHK in Baner", "rent", "apartment", 34000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("950"));
        p.setStatus(status);
        return properties.saveAndFlush(p);
    }

    private void vaultFile(Property listing) {
        documents.saveAndFlush(new Document(listing.getId(), "Electricity Bill", "bill.pdf",
                "documents/" + listing.getId() + "/" + UUID.randomUUID(), 2048L, "application/pdf"));
    }

    private static String ownership(Property p) {
        return "/properties/" + p.getId() + "/verification/ownership";
    }

    private void request(Property p, User owner) throws Exception {
        mvc.perform(post(ownership(p) + "/request").header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requestedAt").isNotEmpty());
    }

    private Property reload(Property p) {
        return properties.findById(p.getId()).orElseThrow();
    }

    @Test
    @DisplayName("uploading papers asks nothing; the owner's request puts a live listing in the re-check queue")
    void anExplicitRequestQueuesALiveListing() throws Exception {
        User owner = user("9820007101", Roles.Wire.OWNER);
        Property p = listing(owner, PropertyStatus.APPROVED);
        vaultFile(p);
        assertThat(reload(p).isRecheckPending()).isFalse();

        request(p, owner);

        Property saved = reload(p);
        assertThat(saved.getStatus()).isEqualTo(PropertyStatus.APPROVED);
        assertThat(saved.getRecheckReason()).isEqualTo(Property.OWNERSHIP_REVIEW_ITEM);
        mvc.perform(get("/me/listings").header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.content[0].ownershipRequestedAt").isNotEmpty());
    }

    @Test
    @DisplayName("an open badge request lets the desk read the vault even when the review case has long closed")
    void anOpenRequestKeepsTheVaultReadable() throws Exception {
        User owner = user("9820007141", Roles.Wire.OWNER);
        String staff = bearer(user("9820007142", Roles.Wire.STAFF));
        Property p = listing(owner, PropertyStatus.APPROVED);
        vaultFile(p);

        mvc.perform(get(ownership(p) + "/documents").header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isForbidden());
        request(p, owner);
        mvc.perform(get(ownership(p) + "/documents").header(HttpHeaders.AUTHORIZATION, staff))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].category").value("Electricity Bill"));
    }

    @Test
    @DisplayName("the request needs a document, the owner, and no badge already held")
    void theRequestIsGuarded() throws Exception {
        User owner = user("9820007111", Roles.Wire.OWNER);
        Property p = listing(owner, PropertyStatus.APPROVED);

        mvc.perform(post(ownership(p) + "/request").header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isConflict());

        vaultFile(p);
        User stranger = user("9820007112", Roles.Wire.OWNER);
        mvc.perform(post(ownership(p) + "/request").header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());

        Property badged = reload(p);
        badged.verifyOwnership(java.time.Instant.now(), null);
        properties.saveAndFlush(badged);
        mvc.perform(post(ownership(p) + "/request").header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isConflict());
    }

    @Test
    @DisplayName("a decline keeps a paused listing paused, drops the queue item and tells the owner why")
    void aDeclineNeedsAReasonAndNotifiesTheOwner() throws Exception {
        User owner = user("9820007121", Roles.Wire.OWNER);
        String staff = bearer(user("9820007122", Roles.Wire.STAFF));
        Property p = listing(owner, PropertyStatus.PAUSED);
        vaultFile(p);
        request(p, owner);

        mvc.perform(post(ownership(p) + "/decline").header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\" \"}"))
                .andExpect(status().isUnprocessableEntity());
        mvc.perform(post(ownership(p) + "/decline").header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"no\"}"))
                .andExpect(status().isForbidden());

        mvc.perform(post(ownership(p) + "/decline").header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"The bill is for a different flat\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requestedAt").isEmpty())
                .andExpect(jsonPath("$.declinedReason").value("The bill is for a different flat"));

        Property saved = reload(p);
        assertThat(saved.getStatus()).isEqualTo(PropertyStatus.PAUSED);
        assertThat(saved.isRecheckPending()).isFalse();
        assertThat(jdbc.queryForList("select type from notifications where user_id = ?",
                String.class, owner.getId())).contains("listing.badge_declined");

        mvc.perform(get(ownership(p)).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.declinedReason").value("The bill is for a different flat"));

        request(p, owner);
        assertThat(reload(p).getOwnershipDeclinedReason()).isNull();
    }

    @Test
    @DisplayName("declining with no open request is refused")
    void declineWithoutARequestIsAConflict() throws Exception {
        User owner = user("9820007131", Roles.Wire.OWNER);
        String staff = bearer(user("9820007132", Roles.Wire.STAFF));
        Property p = listing(owner, PropertyStatus.APPROVED);

        mvc.perform(post(ownership(p) + "/decline").header(HttpHeaders.AUTHORIZATION, staff)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"Blurry scan\"}"))
                .andExpect(status().isConflict());
    }

    @Test
    @DisplayName("a pending listing's request waits for review, then follows it into the re-check queue")
    void aPendingRequestSurvivesApproval() throws Exception {
        User owner = user("9820007141", Roles.Wire.OWNER);
        Property p = listing(owner, PropertyStatus.PENDING);
        vaultFile(p);
        request(p, owner);
        assertThat(reload(p).isRecheckPending()).isFalse();

        Property approved = reload(p);
        approved.setStatus(PropertyStatus.APPROVED);
        approved.clearRecheck();
        properties.saveAndFlush(approved);

        assertThat(reload(p).getRecheckReason()).isEqualTo(Property.OWNERSHIP_REVIEW_ITEM);
    }
}
