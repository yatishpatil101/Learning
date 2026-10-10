package com.draazy.api.services;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.emptyOrNullString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.security.Teams;
import com.jayway.jsonpath.JsonPath;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

@DisplayName("S16 — desk queues read slim rows and mint documents on click")
class ServiceDeskPayloadTest extends ServiceFixtures {

    @Nested
    @DisplayName("GET /service-requests/queue")
    class Queue {

        @Test
        @DisplayName("a row carries the list fields and none of the detail fields")
        void rowIsSlim() throws Exception {
            User buyer = customer("9820016001");
            User desk = staff("9820016002", Teams.RENTAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));
            upload(buyer, id, "Aadhaar");

            mvc.perform(get(Routes.ServiceRequests.QUEUE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", hasSize(1)))
                    .andExpect(jsonPath("$.content[0].id").value(id))
                    .andExpect(jsonPath("$.content[0].type").value("rent-agreement"))
                    .andExpect(jsonPath("$.content[0].status").isNotEmpty())
                    .andExpect(jsonPath("$.content[0].createdAt").isNotEmpty())
                    .andExpect(jsonPath("$.content[0].documents").doesNotExist())
                    .andExpect(jsonPath("$.content[0].messages").doesNotExist())
                    .andExpect(jsonPath("$.content[0].parties").doesNotExist())
                    .andExpect(jsonPath("$.content[0].timeline").doesNotExist())
                    .andExpect(jsonPath("$.content[0].paymentSessionId").doesNotExist())
                    .andExpect(jsonPath("$.content[0].propertyId").doesNotExist());
        }

        @Test
        @DisplayName("a desk-scoped staffer sees only their own desk")
        void deskScoped() throws Exception {
            User buyer = customer("9820016003");
            raise(buyer, "rent-agreement", listing(buyer));
            raise(buyer, "legal", null);
            User rental = staff("9820016004", Teams.RENTAL);

            mvc.perform(get(Routes.ServiceRequests.QUEUE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(rental)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", hasSize(1)))
                    .andExpect(jsonPath("$.content[0].type").value("rent-agreement"));
        }

        @Test
        @DisplayName("a customer cannot read the queue")
        void customerRefused() throws Exception {
            User buyer = customer("9820016005");

            mvc.perform(get(Routes.ServiceRequests.QUEUE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(status().isForbidden());
        }
    }

    @Nested
    @DisplayName("GET /service-requests/{id}/docs/{docId}/url")
    class DocumentUrls {

        @Test
        @DisplayName("the owner and the desk mint a URL; a stranger and an unknown id get 404")
        void mintScopedToTheRequest() throws Exception {
            User buyer = customer("9820016011");
            User stranger = customer("9820016012");
            User desk = staff("9820016013", Teams.RENTAL);
            Property p = listing(buyer);
            String id = raise(buyer, "rent-agreement", p);
            upload(buyer, id, "Aadhaar");
            String docId = documentId(buyer, id, "Aadhaar");

            mvc.perform(get(Routes.ServiceRequests.DOC_URL, id, docId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.url", not(emptyOrNullString())));
            mvc.perform(get(Routes.ServiceRequests.DOC_URL, id, docId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isOk());
            mvc.perform(get(Routes.ServiceRequests.DOC_URL, id, docId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                    .andExpect(status().isNotFound());
            mvc.perform(get(Routes.ServiceRequests.DOC_URL, id, java.util.UUID.randomUUID().toString())
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(status().isNotFound());
        }
    }

    @Nested
    @DisplayName("customer tickets")
    class Tickets {

        @Test
        @DisplayName("rows leave out notes and values; the detail read has them")
        void rowsAreSlimDetailIsFull() throws Exception {
            User buyer = customer("9820016021");
            User legal = staff("9820016022", Teams.LEGAL);
            String id = field(mvc.perform(post(Routes.Tickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"subject\":\"Agreement\",\"team\":\"legal\"}"))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString(), "id");
            mvc.perform(post(Routes.Tickets.NOTES, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(legal))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"body\":\"called the owner\"}"))
                    .andExpect(status().isCreated());

            mvc.perform(get(Routes.Tickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(legal)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].subject").value("Agreement"))
                    .andExpect(jsonPath("$.content[0].notes").doesNotExist())
                    .andExpect(jsonPath("$.content[0].value").doesNotExist())
                    .andExpect(jsonPath("$.content[0].quotedValue").doesNotExist());
            mvc.perform(get(Routes.Tickets.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(legal)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.notes", hasSize(1)));
        }

        @Test
        @DisplayName("the summary counts the scoped desk and the status/priority/q filters narrow the page")
        void summaryAndFilters() throws Exception {
            User buyer = customer("9820016023");
            User legal = staff("9820016024", Teams.LEGAL);
            create(buyer, "{\"subject\":\"Sale deed question\",\"team\":\"legal\",\"priority\":\"high\"}");
            create(buyer, "{\"subject\":\"Stamp duty\",\"team\":\"legal\"}");
            create(buyer, "{\"subject\":\"Site visit\",\"team\":\"rental\"}");

            mvc.perform(get(Routes.Tickets.SUMMARY)
                            .header(HttpHeaders.AUTHORIZATION, bearer(legal)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.all").value(2))
                    .andExpect(jsonPath("$.open").value(2))
                    .andExpect(jsonPath("$.closed").value(0));
            mvc.perform(get(Routes.Tickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(legal))
                            .param("q", "sale deed"))
                    .andExpect(jsonPath("$.content", hasSize(1)))
                    .andExpect(jsonPath("$.content[0].subject").value("Sale deed question"));
            mvc.perform(get(Routes.Tickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(legal))
                            .param("status", "closed"))
                    .andExpect(jsonPath("$.content", hasSize(0)));
            mvc.perform(get(Routes.Tickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(legal))
                            .param("priority", "high"))
                    .andExpect(jsonPath("$.content", hasSize(1)));
        }

        private void create(User caller, String body) throws Exception {
            mvc.perform(post(Routes.Tickets.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body))
                    .andExpect(status().isCreated());
        }
    }

    @Nested
    @DisplayName("GET /admin/team/assignees")
    class Assignees {

        @Test
        @DisplayName("lists active back-office accounts by name and desk, with no contact details")
        void noContactDetails() throws Exception {
            User legal = staff("9820016031", Teams.LEGAL);
            User gone = staff("9820016032", Teams.RENTAL);
            jdbc.update("UPDATE users SET status = 'suspended' WHERE id = ?::uuid", gone.getId().toString());
            em.clear();
            User boss = admin("9820016033");

            String body = mvc.perform(get(Routes.Admin.TEAM_ASSIGNEES)
                            .header(HttpHeaders.AUTHORIZATION, bearer(boss)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$[?(@.id=='" + legal.getId() + "')].desks[0]").value("legal"))
                    .andExpect(jsonPath("$[?(@.id=='" + gone.getId() + "')]").isEmpty())
                    .andExpect(jsonPath("$[*].mobile").doesNotExist())
                    .andExpect(jsonPath("$[*].email").doesNotExist())
                    .andExpect(jsonPath("$[*].role").doesNotExist())
                    .andReturn().getResponse().getContentAsString();
            List<String> ids = JsonPath.read(body, "$[*].id");
            org.assertj.core.api.Assertions.assertThat(ids).contains(legal.getId().toString());
        }

        @Test
        @DisplayName("staff and customers cannot list it")
        void managersAndAdminsOnly() throws Exception {
            mvc.perform(get(Routes.Admin.TEAM_ASSIGNEES)
                            .header(HttpHeaders.AUTHORIZATION, bearer(staff("9820016034", Teams.LEGAL))))
                    .andExpect(status().isForbidden());
            mvc.perform(get(Routes.Admin.TEAM_ASSIGNEES)
                            .header(HttpHeaders.AUTHORIZATION, bearer(customer("9820016035"))))
                    .andExpect(status().isForbidden());
        }
    }

    private String documentId(User caller, String id, String category) throws Exception {
        String body = detail(caller, id);
        return JsonPath.<List<String>>read(body, "$.documents[?(@.category=='" + category + "')].id").get(0);
    }
}
