package com.punenest.api.services;

import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.security.Teams;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * The quoted price a customer accepted, kept apart from the deal value ops book (D3).
 *
 * <p><strong>Why a second money column at all.</strong> {@code TicketCreate} refuses to let a client
 * set {@code value}, on the stated grounds that a client writing its own deal value is a client
 * writing the pipeline report. That is right, and for a while it was read as a rule about money in
 * general — which left the Move-in Pack booking with nowhere to put a total the customer had
 * assembled line by line and accepted. So the booking was dropped: in live mode it showed a success
 * toast for a lead that reached nobody.
 *
 * <p>These are two facts, not one. The quote is what was agreed before ops saw the job; the value is
 * what the desk expects to bill after. When they disagree — the pack was priced for a 2 BHK and the
 * flat turned out to be a 4 BHK — that disagreement is the point, and a single column can only
 * record it by destroying the number that made it visible. So the tests below are mostly about the
 * two staying <em>separate</em> rather than about either one's value.
 *
 * <p><strong>Mutation checks, actually run.</strong> Dropping {@code @PositiveOrZero} from
 * {@code TicketCreate} fails {@link #zeroIsAQuoteAndMinusOneIsNot} and nothing else — worth noting
 * because the database CHECK does not cover for it: the constraint would turn a negative quote into
 * a 500, so the column-level guard protects the data but not the answer. Blanking {@code quotedValue}
 * out of {@code TicketDto} fails {@link #theQuoteSurvivesUnrelatedWork} and
 * {@link #aQuoteCannotBeEditedAfterTheFact} — the two that read the <em>staff</em> view — while the
 * three reading the 201 response pass, which is the reminder that a client and the board are served
 * by different mappers and a field can go missing from one of them alone.
 *
 * <p><strong>What this suite found on the way.</strong> {@code tickets.value} has no write path at
 * all — {@code TicketCreate} drops it by design, {@code TicketUpdate} simply has no such component,
 * and the seed never sets it. The column has been declared since V7 and filled by nothing. That is
 * why the coexistence test below asserts a weaker claim than it was written to.
 */
@DisplayName("Slice 11 — a quote is not a deal value")
class TicketQuotedValueTest extends ServiceFixtures {

    /** ₹18,499 — the Move-in Pack's six items less the 12% bundle discount, near enough. */
    private static final long QUOTE = 18_499L;

    @Test
    @DisplayName("the customer's accepted price is stored and echoed back to them")
    void theQuoteSurvivesTheBooking() throws Exception {
        User buyer = customer("9820000401");

        mvc.perform(post(Routes.Tickets.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subject\":\"Move-in Pack booking\",\"team\":\"packers\","
                                + "\"quotedValue\":" + QUOTE + "}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.quotedValue").value(QUOTE))
                // The other half of the same claim: accepting a quote from the client did not also
                // hand it the pipeline number. These fail together if somebody "simplifies" the two
                // columns into one, which is exactly the change worth failing on.
                .andExpect(jsonPath("$.value").value(nullValue()));
    }

    @Test
    @DisplayName("a client still cannot set the deal value, quote or no quote")
    void theDealValueIsStillOpsOwned() throws Exception {
        User buyer = customer("9820000402");

        // Both fields in one body, because the interesting failure is a mapper that starts reading
        // `value` off the request the moment a sibling money field becomes legal to send.
        mvc.perform(post(Routes.Tickets.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subject\":\"Move-in Pack booking\",\"team\":\"packers\","
                                + "\"quotedValue\":" + QUOTE + ",\"value\":99900000}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.value").value(nullValue()))
                .andExpect(jsonPath("$.quotedValue").value(QUOTE));
    }

    @Test
    @DisplayName("the quote survives a PATCH that changes something else")
    void theQuoteSurvivesUnrelatedWork() throws Exception {
        User buyer = customer("9820000403");
        User desk = staff("9820000404", Teams.PACKERS);
        String id = raise(buyer, "{\"subject\":\"Move-in Pack booking\",\"team\":\"packers\","
                + "\"quotedValue\":" + QUOTE + "}");

        // This test was first written to have ops set `value` and then assert the quote was
        // untouched, and it failed with `value` still null -- because `TicketUpdate` has no `value`
        // component. Nothing can write tickets.value: not a client (TicketCreate drops it), not the
        // desk (the PATCH schema has no such field), not the seed. It is a column V7 declared and
        // no code has ever filled, which is worth knowing before reading the entity's talk of what
        // "ops-owned" means -- that ownership is aspirational, not implemented. Recorded in
        // tasks/todo.md rather than fixed here, because giving ops a way to set a deal value is a
        // product decision about the pipeline report, not a side effect of adding a quote.
        //
        // So what is actually assertable is the weaker but still load-bearing claim: working the
        // ticket does not disturb what the customer agreed to.
        mvc.perform(patch(Routes.Tickets.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"in-progress\",\"priority\":\"high\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("in-progress"))
                .andExpect(jsonPath("$.quotedValue").value(QUOTE));
    }

    @Test
    @DisplayName("a quote cannot be edited after the fact")
    void aQuoteCannotBeEditedAfterTheFact() throws Exception {
        User buyer = customer("9820000405");
        User desk = staff("9820000406", Teams.PACKERS);
        String id = raise(buyer, "{\"subject\":\"Move-in Pack booking\",\"team\":\"packers\","
                + "\"quotedValue\":" + QUOTE + "}");

        // An unknown field is ignored rather than refused, so this PATCH succeeds; what must not
        // happen is the number moving. Asserted on a fresh GET rather than the PATCH response,
        // because a response rendered from the entity Hibernate is still holding would agree with
        // an in-memory write that never reached a column.
        mvc.perform(patch(Routes.Tickets.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"quotedValue\":1}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Tickets.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].quotedValue").value(QUOTE));
    }

    @Test
    @DisplayName("a negative quote is refused, and zero is not")
    void zeroIsAQuoteAndMinusOneIsNot() throws Exception {
        User buyer = customer("9820000409");

        // 422, not 400: this codebase's GlobalExceptionHandler maps a bean-validation failure to
        // UNPROCESSABLE_ENTITY with a ValidationProblem body. A well-formed request that asks for
        // something impossible is not a malformed request.
        mvc.perform(post(Routes.Tickets.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subject\":\"Free survey\",\"team\":\"packers\","
                                + "\"quotedValue\":-1}"))
                .andExpect(status().isUnprocessableEntity());

        // Both directions, and zero is the one that matters: "quoted, free of charge" is a real
        // offer the packers desk makes, and it is a different fact from "nobody quoted anything",
        // which is what an absent quote means. A guard written as a truthiness check passes the
        // first half of this test and fails here.
        mvc.perform(post(Routes.Tickets.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subject\":\"Free survey\",\"team\":\"packers\","
                                + "\"quotedValue\":0}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.quotedValue").value(0));
    }

    @Test
    @DisplayName("a ticket raised without a quote has none, rather than zero")
    void noQuoteIsNotAZeroQuote() throws Exception {
        User buyer = customer("9820000408");

        mvc.perform(post(Routes.Tickets.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subject\":\"Need a rent agreement\",\"team\":\"legal\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.quotedValue").value(nullValue()));
    }

    private String raise(User caller, String body) throws Exception {
        String json = mvc.perform(post(Routes.Tickets.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return field(json, "id");
    }
}
