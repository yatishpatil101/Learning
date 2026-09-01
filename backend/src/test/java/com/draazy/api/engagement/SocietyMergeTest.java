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
 * D243 — merging duplicate societies, on the server.
 *
 * <p>{@code mergeSocieties(a, b)} lived in {@code frontend/src/lib/store/societyAdmin.js} and wrote
 * to the operator's own {@code localStorage}. So a merge was one person's opinion held in one
 * browser: a second operator opened the same queue, saw the same untouched pair, and merged it
 * again — possibly the other way round. Neither of them could see that the other had decided
 * anything, and neither decision reached a searcher, who kept seeing both copies of the building.
 *
 * <p>What is asserted here is what a browser-local merge could not be:
 *
 * <ol>
 *   <li><strong>A merge is a shared fact.</strong> The operator who did not do it sees it, and so
 *       does an anonymous searcher: the duplicate leaves the directory in the same request.</li>
 *   <li><strong>The merged-away slug still answers, with the survivor.</strong> 404 was the other
 *       option and it is the wrong one — that slug is in Google's index, in shared links and in
 *       every alert somebody set. Merging must not be a way to break them.</li>
 *   <li><strong>The survivor absorbs the duplicate's listings, followers and reviews.</strong> A
 *       merge that only hid the duplicate would leave the building's evidence split across two rows,
 *       one now invisible, which is strictly worse than the duplicate it was meant to fix.</li>
 *   <li><strong>Nothing is moved and nothing is deleted.</strong> The duplicate's row and its
 *       listings' {@code society_id} are untouched, which is the whole basis of the undo below. A
 *       merge that rewrote foreign keys would be a decision nobody could take back.</li>
 *   <li><strong>Chains are refused in both directions.</strong> The browser version collapsed them
 *       silently, and a collapsed chain cannot be undone because the intermediate hop is gone.</li>
 *   <li><strong>An undo puts the society back.</strong> Merging is a judgement call about two names
 *       an operator has never seen the inside of; the only safe version of it is reversible.</li>
 *   <li><strong>Minting agrees with the merge.</strong> A merged-away name still occupies its slug,
 *       so without following the pointer the very next member to type it gets the retired row back
 *       and the pair reappears in front of the operator who thought they had dealt with it.</li>
 *   <li><strong>Both directions are audited.</strong> Unlike the sibling society queues, an undo
 *       erases its own evidence — the three columns go back to null — so the audit log is the only
 *       place a merge that was made and reversed can still be read.</li>
 * </ol>
 */
@DisplayName("Societies — merging duplicates")
class SocietyMergeTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;

    /**
     * {@code AuditService.record} runs {@code REQUIRES_NEW}, so its rows commit and outlive this
     * class's rollback — everything else here goes back on its own.
     *
     * <p>Static, and therefore outside the per-test transaction, which is the only place this can
     * work. The obvious {@code @AfterEach} version is rolled back along with the test that ran it,
     * so the rows survive anyway and the counts below climb by one on every run until the assertion
     * fails on a machine where nothing is wrong. Every slug this class mints carries the {@code
     * -d243} suffix, so this sweeps its own rows and nobody else's.
     *
     * <p>Run <em>before</em> as well as after, and that is not belt-and-braces. Sweeping only on the
     * way out assumes every previous run reached the exit, and the runs that do not — a killed
     * build, a debugger session abandoned mid-class, a JVM that died on the machine before this one
     * — are exactly the ones that leave rows behind. The failure they cause is the worst shape
     * available: it appears on the next run, in a test that did nothing wrong, on a assertion about
     * a count, and it goes away by itself if you happen to run the class twice. The test database
     * is shared and persistent here (no Testcontainers — see {@code test/resources/application
     * .properties}), so "the table starts empty" is never true and must not be assumed.
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

    /**
     * A community society, minted through the public route so it is built exactly as a member's
     * would be — including {@code source = 'community'}, which keeps it clear of the sibling tests
     * that pick fixtures positionally out of the seeded catalogue.
     */
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

        // The second operator is the whole point. In the browser version this queue was read out of
        // the first operator's localStorage, so for this one it was empty and the pair was still
        // sitting there waiting to be merged a second time, possibly the other way round.
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

        // 404 here would mean every indexed URL, shared link, saved alert and listing filed under
        // the duplicate broke the moment an operator tidied up the catalogue -- and they would have
        // had no way to know that in advance.
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

        // A merge that only hid the duplicate would take that second flat off both pages: off the
        // duplicate's because it is unreachable, and off the survivor's because it never referenced
        // it. The listing would exist and be findable nowhere.
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
    @DisplayName("a merge moves nothing and deletes nothing")
    void theDuplicateAndItsListingsAreLeftWhereTheyAre() throws Exception {
        User author = user("9868000009", "Esha Merge");
        String ops = staff("9868000010");

        String keep = society(author, "Marigold Enclave D243");
        String duplicate = society(author, "Marygold Enclave D243");
        UUID duplicateId = id(duplicate);
        Property filed = listing(author, "3 BHK in Marygold D243", duplicateId);

        merge(ops, duplicate, keep).andExpect(status().isCreated());

        // This is what makes the undo below possible at all. Rewriting `properties.society_id` to
        // the survivor would consolidate the same way and would be a one-way door: nothing left on
        // the row would say which listings came from where, so no operator could ever take back a
        // merge they got wrong.
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

        // Forward: `a` now has something pointing at it, so merging it onward would leave `b`
        // pointing at a society that is itself merged away. The browser version collapsed that hop
        // silently, and a collapsed chain cannot be undone -- the middle of it no longer exists.
        //
        // The refusal has to NAME `b`. A live run of the ops console caught this branch answering
        // "already has 1 society(s) merged into it" and stopping there, which tells an operator that
        // something is in the way without telling them what, and leaves them searching the merge
        // list for a fact the server already had in hand. The slug is asserted as well as the name
        // because duplicates are the whole subject here -- two rows sharing a name is the normal
        // case, so a name on its own would not identify the merge to undo.
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

        // Back in the directory and answering for itself again -- merging is a judgement about two
        // names an operator has never seen the inside of, and the only safe version of that is one
        // they can take back when a resident tells them the two buildings really are different.
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

        // Nothing was deleted, so both lookups in the mint guard still find the duplicate. Handing
        // it back would put the pair straight back in front of the operator who just merged it, and
        // file this member's flat against the row that was retired.
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

        // The sibling society queues are not audited, and they do not need to be: their outcome
        // stays legible on the row. An undo takes all three merge columns back to null, so without
        // this the fact that a merge was ever made -- and by whom, and which way round -- would be
        // gone from the database entirely.
        assertThat(auditCount("society.unmerge", duplicate)).isOne();
        assertThat(row(duplicate).get("merged_into")).isNull();
    }

    private Integer auditCount(String action, String slug) {
        return jdbc.queryForObject(
                "select count(*) from audit_log where action = ? and entity_id = ?",
                Integer.class, action, slug);
    }
}
