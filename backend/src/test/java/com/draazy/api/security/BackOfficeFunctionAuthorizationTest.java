package com.draazy.api.security;

import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.services.ticket.Ticket;
import com.draazy.api.services.ticket.TicketRepository;
import com.draazy.api.support.AbstractApiTest;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

@DisplayName("back-office functions authorize atoms and desks")
class BackOfficeFunctionAuthorizationTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @Autowired
    TicketRepository tickets;

    private User staff(String mobile, String functionsJson) {
        User user = new User(mobile, Roles.Wire.STAFF);
        user.setName("Function probe " + mobile);
        user.setMobileVerified(true);
        User saved = users.saveAndFlush(user);
        jdbc.update("""
                INSERT INTO back_office_permissions (user_id, permissions)
                VALUES (?::uuid, ?::jsonb)
                """, saved.getId().toString(), functionsJson);
        return saved;
    }

    @Test
    void kycFunctionCanDecideIdentityReviews() throws Exception {
        String id = UUID.randomUUID().toString();
        User kyc = staff("9866060001", "[\"kyc\"]");
        User support = staff("9866060002", "[\"support\"]");

        mvc.perform(post(Routes.Moderation.IDENTITY_REVIEW_REJECT.replace("{id}", id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(kyc))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"blurry\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(post(Routes.Moderation.IDENTITY_REVIEW_REJECT.replace("{id}", id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(support))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"blurry\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void propertyVerifyAndModerateAreSeparate() throws Exception {
        String id = UUID.randomUUID().toString();
        User verifier = staff("9866060003", "[\"propertyVerification\"]");
        User moderator = staff("9866060004", "[\"listingModeration\"]");

        mvc.perform(post((Routes.Moderation.PROPERTY_VERIFICATION + "/start").replace("{id}", id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(verifier)))
                .andExpect(status().isNotFound());
        mvc.perform(post((Routes.Moderation.PROPERTY_VERIFICATION + "/start").replace("{id}", id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(moderator)))
                .andExpect(status().isForbidden());

        mvc.perform(patch(Routes.Moderation.PROPERTY_STATUS.replace("{id}", id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(moderator))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(patch(Routes.Moderation.PROPERTY_STATUS.replace("{id}", id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(verifier))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void staffWithMultipleDesksSeesTheirUnionOnly() throws Exception {
        User actor = staff("9866060005", "[\"support\",\"desk:rental\",\"desk:legal\"]");
        Ticket rental = tickets.saveAndFlush(new Ticket("Rental", Teams.RENTAL, null, null, null,
                "Rental", "9866060101", null, null));
        Ticket legal = tickets.saveAndFlush(new Ticket("Legal", Teams.LEGAL, null, null, null,
                "Legal", "9866060102", null, null));
        Ticket loans = tickets.saveAndFlush(new Ticket("Loans", Teams.LOANS, null, null, null,
                "Loans", "9866060103", null, null));

        mvc.perform(get(Routes.Tickets.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].id", hasItem(rental.getId().toString())))
                .andExpect(jsonPath("$.content[*].id", hasItem(legal.getId().toString())))
                .andExpect(jsonPath("$.content[*].id", not(hasItem(loans.getId().toString()))));

        mvc.perform(get(Routes.Tickets.BASE)
                        .queryParam("team", Teams.LOANS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                .andExpect(status().isForbidden());
    }
}
