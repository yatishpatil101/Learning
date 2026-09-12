package com.draazy.api.moderation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * D29 — {@code /admin/notes}: what the team knows about a case, kept where the team can read it.
 *
 * <p>Four moderation actions used to write a note into the browser's own {@code localStorage} in the
 * same handler that made a real API call. The decision landed on the server; the reasoning stayed
 * on one laptop, and a colleague opening the same listing the next morning saw an outcome with no
 * explanation. Nothing looked broken — a note that was never stored and a case nobody annotated
 * render identically.
 *
 * <p>The assertions that carry weight are the ones the old store could not have satisfied: that a
 * note written by one member of staff is readable by another (the whole point), that it is
 * <em>editable</em> and that the edit is audited with the previous wording, that the author is
 * taken from the token rather than the body, and that the four entity kinds are a closed
 * vocabulary — an unknown one must be refused rather than answered with an empty list, because an
 * empty list is what a clean record looks like.
 */
@DisplayName("Internal notes — what the team knows about a case")
class InternalNoteTest extends AbstractApiTest {

    private static final String ANY_LISTING = "22222222-2222-2222-2222-222222222222";

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;

    private User staff(String mobile, String name) {
        User u = new User(mobile, "staff");
        u.setName(name);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private String notesOn(String entityType, String entityId) {
        return "/admin/notes/" + entityType + "/" + entityId;
    }

    private MvcResult add(User author, String entityType, String entityId, String json)
            throws Exception {
        return mvc.perform(post(notesOn(entityType, entityId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json))
                .andExpect(status().isCreated())
                .andReturn();
    }

    private static String idOf(MvcResult result) throws Exception {
        return com.jayway.jsonpath.JsonPath.read(result.getResponse().getContentAsString(), "$.id");
    }

    /**
     * Backdate a note.
     *
     * <p>Two notes written in the same test land in the same millisecond often enough that an
     * ordering assertion on {@code now()} passes by luck. Backdating one makes the assertion about
     * the ordering rather than about the clock.
     */
    private void writtenAgo(String noteId, int minutes) {
        jdbc.update("update internal_notes set created_at = ? where id = cast(? as uuid)",
                Timestamp.from(Instant.now().minus(minutes, ChronoUnit.MINUTES)), noteId);
    }

    @Test
    @DisplayName("an entity nobody has annotated answers an empty list, not a 404")
    void emptyByDefault() throws Exception {
        User s = staff("9822100001", "Asha");
        mvc.perform(get(notesOn("property", ANY_LISTING))
                        .header(HttpHeaders.AUTHORIZATION, bearer(s)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    @DisplayName("a note one colleague writes is readable by another — the whole point")
    void interTransparent() throws Exception {
        User author = staff("9822100002", "Asha");
        User colleague = staff("9822100003", "Rohan");
        add(author, "property", ANY_LISTING,
                "{\"text\":\"Owner says the photos are from the show flat.\",\"action\":\"Flagged\"}");

        mvc.perform(get(notesOn("property", ANY_LISTING))
                        .header(HttpHeaders.AUTHORIZATION, bearer(colleague)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].text")
                        .value("Owner says the photos are from the show flat."))
                .andExpect(jsonPath("$[0].action").value("Flagged"))
                .andExpect(jsonPath("$[0].authorName").value("Asha"));
    }

    @Test
    @DisplayName("the author is taken from the token, not from the body")
    void authorComesFromThePrincipal() throws Exception {
        User author = staff("9822100004", "Asha");
        User other = staff("9822100005", "Rohan");
        // A body naming somebody else. The field does not exist on the contract; the point is that
        // sending it anyway changes nothing.
        add(author, "property", ANY_LISTING,
                "{\"text\":\"Chased twice.\",\"authorId\":\"" + other.getId() + "\"}");

        mvc.perform(get(notesOn("property", ANY_LISTING))
                        .header(HttpHeaders.AUTHORIZATION, bearer(author)))
                .andExpect(jsonPath("$[0].authorId").value(author.getId().toString()))
                .andExpect(jsonPath("$[0].authorName").value("Asha"));
    }

    @Test
    @DisplayName("newest first — a note written ten seconds ago is not buried")
    void newestFirst() throws Exception {
        User s = staff("9822100006", "Asha");
        String older = idOf(add(s, "property", ANY_LISTING, "{\"text\":\"First look.\"}"));
        writtenAgo(older, 90);
        add(s, "property", ANY_LISTING, "{\"text\":\"Owner replied.\"}");

        mvc.perform(get(notesOn("property", ANY_LISTING))
                        .header(HttpHeaders.AUTHORIZATION, bearer(s)))
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].text").value("Owner replied."))
                .andExpect(jsonPath("$[1].text").value("First look."));
    }

    @Test
    @DisplayName("any member of staff can correct any note, not only its author")
    void anyoneMayEdit() throws Exception {
        User author = staff("9822100007", "Asha");
        User colleague = staff("9822100008", "Rohan");
        String id = idOf(add(author, "property", ANY_LISTING, "{\"text\":\"Owner is in Dubai.\"}"));

        mvc.perform(patch("/admin/notes/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(colleague))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"Owner is in Dubai until March. Confirmed.\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.text").value("Owner is in Dubai until March. Confirmed."))
                // The author does not change hands because somebody else corrected the wording.
                .andExpect(jsonPath("$.authorId").value(author.getId().toString()));
    }

    /**
     * The reason an edit is audited and an add is not.
     *
     * <p>After an edit, this row is the only copy of the new text and nothing holds the old. The
     * audit entry is where the previous wording survives — without it, "mutable" would mean
     * "quietly rewritable".
     */
    @Test
    @DisplayName("an edit records the previous wording in the audit log")
    void editIsAudited() throws Exception {
        User s = staff("9822100009", "Asha");
        String id = idOf(add(s, "property", ANY_LISTING, "{\"text\":\"Looks fine.\"}"));

        mvc.perform(patch("/admin/notes/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(s))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"Does not look fine on a second read.\"}"))
                .andExpect(status().isOk());

        String metadata = jdbc.queryForObject(
                "select cast(metadata as text) from audit_log "
                        + "where action = 'note.edit' and entity_id = ?",
                String.class, id);
        assertThat(metadata).as("the audit entry carries the wording that is now gone")
                .contains("Looks fine.");
    }

    @Test
    @DisplayName("the action label a note was filed beside is not editable")
    void actionIsNotEditable() throws Exception {
        User s = staff("9822100010", "Asha");
        String id = idOf(add(s, "property", ANY_LISTING,
                "{\"text\":\"Photos re-shot.\",\"action\":\"Approved\"}"));

        mvc.perform(patch("/admin/notes/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(s))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"Photos re-shot and verified.\",\"action\":\"Rejected\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.action").value("Approved"));
    }

    @Test
    @DisplayName("a note is scoped to the entity it was written about")
    void scopedToItsEntity() throws Exception {
        User s = staff("9822100011", "Asha");
        add(s, "property", ANY_LISTING, "{\"text\":\"About the listing.\"}");
        add(s, "user", ANY_LISTING, "{\"text\":\"About the person.\"}");

        mvc.perform(get(notesOn("property", ANY_LISTING))
                        .header(HttpHeaders.AUTHORIZATION, bearer(s)))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].text").value("About the listing."));
        mvc.perform(get(notesOn("user", ANY_LISTING))
                        .header(HttpHeaders.AUTHORIZATION, bearer(s)))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].text").value("About the person."));
    }

    /**
     * The four kinds are a closed list, and an unknown one is refused rather than answered.
     *
     * <p>An empty list is exactly what a clean record looks like, so a client typo that fell through
     * to a read would report "no notes on this" about an entity that has a dozen.
     */
    @Test
    @DisplayName("an unknown entity kind is refused, not answered with an empty list")
    void unknownKindIsRefused() throws Exception {
        User s = staff("9822100012", "Asha");
        mvc.perform(get(notesOn("listing", ANY_LISTING))
                        .header(HttpHeaders.AUTHORIZATION, bearer(s)))
                .andExpect(status().isBadRequest());
        mvc.perform(post(notesOn("listing", ANY_LISTING))
                        .header(HttpHeaders.AUTHORIZATION, bearer(s))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"The client's word for it.\"}"))
                .andExpect(status().isBadRequest());
    }

    /**
     * The browser store this replaces saved a note with no text so long as it had an action label,
     * which wrote a row that rendered as an empty bullet under a colleague's name.
     */
    @Test
    @DisplayName("a note with an action label and nothing to say is refused")
    void blankTextIsRefused() throws Exception {
        User s = staff("9822100013", "Asha");
        mvc.perform(post(notesOn("property", ANY_LISTING))
                        .header(HttpHeaders.AUTHORIZATION, bearer(s))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"   \",\"action\":\"Approved\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    @DisplayName("editing a note that does not exist is a 404, even for a malformed id")
    void missingNoteIs404() throws Exception {
        User s = staff("9822100014", "Asha");
        for (String id : new String[] {"33333333-3333-3333-3333-333333333333", "not-a-uuid"}) {
            mvc.perform(patch("/admin/notes/" + id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(s))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"text\":\"Correcting a ghost.\"}"))
                    .andExpect(status().isNotFound());
        }
    }

    @Test
    @DisplayName("an ordinary signed-in user cannot read what staff wrote about them")
    void buyerIsRefused() throws Exception {
        User s = staff("9822100015", "Asha");
        add(s, "user", ANY_LISTING, "{\"text\":\"Second complaint this month.\"}");

        User buyer = new User("9822100016", "buyer");
        buyer.setName("Subject");
        buyer.setMobileVerified(true);
        users.saveAndFlush(buyer);

        mvc.perform(get(notesOn("user", ANY_LISTING))
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isForbidden());
    }
}
