package com.draazy.api.catalog.locality;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
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

/**
 * The locality curation queue, and the approval block that gives it a purpose (register item 24).
 *
 * <p>These two are tested together on purpose. Either alone is the bug in a new costume: a queue
 * nobody must clear is the {@code localStorage} screen again, and a block with no queue behind it is
 * a moderator stuck at a listing they cannot fix. What is asserted here is the <em>ordering</em> —
 * curate, then publish — because that ordering, not any single route, is what was broken.
 */
@DisplayName("Locality queue — the listings the catalogue cannot file")
class LocalityQueueEndpointTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    LocalityRepository localities;

    /**
     * Audit rows are written in {@code REQUIRES_NEW}, so they survive this test's rollback. Cleaned
     * up by actor id, which is the column {@code AuditService} fills from the token's subject.
     */
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
        createdActors.add(saved.getId().toString());
        return saved;
    }

    /**
     * A listing the resolver could not place: free text in {@code locality}, nothing in
     * {@code locality_slug}. Saved through the repository rather than the listing route precisely so
     * that {@code LocalityResolver} does not run — this is the state it leaves behind when it
     * declines, and the state the queue exists to find.
     */
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

    // ------------------------------------------------------------------ the queue is real

    /**
     * The original defect in one assertion. The old queue read a {@code localStorage} array, so a
     * listing waiting on a human decision was never in it — the screen was clear because it was
     * looking somewhere else, not because the work was done.
     */
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
                // Present and null rather than omitted: every row in the queue is unfiled by
                // definition, so a client that had to distinguish "absent" from "null" would be
                // reading a distinction the server never makes.
                .andExpect(jsonPath("$.listings[0].localitySlug").value((Object) null));
    }

    /**
     * The free text the owner typed is the one field that makes the row actionable — it is the thing
     * that failed to resolve, and a curator with only a title and a pin is guessing. Asserting it
     * separately from the row's presence because "the queue is not empty" and "the queue is useful"
     * are different claims, and the second one is the one that gets dropped in a refactor.
     */
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

    /**
     * An archived listing needs no locality — curating one would be work with no reader, and a queue
     * padded with soft-deleted rows is a queue an operator learns to distrust.
     */
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

    /**
     * A published listing missing from every locality surface is failing buyers now; a pending one
     * is only about to. The console reads this order top-down, so getting it wrong means the most
     * damaging rows sink to the bottom of a capped list.
     */
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

    // ------------------------------------------------------------------ clearing one

    /**
     * The remedy, end to end: file the listing, and it leaves the queue. Asserting the disappearance
     * as well as the 200 because a route that returns the right body and writes nothing would pass
     * the first half alone.
     */
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

    /**
     * {@code active = false} is how a locality is taken out of search facets and off its landing
     * page. Filing a listing under one would move it from "invisible because unfiled" to "invisible
     * because filed somewhere unreachable" — the same outcome for the buyer, now wearing a slug that
     * makes the console look like the job was done, which is strictly worse than the bug.
     */
    @Test
    @DisplayName("a retired area is refused — it would hide the listing just as thoroughly")
    void aRetiredLocalityIsRefused() throws Exception {
        User owner = user("9861000011", "owner");
        User staff = user("9861000012", "staff");
        Property waiting = unfiled(owner, "Undhera Wasti", PropertyStatus.PENDING);
        Locality baner = localities.findById("baner").orElseThrow();
        baner.setActive(false);
        localities.saveAndFlush(baner);

        mvc.perform(patch("/admin/locality-queue/" + waiting.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slug\":\"baner\"}"))
                .andExpect(status().isConflict());

        assertThat(properties.findById(waiting.getId()).orElseThrow().getLocalitySlug()).isNull();
    }

    /** An unknown key is a 404, not a silently stored string — {@code locality_slug} is a foreign key. */
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

    /**
     * This route's contract is "clear a queue entry". A listing that already has a locality is not a
     * queue entry, and letting it through here would make this a second, quieter way to move
     * listings between areas than the edit route that re-runs the resolver.
     */
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

    /** Who filed what, and what the owner had typed — the two facts a later dispute needs. */
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

    // ------------------------------------------------------------------ the ordering

    /**
     * The whole bug in one test. Before this, the listing was approved, its owner was told "It is
     * now live and visible to buyers", and it appeared in no locality facet, on no locality page, in
     * no saved-search alert and in no society's home list. The 409 is what turns the queue from a
     * report into a step.
     */
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

    /**
     * Only publication is blocked. A rejected listing never needed a locality, and refusing to
     * reject one would leave a moderator with no way to dispose of a listing they can see is
     * spam — turning a curation rule into a moderation deadlock.
     */
    @Test
    @DisplayName("an unfiled listing can still be rejected — the block is on publishing, not on deciding")
    void rejectingAnUnfiledListingIsAllowed() throws Exception {
        User owner = user("9861000021", "owner");
        User staff = user("9861000022", "staff");
        Property waiting = unfiled(owner, "Undhera Wasti", PropertyStatus.PENDING);

        mvc.perform(patch("/properties/" + waiting.getId() + "/status")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"rejected\",\"reason\":\"not a real address\"}"))
                .andExpect(status().isOk());
    }

    /**
     * Curate, then publish — the ordering the register item is actually about, walked start to
     * finish by one operator with one permission. The second half is what proves the block is a step
     * rather than a wall: the same {@code properties:write} that was refused the approval is the one
     * that clears the queue, so nobody can be stranded by this rule.
     */
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

        mvc.perform(patch("/properties/" + waiting.getId() + "/status")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isOk());
    }

    // ------------------------------------------------------------------ what it discloses

    /**
     * Clearing this queue is a geography question, and a name or a mobile number answers none of it.
     * Asserted at whole-document depth rather than field by field, so a field added later to the
     * entry record fails this test instead of quietly turning a curation console into a second place
     * the marketplace's seller list can be read from.
     */
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

    /** An ordinary signed-in user has no business knowing which listings ops has not filed yet. */
    @Test
    @DisplayName("a buyer cannot read the curation queue")
    void aBuyerIsRefused() throws Exception {
        User buyer = user("9861000027", "buyer");

        mvc.perform(get("/admin/locality-queue")
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isForbidden());
    }
}
