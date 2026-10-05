package com.draazy.api.catalog.locality;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

// A blocking resolver needs a queue, or moderators get stuck at listings they cannot fix.
@DisplayName("Locality queue — the listings the catalogue cannot file")
class LocalityQueueEndpointTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    // Audit rows are written in `REQUIRES_NEW`, so they survive this test's rollback.
    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Probe " + role);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        if ("staff".equals(role)) {
            jdbc.update("""
                    INSERT INTO back_office_permissions (user_id, permissions)
                    VALUES (?::uuid, ?::jsonb)
                    ON CONFLICT (user_id) DO UPDATE SET permissions = EXCLUDED.permissions
                    """, saved.getId().toString(),
                    "[\"kyc\",\"propertyVerification\",\"listingModeration\",\"support\",\"content\",\"reports\",\"desk:rental\"]");
        }
        createdActors.add(saved.getId().toString());
        return saved;
    }

    // Saved through the repository so `LocalityResolver` does not run;
    // this is the state the queue exists to find.
    private Property unfiled(User owner, String typed, String status) {
        Property p = new Property(owner, "Flat in " + typed, "rent", "apartment", 28000L, typed,
                "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setStatus(status);
        return properties.saveAndFlush(p);
    }

    private Property filed(User owner, String slug, String status) {
        Property p = unfiled(owner, "Baner", status);
        p.setLocalitySlug(slug);
        return properties.saveAndFlush(p);
    }

    private void tickChecklist(Property listing, User staff) throws Exception {
        String opened = mvc.perform(post("/properties/{id}/verification/start", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<String> items = com.jayway.jsonpath.JsonPath.read(opened, "$.checklist[*].item");
        for (String item : items) {
            mvc.perform(patch("/properties/{id}/verification/checklist", listing.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"item\":\"" + item + "\",\"pass\":true}"))
                    .andExpect(status().isOk());
        }
    }

    // The original defect in one assertion.
    @Test
    @DisplayName("a listing the resolver could not place is waiting on the server, not in a browser")
    void anUnfiledListingIsInTheQueue() throws Exception {
        User owner = user("9861000001", "owner");
        User staff = user("9861000002", "staff");
        Property waiting = unfiled(owner, "Undhera Wasti", PropertyStatus.PENDING);

        mvc.perform(get("/admin/locality-queue")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.listings[?(@.id=='" + waiting.getId() + "')]").exists())
                .andExpect(jsonPath("$.listings[?(@.id=='" + waiting.getId() + "')].locality")
                        .value("Undhera Wasti"))

                .andExpect(jsonPath("$.listings[0].localitySlug").value((Object) null));
    }

    // The typed locality makes the row actionable;
    // without it, a curator has only a title and pin.
    @Test
    @DisplayName("a filed listing is not in the queue — the queue is the complement, not a list of listings")
    void aFiledListingIsAbsent() throws Exception {
        User owner = user("9861000003", "owner");
        User staff = user("9861000004", "staff");
        Property done = filed(owner, "baner", PropertyStatus.APPROVED);

        mvc.perform(get("/admin/locality-queue")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.listings[?(@.id=='" + done.getId() + "')]").doesNotExist());
    }

    @Test
    @DisplayName("an archived listing is not curation work")
    void anArchivedListingIsAbsent() throws Exception {
        User owner = user("9861000005", "owner");
        User staff = user("9861000006", "staff");
        Property gone = unfiled(owner, "Undhera Wasti", PropertyStatus.PENDING);
        jdbc.update("update properties set archived = true where id = ?", gone.getId());

        mvc.perform(get("/admin/locality-queue")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.listings[?(@.id=='" + gone.getId() + "')]").doesNotExist());
    }

    // A published listing missing from every locality surface is failing buyers now; a pending one is only about to.
    @Test
    @DisplayName("listings already live and unfindable sort above ones not yet published")
    void alreadyLiveComesFirst() throws Exception {
        User owner = user("9861000007", "owner");
        User staff = user("9861000008", "staff");
        Property pending = unfiled(owner, "Undhera Wasti", PropertyStatus.PENDING);
        Property live = unfiled(owner, "Undhera Wasti", PropertyStatus.APPROVED);

        String body = mvc.perform(get("/admin/locality-queue")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(body.indexOf(live.getId().toString()))
                .as("the live-and-invisible listing is the more urgent repair")
                .isLessThan(body.indexOf(pending.getId().toString()));
    }

    // Assert disappearance too; a route returning 200 but writing nothing would pass otherwise.
    @Test
    @DisplayName("filing a listing under an area clears it from the queue")
    void assigningClearsTheQueueEntry() throws Exception {
        User owner = user("9861000009", "owner");
        User staff = user("9861000010", "staff");
        Property waiting = unfiled(owner, "Undhera Wasti", PropertyStatus.PENDING);

        mvc.perform(patch("/admin/locality-queue/" + waiting.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slug\":\"baner\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.localitySlug").value("baner"));

        mvc.perform(get("/admin/locality-queue")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.listings[?(@.id=='" + waiting.getId() + "')]")
                        .doesNotExist());
        assertThat(properties.findById(waiting.getId()).orElseThrow().getLocalitySlug())
                .isEqualTo("baner");
    }

    // `active = false` is how a locality is taken out of search facets and off its landing page.
    @Test
    @DisplayName("a retired area is refused — it would hide the listing just as thoroughly")
    void aRetiredLocalityIsRefused() throws Exception {
        User owner = user("9861000011", "owner");
        User staff = user("9861000012", "staff");
        Property waiting = unfiled(owner, "Undhera Wasti", PropertyStatus.PENDING);
        jdbc.update("update localities set active = false where slug = 'baner'");

        mvc.perform(patch("/admin/locality-queue/" + waiting.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slug\":\"baner\"}"))
                .andExpect(status().isConflict());

        assertThat(properties.findById(waiting.getId()).orElseThrow().getLocalitySlug()).isNull();
    }

    @Test
    @DisplayName("an area that does not exist cannot be invented from the queue")
    void anUnknownLocalityIsRefused() throws Exception {
        User owner = user("9861000013", "owner");
        User staff = user("9861000014", "staff");
        Property waiting = unfiled(owner, "Undhera Wasti", PropertyStatus.PENDING);

        mvc.perform(patch("/admin/locality-queue/" + waiting.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slug\":\"undhera-wasti\"}"))
                .andExpect(status().isNotFound());
    }

    // This route's contract is "clear a queue entry".
    @Test
    @DisplayName("an already-filed listing cannot be refiled from the queue")
    void refilingIsRefused() throws Exception {
        User owner = user("9861000015", "owner");
        User staff = user("9861000016", "staff");
        Property done = filed(owner, "baner", PropertyStatus.PENDING);

        mvc.perform(patch("/admin/locality-queue/" + done.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slug\":\"kothrud\"}"))
                .andExpect(status().isConflict());

        assertThat(properties.findById(done.getId()).orElseThrow().getLocalitySlug())
                .isEqualTo("baner");
    }

    @Test
    @DisplayName("filing a listing is recorded against the curator who did it")
    void assigningIsAudited() throws Exception {
        User owner = user("9861000017", "owner");
        User staff = user("9861000018", "staff");
        Property waiting = unfiled(owner, "Undhera Wasti", PropertyStatus.PENDING);

        mvc.perform(patch("/admin/locality-queue/" + waiting.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slug\":\"baner\"}"))
                .andExpect(status().isOk());

        assertThat(jdbc.queryForList(
                "select metadata->>'slug' as slug, metadata->>'typed' as typed from audit_log"
                        + " where action = 'property.locality' and entity_id = ?",
                waiting.getId().toString()))
                .singleElement()
                .satisfies(row -> {
                    assertThat(row.get("slug")).isEqualTo("baner");
                    assertThat(row.get("typed")).isEqualTo("Undhera Wasti");
                });
    }

    // The whole bug in one test.
    @Test
    @DisplayName("a listing with no locality cannot be published")
    void approvingAnUnfiledListingIsRefused() throws Exception {
        User owner = user("9861000019", "owner");
        User staff = user("9861000020", "staff");
        Property waiting = unfiled(owner, "Undhera Wasti", PropertyStatus.PENDING);

        mvc.perform(patch("/properties/" + waiting.getId() + "/status")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isConflict());

        assertThat(properties.findById(waiting.getId()).orElseThrow().getStatus())
                .as("the listing stays where it was; a refused approval must not half-apply")
                .isEqualTo(PropertyStatus.PENDING);
    }

    // Rejection must bypass locality curation, or spam with an unknown locality
    // becomes a moderation deadlock.
    @Test
    @DisplayName("an unfiled listing can still be rejected — the block is on publishing, not on deciding")
    void rejectingAnUnfiledListingIsAllowed() throws Exception {
        User owner = user("9861000021", "owner");
        User staff = user("9861000022", "staff");
        Property waiting = unfiled(owner, "Undhera Wasti", PropertyStatus.PENDING);

        mvc.perform(patch("/properties/" + waiting.getId() + "/status")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"status":"rejected","reasonCode":"wrong_details","reason":"not a real address"}
                                """))
                .andExpect(status().isOk());
    }

    // Curate, then publish: one operator with one permission proves the ordering.
    @Test
    @DisplayName("filing the listing is what makes it publishable")
    void curatingFirstUnblocksApproval() throws Exception {
        User owner = user("9861000023", "owner");
        User staff = user("9861000024", "staff");
        Property waiting = unfiled(owner, "Undhera Wasti", PropertyStatus.PENDING);

        mvc.perform(patch("/properties/" + waiting.getId() + "/status")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isConflict());

        mvc.perform(patch("/admin/locality-queue/" + waiting.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slug\":\"baner\"}"))
                .andExpect(status().isOk());

        tickChecklist(waiting, staff);
        mvc.perform(patch("/properties/" + waiting.getId() + "/status")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isOk());
    }

    // Whole-document assertion catches new fields that would turn the curation
    // console into another seller-list read.
    @Test
    @DisplayName("the queue names no owner and no contact")
    void theQueueCarriesNoOwnerData() throws Exception {
        User owner = user("9861000025", "owner");
        User staff = user("9861000026", "staff");
        unfiled(owner, "Undhera Wasti", PropertyStatus.PENDING);

        String body = mvc.perform(get("/admin/locality-queue")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(body).doesNotContain("9861000025").doesNotContain("Probe owner")
                .doesNotContain("owner");
    }

    @Test
    @DisplayName("a buyer cannot read the curation queue")
    void aBuyerIsRefused() throws Exception {
        User buyer = user("9861000027", "buyer");

        mvc.perform(get("/admin/locality-queue")
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isForbidden());
    }
}
