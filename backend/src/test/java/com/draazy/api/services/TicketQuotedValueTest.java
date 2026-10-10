package com.draazy.api.services;

import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.security.Teams;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/** The quote a customer accepted is kept apart from the deal value ops book: when they disagree (a 2 BHK quote,
 * a 4 BHK flat) a single column could only record it by destroying the number that made it visible. */
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
                // Accepting a quote must not also hand the client the pipeline number;
                // fails if someone merges the two columns.
                .andExpect(jsonPath("$.value").value(nullValue()));
    }

    @Test
    @DisplayName("a client still cannot set the deal value, quote or no quote")
    void theDealValueIsNotTheClientsToSet() throws Exception {
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

        // tickets.value has no write path (TicketCreate drops it, TicketUpdate has no such component), so the
        // assertable claim is that working the ticket does not disturb the customer's quote.
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

        // An unknown field is ignored, so the PATCH succeeds; asserted on a fresh GET because a PATCH response
        // rendered from an entity Hibernate still holds would agree with a write that never reached a column.
        mvc.perform(patch(Routes.Tickets.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"quotedValue\":1}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Tickets.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.quotedValue").value(QUOTE));
    }

    @Test
    @DisplayName("a negative quote is refused, and zero is not")
    void zeroIsAQuoteAndMinusOneIsNot() throws Exception {
        User buyer = customer("9820000409");

        // 422, not 400: GlobalExceptionHandler maps a bean-validation failure to UNPROCESSABLE_ENTITY
        // with a ValidationProblem body.
        mvc.perform(post(Routes.Tickets.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subject\":\"Free survey\",\"team\":\"packers\","
                                + "\"quotedValue\":-1}"))
                .andExpect(status().isUnprocessableEntity());

        // Zero matters: "quoted, free of charge" is a real offer, unlike "nobody quoted" (the absent case);
        // a truthiness check passes the first half of this test and fails here.
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
