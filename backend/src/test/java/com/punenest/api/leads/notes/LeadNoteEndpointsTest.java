package com.punenest.api.leads.notes;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.jayway.jsonpath.JsonPath;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Contract + behaviour proof for owner-private lead annotations (V119), driven through the real
 * filter chain against the live Flyway'd Postgres.
 *
 * <p>Organised around the two things that would actually hurt if they broke. The first is
 * <strong>owner isolation</strong>, which carries more weight here than the {@code ownerId} column
 * makes it look: unlike every other endpoint in {@code leads}, this one cannot check that the caller
 * owns the lead it is annotating, because {@code leadKey} is opaque to the server (V119). The only
 * thing standing between two owners is that {@code ownerId} comes from the JWT and leads every
 * query — so that is what these tests attack, with the same key on both sides.
 *
 * <p>The second is the <strong>empty-annotation rule</strong>. The V119 CHECK rejects a row with
 * neither field, so "clearing a note" has to be a delete; get it wrong and the endpoint 500s on the
 * most ordinary action an owner can take.
 */
class LeadNoteEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    LeadNoteRepository leadNotes;

    /**
     * A key from the hardest of the four shapes the client mints — the document group, which carries
     * both a {@code :} and a {@code |} and is not a row id at all. Used as the default key
     * throughout so the URL-encoding path is exercised by every test rather than by one that could
     * be deleted.
     */
    private static final String DOC_KEY = "documents:99f1c0de-0000-4000-8000-000000000001|PROP1";

    private User owner(String mobile, String name) {
        User u = new User(mobile, "owner");
        u.setName(name);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private URI noteUrl(String leadKey) {
        return URI.create(Routes.MeLeadNotes.BY_KEY.replace(
                "{leadKey}", URLEncoder.encode(leadKey, StandardCharsets.UTF_8)));
    }

    private MockHttpServletRequestBuilder save(User actor, String leadKey, String json) {
        return put(noteUrl(leadKey))
                .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json);
    }

    private MockHttpServletRequestBuilder list(User actor) {
        return get(Routes.MeLeadNotes.BASE).header(HttpHeaders.AUTHORIZATION, bearer(actor));
    }

    // ---------------- writing ----------------

    /**
     * The round trip, on the awkward key. The {@code leadKey} assertion is the one with teeth: it
     * proves the {@code |} and {@code :} survived URL-encoding intact, so the note comes back
     * indexed under the same string the panel will look it up by. A key that lost a character on the
     * way through would store and return happily and simply never match a rendered lead.
     */
    @Test
    void savingANote_returnsItUnderTheSameKey() throws Exception {
        User meera = owner("9000000200", "Meera Joshi");

        mvc.perform(save(meera, DOC_KEY, """
                        {"note":"Wants a site visit on Saturday","followUpAt":"2026-09-01T09:00:00Z"}"""))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.leadKey").value(DOC_KEY))
                .andExpect(jsonPath("$.note").value("Wants a site visit on Saturday"))
                .andExpect(jsonPath("$.followUpAt").value("2026-09-01T09:00:00Z"));

        mvc.perform(list(meera))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].leadKey").value(DOC_KEY));
    }

    /**
     * A second write to the same key updates the annotation rather than appending a second one, which
     * is what {@code uq_lead_notes_owner_lead} exists to guarantee.
     *
     * <p>The row count is what carries this. Asserting only the new text would pass just as happily
     * against a service that inserted a second row and returned it, leaving the panel to pick
     * whichever of two annotations came back first.
     */
    @Test
    void savingTwiceUnderOneKey_updatesInPlace() throws Exception {
        User meera = owner("9000000201", "Meera Joshi");

        mvc.perform(save(meera, DOC_KEY, """
                {"note":"First pass","followUpAt":null}"""));
        mvc.perform(save(meera, DOC_KEY, """
                        {"note":"Called, wants Sunday instead","followUpAt":null}"""))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.note").value("Called, wants Sunday instead"));

        assertThat(leadNotes.findByOwnerId(meera.getId())).hasSize(1);
    }

    /** A follow-up date with no note is a legitimate annotation — the V119 CHECK needs only one field. */
    @Test
    void aFollowUpDateAlone_isStored() throws Exception {
        User meera = owner("9000000202", "Meera Joshi");

        mvc.perform(save(meera, DOC_KEY, """
                        {"note":null,"followUpAt":"2026-09-01T09:00:00Z"}"""))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.note").doesNotExist())
                .andExpect(jsonPath("$.followUpAt").value("2026-09-01T09:00:00Z"));

        assertThat(leadNotes.findByOwnerId(meera.getId())).hasSize(1);
    }

    /**
     * The {@code updatedAt} an edit returns is the edit's own, not the one before it.
     *
     * <p>Reads as a triviality and is not. On the update branch the row is already managed, so
     * {@code JpaRepository.save} merges without flushing while {@code @UpdateTimestamp} fires at
     * flush — the response is assembled from the entity before the new value has been written to it,
     * and every edit after the first echoes the timestamp of the previous one. The column is correct
     * throughout, so nothing in the database looks wrong; only the field the panel renders as "last
     * touched" is a lie, and it is a plausible-looking one.
     *
     * <p>Both halves are asserted: that the response moved the timestamp forward, and that the edit
     * reached the column — read through {@code jdbc}, outside the persistence context, so an entity
     * that never flushed cannot satisfy it.
     *
     * <p><strong>The second half checks {@code note}, not {@code updated_at}, and that is the only
     * thing it can check.</strong> V1 installs a {@code BEFORE UPDATE} trigger on every table with
     * an {@code updated_at} which sets {@code now()} — the <em>transaction</em> start in Postgres,
     * not the statement's. This class is {@code @Transactional}, so both writes share one
     * transaction and the trigger stamps them with the identical, and earlier, value: the column
     * provably cannot move here, whatever the code does. Two consequences worth knowing before
     * writing another timestamp assertion anywhere in this codebase — the echoed {@code updatedAt}
     * is always slightly ahead of the stored one on an update, and no transactional test can observe
     * the stored one advancing. Neither is this table's doing.
     */
    @Test
    void editingANote_returnsTheTimestampOfThatEdit() throws Exception {
        User meera = owner("9000000209", "Meera Joshi");

        String first = mvc.perform(save(meera, DOC_KEY, """
                        {"note":"First pass","followUpAt":null}"""))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        Instant firstStamp = Instant.parse(JsonPath.read(first, "$.updatedAt"));

        Thread.sleep(10);
        String second = mvc.perform(save(meera, DOC_KEY, """
                        {"note":"Second pass","followUpAt":null}"""))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        Instant secondStamp = Instant.parse(JsonPath.read(second, "$.updatedAt"));

        assertThat(secondStamp)
                .as("the response must carry the timestamp of the edit that produced it")
                .isAfter(firstStamp);
        assertThat(jdbc.queryForObject(
                        "select note from lead_notes where owner_id = ? and lead_key = ?",
                        String.class, meera.getId(), DOC_KEY))
                .as("and the edit must have reached the column, read outside the persistence"
                        + " context so an unflushed entity cannot satisfy it")
                .isEqualTo("Second pass");
    }

    /**
     * A key longer than the bound is refused as a validation problem, and nothing is written.
     *
     * <p>The interesting number is not 200 but 2704 — the maximum size of a btree entry, past which
     * {@code uq_lead_notes_owner_lead} rejects the insert with an internal error rather than a
     * constraint failure. Without the bound this exact request is a {@code 500} raised from inside
     * Postgres, reachable by anyone holding a token. 3000 characters is chosen to sit beyond that
     * limit rather than merely beyond 200, so the test still means something if the bound is later
     * relaxed rather than removed.
     *
     * <p>422 rather than 400 is this API's answer for a well-formed request that fails validation
     * ({@code GlobalExceptionHandler#validationProblem}); 400 is reserved for a body it could not
     * parse. The field name is asserted because the status alone would be satisfied by
     * <em>any</em> validation failure — including one on the body, which would mean the key sailed
     * through unbounded.
     */
    @Test
    void anAbsurdlyLongKey_isRejected_andWritesNothing() throws Exception {
        User meera = owner("9000000210", "Meera Joshi");

        mvc.perform(save(meera, "x".repeat(3000), """
                        {"note":"payload","followUpAt":null}"""))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[0].field").value("leadKey"));

        assertThat(leadNotes.findByOwnerId(meera.getId())).isEmpty();
    }

    /**
     * An owner at the ceiling cannot annotate a new lead, but can still edit the ones they have.
     *
     * <p><strong>Both halves are the test.</strong> The refusal is what keeps
     * {@code findByOwnerId} safe to leave unpaged: without it a script minting a fresh key per
     * request grows the table indefinitely, and the read that then has to materialise every row is a
     * {@code GET}, which {@code WriteRateLimitFilter} does not count — so the writes are throttled
     * and the weapon is not. The second half is what stops the cap becoming its own bug: a ceiling
     * enforced on every write, rather than only on the insert branch, would strand an owner with a
     * desk full of notes they can no longer correct or clear.
     *
     * <p>The rows are minted in one SQL statement on purpose. Two thousand round trips through the
     * endpoint would prove nothing extra and would make this the slowest test in the suite; what is
     * under test is the branch in {@code upsert}, and it cannot tell how the rows arrived.
     */
    @Test
    void anOwnerAtTheCeiling_cannotAddALead_butCanStillEditOne() throws Exception {
        User meera = owner("9000000211", "Meera Joshi");
        jdbc.update("""
                insert into lead_notes (id, owner_id, lead_key, note, created_at, updated_at)
                select gen_random_uuid(), ?, 'bulk:' || g, 'seeded', now(), now()
                from generate_series(1, ?) g""",
                meera.getId(), LeadNoteService.MAX_NOTES_PER_OWNER);

        mvc.perform(save(meera, DOC_KEY, """
                        {"note":"one lead too many","followUpAt":null}"""))
                .andExpect(status().isBadRequest());
        assertThat(leadNotes.findByOwnerIdAndLeadKey(meera.getId(), DOC_KEY)).isEmpty();

        mvc.perform(save(meera, "bulk:1", """
                        {"note":"corrected","followUpAt":null}"""))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.note").value("corrected"));
    }

    /**
     * A follow-up date past either end of {@code timestamptz} is refused rather than handed to the
     * driver.
     *
     * <p>{@code Instant} parses years up to a billion in both directions; the column runs 4713 BC to
     * 294276 AD. Without the bound these bodies reach Postgres and fail there, which any token
     * holder can use to turn a validation problem into a {@code 500} — an error the client cannot
     * act on and the log cannot attribute.
     *
     * <p><strong>Both directions are asserted because a one-sided guard reads as though it closed
     * the hole.</strong> {@code isAfter} alone passes this test's first half and leaves the second
     * failing, which is precisely the state the constant's docblock would then be describing
     * incorrectly. The row assertion is the other half that matters: a service that rejected the
     * request after writing it would satisfy the status on its own.
     */
    @Test
    void aFollowUpDatePastEitherEndOfTime_isRefused() throws Exception {
        User meera = owner("9000000212", "Meera Joshi");

        mvc.perform(save(meera, DOC_KEY, """
                        {"note":"someday","followUpAt":"+1000000000-12-31T23:59:59Z"}"""))
                .andExpect(status().isBadRequest());

        mvc.perform(save(meera, DOC_KEY, """
                        {"note":"someday","followUpAt":"-1000000000-01-01T00:00:00Z"}"""))
                .andExpect(status().isBadRequest());

        assertThat(leadNotes.findByOwnerId(meera.getId())).isEmpty();
    }

    /**
     * A note longer than the bound is refused as a validation problem, naming {@code note}.
     *
     * <p>V119 declares {@code lead_notes_note_length} with the same number as
     * {@code LeadNoteUpsert}'s {@code @Size}, and argues the two must move together. Nothing else
     * holds them together: widen the DTO alone and the CHECK starts answering instead, turning a
     * {@code 422} that names the field into a {@code 409} about "existing data". <strong>This test
     * is the only thing that pins the two numbers to each other</strong>, which is why it asserts
     * the field name rather than just the status — the status alone would also be produced by the
     * key bound, or by any other constraint on the request.
     */
    @Test
    void anOverlongNote_isRejected_andWritesNothing() throws Exception {
        User meera = owner("9000000213", "Meera Joshi");

        mvc.perform(save(meera, DOC_KEY,
                        "{\"note\":\"" + "x".repeat(2001) + "\",\"followUpAt\":null}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[0].field").value("note"));

        assertThat(leadNotes.findByOwnerId(meera.getId())).isEmpty();
    }

    // ---------------- clearing ----------------

    /**
     * Clearing an annotation deletes the row rather than blanking it, and answers {@code 204}.
     *
     * <p>The write-then-clear ordering is the positive anchor: without the first half this would pass
     * against an endpoint that never stored anything at all. The {@code hasSize(1)} in between is
     * what makes the {@code isEmpty()} afterwards mean "the delete ran" rather than "nothing was ever
     * there".
     *
     * <p>A blank string is included alongside the null because the UI sends {@code ""} when the owner
     * empties the textarea. Folded to null on the way in, it takes this same path; left alone it
     * would satisfy the V119 CHECK as a non-null value and leave a row whose note renders as nothing
     * while the follow-up chip insists there is one.
     */
    @Test
    void clearingAnAnnotation_removesTheRow() throws Exception {
        User meera = owner("9000000203", "Meera Joshi");
        mvc.perform(save(meera, DOC_KEY, """
                {"note":"Wants a site visit","followUpAt":null}"""));
        assertThat(leadNotes.findByOwnerId(meera.getId())).hasSize(1);

        mvc.perform(save(meera, DOC_KEY, """
                        {"note":"   ","followUpAt":null}"""))
                .andExpect(status().isNoContent());

        assertThat(leadNotes.findByOwnerId(meera.getId())).isEmpty();
        mvc.perform(list(meera)).andExpect(jsonPath("$.length()").value(0));
    }

    /**
     * Clearing an annotation that was never written is a {@code 204}, not a {@code 404} or a 500.
     *
     * <p>Reachable in one click: the owner opens a lead, types into the note, deletes what they
     * typed, and closes the sheet. Nothing was ever stored, and the correct answer to "make sure
     * there is no note here" is that there is no note here.
     */
    @Test
    void clearingSomethingThatWasNeverThere_is204() throws Exception {
        User meera = owner("9000000204", "Meera Joshi");

        mvc.perform(save(meera, DOC_KEY, """
                        {"note":null,"followUpAt":null}"""))
                .andExpect(status().isNoContent());

        assertThat(leadNotes.findByOwnerId(meera.getId())).isEmpty();
    }

    // ---------------- owner isolation ----------------

    /**
     * Two owners annotating <strong>the same lead key</strong> get two independent notes, and neither
     * can see the other's.
     *
     * <p>This is the adversarial case the whole domain rests on, and the shared key is the point. A
     * unique index on {@code lead_key} alone, or a lookup that forgot {@code ownerId}, would collide
     * here and nowhere else — Rohan's write would either be rejected as a duplicate or would
     * overwrite Meera's private note with his own. Both failures are silent to Rohan; Meera's note
     * simply changes under her.
     *
     * <p>Each read asserts the full list, not just containment: {@code length()==1} plus the expected
     * text is what makes this a leak test. A containment-only assertion would pass against an
     * endpoint that returned every note in the table.
     */
    @Test
    void twoOwnersAnnotatingTheSameKey_cannotSeeEachOther() throws Exception {
        User meera = owner("9000000205", "Meera Joshi");
        User rohan = owner("9000000206", "Rohan Kulkarni");

        mvc.perform(save(meera, DOC_KEY, """
                        {"note":"Meera private","followUpAt":null}"""))
                .andExpect(status().isOk());
        mvc.perform(save(rohan, DOC_KEY, """
                        {"note":"Rohan private","followUpAt":null}"""))
                .andExpect(status().isOk());

        mvc.perform(list(meera))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].note").value("Meera private"));
        mvc.perform(list(rohan))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].note").value("Rohan private"));
    }

    /**
     * One owner clearing a key cannot clear another owner's annotation on the same key.
     *
     * <p>Separate from the read test above because the delete is a different query and could be
     * owner-blind on its own — and this is the failure that destroys data rather than merely
     * exposing it. Meera's surviving note is the assertion; Rohan's {@code 204} is only the setup.
     */
    @Test
    void clearingIsOwnerScoped() throws Exception {
        User meera = owner("9000000207", "Meera Joshi");
        User rohan = owner("9000000208", "Rohan Kulkarni");
        mvc.perform(save(meera, DOC_KEY, """
                {"note":"Meera private","followUpAt":null}"""));

        mvc.perform(save(rohan, DOC_KEY, """
                        {"note":null,"followUpAt":null}"""))
                .andExpect(status().isNoContent());

        mvc.perform(list(meera))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].note").value("Meera private"));
    }

    /** No token, no notes — the endpoint has no anonymous mode to fall back to. */
    @Test
    void anonymous_cannotReadOrWriteNotes() throws Exception {
        mvc.perform(get(Routes.MeLeadNotes.BASE)).andExpect(status().isUnauthorized());
        mvc.perform(put(noteUrl(DOC_KEY))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"note":"anon","followUpAt":null}"""))
                .andExpect(status().isUnauthorized());

        assertThat(jdbc.queryForObject("select count(*) from lead_notes", Long.class)).isZero();
    }
}
