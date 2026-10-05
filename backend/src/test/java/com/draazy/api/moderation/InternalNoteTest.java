package com.draazy.api.moderation;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

// Notes must be shared across staff, audited on edit, token-authored,
// and limited to known entity kinds so unknown cases do not look clean.
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

    // Same-test notes often share a millisecond, so ordering on `now()` is flaky.
    // Backdating one makes the assertion about the ordering rather than about the clock.
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
    @DisplayName("a service-request note stays on the request's desk (D44)")
    void serviceRequestNotesAreDeskScoped() throws Exception {
        User requester = users.saveAndFlush(new User("9822100090", "buyer"));
        UUID requestId = UUID.randomUUID();
        jdbc.update("""
                insert into service_requests (id, requester_id, type, team, status)
                values (?, ?, 'rent-agreement', 'rental', 'new')
                """, requestId, requester.getId());
        User rental = staff("9822100091", "Rental desk");
        rental.setTeam("rental");
        users.saveAndFlush(rental);
        User rentalColleague = staff("9822100092", "Rental colleague");
        rentalColleague.setTeam("rental");
        users.saveAndFlush(rentalColleague);
        User legal = staff("9822100093", "Legal desk");
        legal.setTeam("legal");
        users.saveAndFlush(legal);

        add(rental, "service_request", requestId.toString(),
                "{\"text\":\"Owner asked for a Marathi copy.\"}");

        mvc.perform(get(notesOn("service_request", requestId.toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(rentalColleague)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
        mvc.perform(get(notesOn("service_request", requestId.toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(legal)))
                .andExpect(status().isForbidden());
        mvc.perform(post(notesOn("service_request", requestId.toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(legal))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"Not my desk.\"}"))
                .andExpect(status().isForbidden());
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

    // After an edit, this row is the only copy of the new text and nothing holds the old.
    // The audit entry is where the previous wording survives — without it, "mutable" would mean "quietly rewritable".
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
}
