package com.draazy.api.engagement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.ResultActions;

/**
 * A merge is a shared, reversible fact on the server, not one operator's browser storage.
 * Semantics: docs/flows/consumer/societies.md §9.1.
 */
@DisplayName("Societies — merging duplicates")
class SocietyMergeTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;

    /**
     * Audit rows commit {@code REQUIRES_NEW} and outlive this class's rollback. Static, and run
     * before as well as after, because a killed build leaves rows that fail the next clean run.
     */
    @BeforeAll
    static void removeAuditRowsLeftByAnEarlierRun(@Autowired JdbcTemplate jdbc) {
        sweepOwnAuditRows(jdbc);
    }

    /** @see #removeAuditRowsLeftByAnEarlierRun */
    @AfterAll
    static void removeAuditRowsThatEscapedRollback(@Autowired JdbcTemplate jdbc) {
        sweepOwnAuditRows(jdbc);
    }

    private static void sweepOwnAuditRows(JdbcTemplate jdbc) {
        jdbc.update("delete from audit_log where entity = 'society' and entity_id like '%-d243'");
    }

    /** Mobile block 98680000xx — used by no other test class. */
    private User user(String mobile, String name) {
        User u = new User(mobile, Roles.Wire.BUYER);
        u.setName(name);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private String staff(String mobile) {
        User u = new User(mobile, Roles.Wire.STAFF);
        u.setName("Ops " + mobile.substring(6));
        u.setMobileVerified(true);
        return "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(u));
    }

    /** Minted through the public route so it carries {@code source = 'community'}, like a member's. */
    private String society(User author, String name) throws Exception {
        ResultActions minted = mvc.perform(post("/societies")
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"" + name + "\"}"))
                .andExpect(status().isCreated());
        String json = minted.andReturn().getResponse().getContentAsString();
        int at = json.indexOf("\"slug\":\"") + 8;
        return json.substring(at, json.indexOf('"', at));
    }

    private ResultActions merge(String ops, String from, String into) throws Exception {
        return mvc.perform(post("/admin/society-merges")
                .header(HttpHeaders.AUTHORIZATION, ops)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"from\":\"" + from + "\",\"into\":\"" + into + "\"}"));
    }

    private ResultActions undo(String ops, String slug) throws Exception {
        return mvc.perform(delete("/admin/society-merges/" + slug)
                .header(HttpHeaders.AUTHORIZATION, ops));
    }

    private UUID id(String slug) {
        return jdbc.queryForObject("select id from societies where slug = ?", UUID.class, slug);
    }

    private Map<String, Object> row(String slug) {
        return jdbc.queryForMap(
                "select id, merged_into, merged_at, merged_by from societies where slug = ?", slug);
    }

    /** A live listing filed against one society, as a member's would be. */
    private Property listing(User owner, String title, UUID societyId) {
        Property p = new Property(owner, title, "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        p.setSocietyId(societyId);
        p.setStatus("approved");
        return properties.saveAndFlush(p);
    }

    private String directory(String q) throws Exception {
        return mvc.perform(get("/societies").param("q", q).param("size", "100"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    // ------------------------------------------------------------- the shared fact

    @Test
    @DisplayName("a merge one operator makes is a fact every other operator and searcher sees")
    void mergeIsSharedRatherThanHeldInOneBrowser() throws Exception {
        User author = user("9868000001", "Aarav Merge");
        String first = staff("9868000002");
        String second = staff("9868000003");

        String keep = society(author, "Sereno Heights D243");
        String duplicate = society(author, "Sereno Hights D243");

        merge(first, duplicate, keep)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.slug").value(duplicate))
                .andExpect(jsonPath("$.intoSlug").value(keep))
                .andExpect(jsonPath("$.mergedAt").exists());

        // A browser-local merge leaves this queue empty for everyone else, so the pair waits to be
        // merged a second time, possibly the other way round.
        String queue = mvc.perform(get("/admin/society-merges")
                        .header(HttpHeaders.AUTHORIZATION, second).param("size", "100"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(queue).contains("\"slug\":\"" + duplicate + "\"")
                .contains("\"intoSlug\":\"" + keep + "\"");

        // And the searcher, who never saw the merge and is the reason it was made.
        String listed = directory("D243");
        assertThat(listed).contains(keep).doesNotContain("\"slug\":\"" + duplicate + "\"");
    }

    @Test
    @DisplayName("the merged-away slug keeps answering, with the surviving society")
    void theOldSlugResolvesToTheSurvivor() throws Exception {
        User author = user("9868000004", "Bhavna Merge");
        String ops = staff("9868000005");

        String keep = society(author, "Trellis Court D243");
        String duplicate = society(author, "Trelis Court D243");
        merge(ops, duplicate, keep).andExpect(status().isCreated());

        // 404 would break every indexed URL, shared link and saved alert the moment an operator
        // tidied the catalogue, with no way to know in advance.
        mvc.perform(get("/societies/" + duplicate))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value(keep))
                .andExpect(jsonPath("$.name").value("Trellis Court D243"));
    }

    @Test
    @DisplayName("the survivor shows the whole building, not the half of it that won")
    void theSurvivorAbsorbsWhatWasFiledAgainstTheDuplicate() throws Exception {
        User author = user("9868000006", "Chetan Merge");
        User follower = user("9868000007", "Divya Merge");
        String ops = staff("9868000008");

        String keep = society(author, "Willowmere D243");
        String duplicate = society(author, "Willowmeer D243");

        listing(author, "2 BHK in Willowmere D243", id(keep));
        listing(author, "2 BHK in the other Willowmere D243", id(duplicate));

        mvc.perform(put("/me/societies/" + duplicate + "/follow")
                .header(HttpHeaders.AUTHORIZATION, bearer(follower))).andExpect(status().isNoContent());

        merge(ops, duplicate, keep).andExpect(status().isCreated());

        // A merge that only hid the duplicate would take that second flat off both pages, leaving a
        // listing that exists and is findable nowhere.
        mvc.perform(get("/societies/" + keep))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.listingCount").value(2))
                .andExpect(jsonPath("$.followerCount").value(1))
                .andExpect(jsonPath("$.homes.length()").value(2));

        // The person who followed the duplicate followed this building, and still does.
        mvc.perform(get("/societies/" + keep)
                        .header(HttpHeaders.AUTHORIZATION, bearer(follower)))
                .andExpect(jsonPath("$.followedByMe").value(true));
    }

    @Test
    @DisplayName("a survivor whose only homes are on the duplicate still has homes")
    void hasListingsSeesTheWholeMergeFamily() throws Exception {
        User author = user("9868000021", "Farhan Merge");
        String ops = staff("9868000022");

        String keep = society(author, "Juniper Rise D243");
        String duplicate = society(author, "Junipar Rise D243");

        // Only on the loser, which is the shape a merge produces in the wild: the duplicate exists
        // because somebody listed against it.
        listing(author, "2 BHK in Juniper Rise D243", id(duplicate));
        merge(ops, duplicate, keep).andExpect(status().isCreated());

        // A correlated EXISTS on the survivor's own id would say "has a home" on the card and "has
        // none" to the rail — an omission, so nothing errors and the rail comes up short.
        mvc.perform(get("/societies").param("q", "Juniper Rise D243").param("size", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].slug").value(keep))
                .andExpect(jsonPath("$.content[0].listingCount").value(1));

        mvc.perform(get("/societies")
                        .param("q", "Juniper Rise D243").param("hasListings", "true").param("size", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].slug").value(keep));

        // And the other direction: a society nobody has listed against is not on the rail, which is
        // the whole point of the filter. Same query without it still finds it.
        String quiet = society(author, "Juniper Rise D243 Annexe");
        mvc.perform(get("/societies")
                        .param("q", "Juniper Rise D243 Annexe").param("size", "100"))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].slug").value(quiet));
        mvc.perform(get("/societies")
                        .param("q", "Juniper Rise D243 Annexe").param("hasListings", "true").param("size", "100"))
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    @DisplayName("a merge moves nothing and deletes nothing")
    void theDuplicateAndItsListingsAreLeftWhereTheyAre() throws Exception {
        User author = user("9868000009", "Esha Merge");
        String ops = staff("9868000010");

        String keep = society(author, "Marigold Enclave D243");
        String duplicate = society(author, "Marygold Enclave D243");
        UUID duplicateId = id(duplicate);
        Property filed = listing(author, "3 BHK in Marygold D243", duplicateId);

        merge(ops, duplicate, keep).andExpect(status().isCreated());

        // Rewriting `properties.society_id` would consolidate the same way but be a one-way door:
        // nothing would say which listings came from where, so no merge could be taken back.
        assertThat(jdbc.queryForObject("select society_id from properties where id = ?",
                UUID.class, filed.getId())).isEqualTo(duplicateId);

        Map<String, Object> stored = row(duplicate);
        assertThat(stored.get("merged_into")).isEqualTo(id(keep));
        assertThat(stored.get("merged_at")).isNotNull();
        assertThat(stored.get("merged_by")).isNotNull();
    }

    // ------------------------------------------------------------- what is refused

    @Test
    @DisplayName("a society cannot be merged into itself")
    void selfMergeIsRefused() throws Exception {
        User author = user("9868000011", "Farhan Merge");
        String ops = staff("9868000012");
        String slug = society(author, "Cypress Row D243");

        // The schema refuses this too, but a CHECK violation reaches the operator as a 500 with no
        // idea which of the two fields they got wrong.
        merge(ops, slug, slug).andExpect(status().isUnprocessableEntity());
        assertThat(row(slug).get("merged_into")).isNull();
    }

    @Test
    @DisplayName("merges cannot be chained, in either direction")
    void chainsAreRefusedFromBothEnds() throws Exception {
        User author = user("9868000013", "Gauri Merge");
        String ops = staff("9868000014");

        String a = society(author, "Lantern Bay D243");
        String b = society(author, "Lantren Bay D243");
        String c = society(author, "Lanturn Bay D243");
        merge(ops, b, a).andExpect(status().isCreated());

        // Forward: `a` has something pointing at it, so merging it onward would leave `b` two hops
        // away. The refusal names `b`, since two rows sharing a name is the normal case here.
        merge(ops, a, c)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(containsString(b)));

        // Backward: merging into `b`, which is itself merged away, would put the same two-hop
        // pointer in place from the other end.
        merge(ops, c, b).andExpect(status().isConflict());

        assertThat(row(a).get("merged_into")).isNull();
        assertThat(row(c).get("merged_into")).isNull();
    }

    @Test
    @DisplayName("merging the same society twice tells the second operator who won")
    void aSecondMergeOfTheSameSocietyIsAConflict() throws Exception {
        User author = user("9868000015", "Hiten Merge");
        String first = staff("9868000016");
        String second = staff("9868000017");

        String keep = society(author, "Pinehurst D243");
        String other = society(author, "Pinehirst D243");
        String duplicate = society(author, "Pine Hurst D243");

        merge(first, duplicate, keep).andExpect(status().isCreated());

        // Two operators clearing the same queue at the same time. Letting the second write win would
        // silently overwrite the first one's decision and the record of who made it.
        merge(second, duplicate, other).andExpect(status().isConflict());
        assertThat(row(duplicate).get("merged_into")).isEqualTo(id(keep));
    }

    @Test
    @DisplayName("merging is a back-office write, not something a member can do")
    void mergingIsStaffAndWriteScoped() throws Exception {
        User buyer = user("9868000018", "Ishan Merge");
        String keep = society(buyer, "Kestrel Park D243");
        String duplicate = society(buyer, "Kestral Park D243");

        mvc.perform(post("/admin/society-merges")
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"from\":\"" + duplicate + "\",\"into\":\"" + keep + "\"}"))
                .andExpect(status().isForbidden());

        mvc.perform(get("/admin/society-merges")).andExpect(status().isUnauthorized());
    }

    // ------------------------------------------------------------- taking it back

    @Test
    @DisplayName("an undo puts the society back exactly as it was")
    void undoRestoresTheDuplicate() throws Exception {
        User author = user("9868000019", "Jyoti Merge");
        String ops = staff("9868000020");

        String keep = society(author, "Solstice Grove D243");
        String duplicate = society(author, "Solstise Grove D243");
        merge(ops, duplicate, keep).andExpect(status().isCreated());

        undo(ops, duplicate).andExpect(status().isNoContent());

        Map<String, Object> stored = row(duplicate);
        assertThat(stored.get("merged_into")).isNull();
        assertThat(stored.get("merged_at")).isNull();
        assertThat(stored.get("merged_by")).isNull();

        // Back in the directory and answering for itself — merging is a judgement an operator must
        // be able to take back when a resident says the two buildings really are different.
        assertThat(directory("D243")).contains("\"slug\":\"" + duplicate + "\"");
        mvc.perform(get("/societies/" + duplicate))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value(duplicate));
    }

    @Test
    @DisplayName("undoing a merge that was never made is a 404, not a silent success")
    void undoOfAnUnmergedSocietyIsNotFound() throws Exception {
        User author = user("9868000021", "Kabir Merge");
        String ops = staff("9868000022");
        String slug = society(author, "Beacon Rise D243");

        // A 204 here would tell an operator who mistyped a slug that they had just undone something.
        undo(ops, slug).andExpect(status().isNotFound());
        undo(ops, "no-such-society-d243").andExpect(status().isNotFound());
    }

    // ------------------------------------------------------------- agreeing with the rest

    @Test
    @DisplayName("a merged-away society leaves the candidates queue")
    void theDuplicateStopsAskingToBeVerified() throws Exception {
        User author = user("9868000023", "Leela Merge");
        String ops = staff("9868000024");

        String keep = society(author, "Orchid Meadows D243");
        String duplicate = society(author, "Orkid Meadows D243");
        merge(ops, duplicate, keep).andExpect(status().isCreated());

        String queue = mvc.perform(get("/admin/society-candidates")
                        .header(HttpHeaders.AUTHORIZATION, ops).param("size", "200"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        // Confirming a society an operator has already judged not to be a separate building is work
        // that cannot produce a right answer.
        assertThat(queue).doesNotContain("\"slug\":\"" + duplicate + "\"")
                .contains("\"slug\":\"" + keep + "\"");

        mvc.perform(post("/admin/society-candidates/" + duplicate + "/verify")
                        .header(HttpHeaders.AUTHORIZATION, ops))
                .andExpect(status().isConflict());
    }

    @Test
    @DisplayName("adding the duplicate's name again returns the society it was merged into")
    void mintingTheOldNameLandsOnTheSurvivor() throws Exception {
        User author = user("9868000025", "Manav Merge");
        User member = user("9868000026", "Nisha Merge");
        String ops = staff("9868000027");

        String keep = society(author, "Aster Vale D243");
        String duplicate = society(author, "Astar Vale D243");
        merge(ops, duplicate, keep).andExpect(status().isCreated());

        // Nothing was deleted, so both mint-guard lookups still find the duplicate. Handing it back
        // would put the pair in front of the operator again and file this flat against a retired row.
        mvc.perform(post("/societies")
                        .header(HttpHeaders.AUTHORIZATION, bearer(member))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Astar Vale D243\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value(keep));
    }

    @Test
    @DisplayName("both the merge and the undo are written to the audit log")
    void theDecisionSurvivesEvenWhenItIsReversed() throws Exception {
        User author = user("9868000028", "Omkar Merge");
        String ops = staff("9868000029");

        String keep = society(author, "Verandah Court D243");
        String duplicate = society(author, "Veranda Court D243");

        merge(ops, duplicate, keep).andExpect(status().isCreated());
        assertThat(auditCount("society.merge", duplicate)).isOne();

        undo(ops, duplicate).andExpect(status().isNoContent());

        // An undo takes all three merge columns back to null, so without the audit rows the fact
        // that a merge was ever made would be gone from the database entirely.
        assertThat(auditCount("society.unmerge", duplicate)).isOne();
        assertThat(row(duplicate).get("merged_into")).isNull();
    }

    private Integer auditCount(String action, String slug) {
        return jdbc.queryForObject(
                "select count(*) from audit_log where action = ? and entity_id = ?",
                Integer.class, action, slug);
    }
}
