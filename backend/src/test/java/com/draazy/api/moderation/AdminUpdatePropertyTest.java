package com.draazy.api.moderation;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.JwtService;
import com.draazy.api.security.Roles;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

/**
 * {@code PATCH /properties/{id}/admin} — a moderator correcting somebody else's listing (slice 15).
 *
 * <p>Two things distinguish it from the owner's own {@code PATCH /me/listings/{id}}, and both are
 * tested here rather than assumed:
 *
 * <ol>
 *   <li><strong>It does not revert the listing to pending.</strong> Re-moderation exists so a
 *       change made by the owner is seen by a moderator before it goes live. Here the moderator
 *       <em>is</em> the change — reverting would push their own correction into their own queue, so
 *       fixing a typo would take the listing off the site until somebody re-approved it.</li>
 *   <li><strong>It is audited.</strong> This is a write to a row belonging to someone who will never
 *       be told it happened.</li>
 * </ol>
 *
 * <p>Everything else — which fields apply, how PATCH treats absent values, when the locality slug is
 * re-bound — is deliberately the same code as the owner path, so it is tested once, there.
 */
@DisplayName("Moderation — admin listing correction")
class AdminUpdatePropertyTest extends AbstractApiTest {

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired JdbcTemplate jdbc;

    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String mobile, String role, String name) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private Property approvedListing(User owner) {
        Property p = new Property(owner, "2BHK in Baner", "rent", "apartment", 28000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setStatus(PropertyStatus.APPROVED);
        return properties.saveAndFlush(p);
    }

    /**
     * The ruling of this endpoint. {@code price} and {@code bhk} are both foundation fields: the same
     * edit through {@code /me/listings} costs the owner a re-review — {@code bhk} takes the listing
     * off search, {@code price} queues a stays-live re-check (Q14). Through this one it must cost
     * neither, or a moderator fixing a listing takes it off the site, or files themselves a ticket
     * to re-check the correction they just made.
     */
    @Test
    @DisplayName("a moderator's edit does NOT push an approved listing back into the queue")
    void moderatorEditDoesNotRevertToPending() throws Exception {
        User owner = user("9871110001", Roles.Wire.OWNER, "Owner");
        User staff = user("9871110002", Roles.Wire.STAFF, "Ops");
        Property listing = approvedListing(owner);

        mvc.perform(patch(Routes.Moderation.PROPERTY_ADMIN_UPDATE, listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"price\":26000,\"bhk\":3,"
                                + "\"title\":\"2 BHK in Baner (corrected)\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.price").value(26000))
                .andExpect(jsonPath("$.title").value("2 BHK in Baner (corrected)"))
                .andExpect(jsonPath("$.status").value(PropertyStatus.APPROVED))
                .andExpect(jsonPath("$.recheckPending").value(false));
    }

    /**
     * The contrast, proved rather than asserted in prose: the owner's own path still charges for the
     * identical body. {@code bhk} is what it fundamentally is, so that half goes off search — and
     * because the revert supersedes the re-check, the price change rides along with it.
     */
    @Test
    @DisplayName("the owner's own edit of the same fields still costs a re-review")
    void ownerEditStillReverts() throws Exception {
        User owner = user("9871110003", Roles.Wire.OWNER, "Owner");
        Property listing = approvedListing(owner);

        mvc.perform(patch(Routes.MeListings.BY_ID, listing.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"price\":26000,\"bhk\":3}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(PropertyStatus.PENDING));
    }

    @Test
    @DisplayName("the correction is audited against the acting staff member")
    void correctionIsAudited() throws Exception {
        User owner = user("9871110004", Roles.Wire.OWNER, "Owner");
        User staff = user("9871110005", Roles.Wire.STAFF, "Ops");
        Property listing = approvedListing(owner);

        mvc.perform(patch(Routes.Moderation.PROPERTY_ADMIN_UPDATE, listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"description\":\"Corrected by ops.\"}"))
                .andExpect(status().isOk());

        assertThat(jdbc.queryForList(
                "select * from audit_log where action = ? and entity_id = ? and actor = ?",
                "property.adminUpdate", listing.getId().toString(), staff.getId().toString()))
                .hasSize(1);
    }

    @Test
    @DisplayName("absent fields are left alone — PATCH, not PUT")
    void absentFieldsAreUntouched() throws Exception {
        User owner = user("9871110006", Roles.Wire.OWNER, "Owner");
        User admin = user("9871110007", Roles.Wire.ADMIN, "Admin");
        Property listing = approvedListing(owner);

        mvc.perform(patch(Routes.Moderation.PROPERTY_ADMIN_UPDATE, listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"description\":\"Only this changed.\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.price").value(28000))
                .andExpect(jsonPath("$.title").value("2BHK in Baner"))
                .andExpect(jsonPath("$.description").value("Only this changed."));
    }

    /**
     * The response carries the owner's raw number, and this test was reversed to say so.
     *
     * <p>It previously asserted masking. The desk that corrects somebody else's listing is the desk
     * that then rings them about it, and a moderator denied the number here fetches it from
     * somewhere the platform cannot log — so the mask was protecting the audit trail from the
     * disclosure rather than the owner from staff. Reversing it was a decision, not a regression,
     * which is why the assertion is now equally strict in the other direction.
     */
    @Test
    @DisplayName("the response carries the owner's mobile, because the corrector is the caller")
    void ownerContactIsRevealed() throws Exception {
        User owner = user("9871110008", Roles.Wire.OWNER, "Owner");
        User staff = user("9871110009", Roles.Wire.STAFF, "Ops");
        Property listing = approvedListing(owner);

        mvc.perform(patch(Routes.Moderation.PROPERTY_ADMIN_UPDATE, listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"negotiable\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.owner.mobile").value("9871110008"));
    }

    @Test
    @DisplayName("an owner cannot use it on their own listing, let alone anyone else's")
    void ownerIsForbidden() throws Exception {
        User owner = user("9871110010", Roles.Wire.OWNER, "Owner");
        Property listing = approvedListing(owner);

        mvc.perform(patch(Routes.Moderation.PROPERTY_ADMIN_UPDATE, listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"price\":1}"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("anonymous is 401")
    void anonymousIsUnauthorized() throws Exception {
        User owner = user("9871110011", Roles.Wire.OWNER, "Owner");
        Property listing = approvedListing(owner);

        mvc.perform(patch(Routes.Moderation.PROPERTY_ADMIN_UPDATE, listing.getId())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"price\":1}"))
                .andExpect(status().isUnauthorized());
    }

    /** S67 — the path that edits somebody else's row had no failure documented at all. */
    @Test
    @DisplayName("an unknown listing is a 404")
    void unknownListingIsNotFound() throws Exception {
        User staff = user("9871110012", Roles.Wire.STAFF, "Ops");
        mvc.perform(patch(Routes.Moderation.PROPERTY_ADMIN_UPDATE,
                        "00000000-0000-0000-0000-000000000000")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"price\":1}"))
                .andExpect(status().isNotFound());
    }
}
