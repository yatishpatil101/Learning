package com.punenest.api.services.ticket;

import com.punenest.api.support.AbstractApiTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import com.punenest.api.security.Teams;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * {@code POST /service-waitlist} — the public "tell me when this launches" form (D4).
 *
 * <p><strong>What this endpoint replaces is the reason the tests look the way they do.</strong> The
 * Move-in Pack's coming-soon panel used to write its lead to browser localStorage and then show the
 * customer a success message, so the failure mode was not an error anybody saw — it was a person who
 * believed they were on a list that did not exist. The assertions therefore keep coming back to one
 * question: <em>can ops actually reach this person?</em> {@link #theLeadIsVisibleToTheDeskThatOwnsIt}
 * is the test that would have failed against the old behaviour, and it deliberately reads the row
 * back through the ops board's own endpoint rather than through the repository, because the
 * repository would have been just as happy to prove the existence of a row no screen shows.
 *
 * <p><strong>The rest is about what a stranger controls.</strong> This is the platform's third
 * unauthenticated body-write and the first one that reaches a queue humans work from, so the tests
 * pin the negative: the team cannot be chosen, the subject cannot be composed, the priority cannot
 * be raised, and no free text reaches the board. Those are assertions about the <em>absence</em> of
 * capability, which pass for free if the endpoint is simply broken — so each is paired with a
 * positive anchor proving the row was created at all.
 */
class ServiceWaitlistTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired TicketRepository tickets;

    /** Fixed by {@link ServiceWaitlists}, never sent — asserted, not recomputed from the source. */
    private static final String SUBJECT = "Move-in Pack \u2014 waitlist";

    private static String body(String service, String name, String mobile) {
        return "{\"service\":\"" + service + "\",\"name\":\"" + name + "\",\"mobile\":\""
                + mobile + "\"}";
    }

    private void join(String mobile) throws Exception {
        joinWith(body(ServiceWaitlists.MOVE_IN_PACK, "Aarti Kale", mobile));
    }

    private void joinWith(String json) throws Exception {
        mvc.perform(post(Routes.ServiceWaitlist.BASE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json))
                .andExpect(status().isCreated());
    }

    private List<Ticket> rowsFor(String mobile) {
        return tickets.findAll().stream().filter(t -> mobile.equals(t.getMobile())).toList();
    }

    private String bearer(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Waitlist " + mobile.substring(6));
        u.setMobileVerified(true);
        return "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(u));
    }

    // ---- the front door ----

    /**
     * The whole point: no account, no session, no sign-in redirect. Every field the desk will act on
     * is checked, because "a row was written" was true of the localStorage version too.
     */
    @Test
    void aStrangerMayJoinWithoutSigningIn() throws Exception {
        String mobile = "9812400001";
        join(mobile);

        List<Ticket> rows = rowsFor(mobile);
        assertThat(rows).hasSize(1);
        Ticket t = rows.get(0);
        assertThat(t.getTeam()).isEqualTo(Teams.PACKERS);
        assertThat(t.getSubject()).isEqualTo(SUBJECT);
        assertThat(t.getStatus()).isEqualTo(TicketStatuses.OPEN);
        assertThat(t.getPriority()).isEqualTo(TicketPriorities.MEDIUM);
        assertThat(t.getCustomer()).isEqualTo("Aarti Kale");
        assertThat(t.getMobile()).isEqualTo(mobile);
    }

    /**
     * The row has no requester, and that is the honest answer rather than a gap.
     *
     * <p>Nothing on this path proves the number belongs to the person who typed it, so the entity
     * must not claim otherwise — see {@code Ticket}'s Javadoc, which this change had to correct. The
     * second half is the one that matters: a pre-existing account holding that same number is
     * <em>not</em> matched to the row, because doing so would attach a stranger's request to a real
     * person's profile on nothing but a typed-in number.
     */
    @Test
    void theRowNamesNobodyBecauseNobodyProvedWhoTheyWere() throws Exception {
        String mobile = "9812400002";
        bearer(mobile, Roles.Wire.BUYER);

        join(mobile);

        assertThat(rowsFor(mobile)).singleElement()
                .satisfies(t -> assertThat(t.getRequesterId()).isNull());
    }

    /** No name is a normal answer to an optional field; the board still gets something to show. */
    @Test
    void aMissingNameBecomesAPlaceholderRatherThanABlankRow() throws Exception {
        String mobile = "9812400003";
        joinWith("{\"service\":\"" + ServiceWaitlists.MOVE_IN_PACK + "\",\"mobile\":\"" + mobile + "\"}");

        assertThat(rowsFor(mobile)).singleElement()
                .satisfies(t -> assertThat(t.getCustomer()).isEqualTo("Waitlist lead"));
    }

    // ---- what a stranger does not control ----

    /**
     * The team, subject, priority and value are server-side facts, and sending them changes nothing.
     *
     * <p>A caller who could name the team could put a lead on the legal or loans desk — that is not
     * a lead, it is a way to page whoever is on duty. Unknown JSON properties are ignored rather
     * than refused (Boot's default), so the proof has to be the stored row, not the status code.
     */
    @Test
    void theCallerCannotChooseTheDeskTheSubjectOrThePriority() throws Exception {
        String mobile = "9812400004";
        joinWith("{\"service\":\"" + ServiceWaitlists.MOVE_IN_PACK + "\",\"name\":\"Injector\","
                + "\"mobile\":\"" + mobile + "\",\"team\":\"legal\",\"priority\":\"urgent\","
                + "\"subject\":\"URGENT: call me\",\"quotedValue\":900000,\"status\":\"resolved\","
                + "\"detail\":\"click here\"}");

        assertThat(rowsFor(mobile)).singleElement().satisfies(t -> {
            assertThat(t.getTeam()).isEqualTo(Teams.PACKERS);
            assertThat(t.getSubject()).isEqualTo(SUBJECT);
            assertThat(t.getPriority()).isEqualTo(TicketPriorities.MEDIUM);
            assertThat(t.getStatus()).isEqualTo(TicketStatuses.OPEN);
            assertThat(t.getQuotedValue()).isNull();
            assertThat(t.getDetail()).isNull();
        });
    }

    /** A service nobody offers is a 400 naming the value, not a ticket on no desk. */
    @Test
    void anUnknownServiceIsRefused() throws Exception {
        mvc.perform(post(Routes.ServiceWaitlist.BASE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("free-money", "Nobody", "9812400005")))
                .andExpect(status().isBadRequest());

        assertThat(rowsFor("9812400005")).isEmpty();
    }

    /** A number ops cannot ring is not a lead. 422 — this codebase's shape for bean validation. */
    @Test
    void aMalformedMobileIsRefused() throws Exception {
        mvc.perform(post(Routes.ServiceWaitlist.BASE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(ServiceWaitlists.MOVE_IN_PACK, "Nobody", "12345")))
                .andExpect(status().isUnprocessableEntity());
    }

    // ---- asking twice ----

    /**
     * Two taps on one button is one lead. 201 both times: the caller's intent is "make sure you have
     * me", and after either outcome the desk does — and a 409 would tell a stranger whether a given
     * number was already on the list.
     */
    @Test
    void askingTwiceLeavesOneRowOnTheBoard() throws Exception {
        String mobile = "9812400006";
        join(mobile);
        join(mobile);

        assertThat(rowsFor(mobile)).hasSize(1);
    }

    /**
     * Once the desk has dealt with somebody, asking again is a new lead rather than a duplicate.
     *
     * <p>This is the assertion that fixes where the line falls. Suppressing on <em>any</em> previous
     * row would mean a person who signed up, was called, and came back months later would silently
     * reach nobody — the original bug wearing a different hat.
     */
    @Test
    void aSignupTheDeskHasClosedDoesNotSilenceTheNextOne() throws Exception {
        String mobile = "9812400007";
        join(mobile);
        // Closed through the repository rather than with jdbc.update. These tests share one
        // transaction with the request, and the insert is still pending in the persistence context
        // when the request returns — raw SQL would update nothing, then the pending row would flush
        // as `open` and the test would prove the opposite of what it says. The read below forces
        // the flush first.
        Ticket first = rowsFor(mobile).get(0);
        first.setStatus(TicketStatuses.CLOSED);
        tickets.flush();

        join(mobile);

        assertThat(rowsFor(mobile)).hasSize(2);
    }

    // ---- the budget ----

    /**
     * The per-mobile cap counts every ticket from that number, not only waitlist ones.
     *
     * <p>Reached here through the authenticated {@code POST /tickets}, which is the point: what the
     * budget protects is the ops board, and the board does not care which form filled it. Counting
     * only waitlist rows would let a caller alternate between entrances and clear a ceiling they
     * share — and, today, the duplicate check above would make the waitlist-only count unreachable
     * anyway, so the limit would be untested code that looked tested.
     *
     * <p>{@code Retry-After} is asserted because a 429 with no answer to "when, then?" leaves a
     * client with nothing to do but retry immediately.
     */
    @Test
    void theBudgetCountsEveryTicketThatNumberHasRaised() throws Exception {
        String mobile = "9812400008";
        String token = bearer(mobile, Roles.Wire.BUYER);
        for (int i = 1; i <= 3; i++) {
            mvc.perform(post(Routes.Tickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"subject\":\"Existing " + i + "\",\"team\":\"rental\"}"))
                    .andExpect(status().isCreated());
        }

        mvc.perform(post(Routes.ServiceWaitlist.BASE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(ServiceWaitlists.MOVE_IN_PACK, "Noisy", mobile)))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(jsonPath("$.error").value("rate_limited"));
    }

    /** One noisy number cannot close the form for everybody else. */
    @Test
    void theBudgetIsPerNumber() throws Exception {
        String noisy = "9812400009";
        String token = bearer(noisy, Roles.Wire.BUYER);
        for (int i = 1; i <= 3; i++) {
            mvc.perform(post(Routes.Tickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"subject\":\"Noise " + i + "\"}"))
                    .andExpect(status().isCreated());
        }

        join("9812400010");

        assertThat(rowsFor("9812400010")).hasSize(1);
    }

    // ---- and the reason all of the above exists ----

    /**
     * The lead reaches a screen a person looks at.
     *
     * <p>Read back through {@code GET /tickets} with a packers staff token, not through the
     * repository: the failure this endpoint exists to fix was a lead that was stored somewhere
     * nobody reads, and a repository assertion cannot tell those two situations apart.
     */
    @Test
    void theLeadIsVisibleToTheDeskThatOwnsIt() throws Exception {
        String mobile = "9812400011";
        join(mobile);

        User staff = new User("9877730050", Roles.Wire.STAFF);
        staff.setName("Packers Desk");
        staff.setMobileVerified(true);
        staff.setTeam(Teams.PACKERS);

        mvc.perform(get(Routes.Tickets.BASE)
                        .header(HttpHeaders.AUTHORIZATION,
                                "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(staff))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.mobile == '" + mobile + "')].subject")
                        .value(SUBJECT))
                .andExpect(jsonPath("$.content[?(@.mobile == '" + mobile + "')].team")
                        .value(Teams.PACKERS));
    }

    /** There is no public read: the rows are a pile of unverified phone numbers. */
    @Test
    void theWaitlistCannotBeReadBack() throws Exception {
        mvc.perform(get(Routes.ServiceWaitlist.BASE))
                .andExpect(status().is4xxClientError());
    }
}
