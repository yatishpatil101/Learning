package com.draazy.api.services;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.security.Teams;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

// A Leave &amp; License prints PAN and Aadhaar, so the drafting desk needs them; the security pass that closed the
// {@code details} leak stopped them reaching the server at all, and this is the replacement.
@DisplayName("D151 — service-request identities: one reader, recorded, and discarded when done")
class ServiceRequestIdentityTest extends ServiceFixtures {

    private static final String OWNER_PAN = "ABCDE1234F";
    private static final String OWNER_AADHAAR = "211122223335";
    private static final String TENANT_AADHAAR = "444455556666";

    // `AuditService` writes in `REQUIRES_NEW`, so its rows commit outside this test's transaction and survive the
    // rollback.
    @AfterEach
    void clearAuditRows() {
        jdbc.update("delete from audit_log where action in "
                + "('service-request.identities-recorded', 'service-request.identities-viewed', "
                + "'service-request.identities-refused')");
    }

    @Nested
    @DisplayName("only the assigned operator can read them")
    class OneReader {

        @Test
        @DisplayName("the assignee reads the full numbers; a second staff member cannot")
        void onlyTheAssignee() throws Exception {
            User buyer = customer("9820000301");
            User desk = staff("9820000302", Teams.RENTAL);
            User otherDesk = staff("9820000303", Teams.RENTAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));
            record(buyer, id, 204);

            readIdentities(desk, id, 403);

            setStatus(desk, id, "assigned", 200);
            mvc.perform(get(Routes.ServiceRequests.IDENTITIES, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$[0].partyRole").value("owner"))
                    .andExpect(jsonPath("$[0].pan").value(OWNER_PAN))
                    .andExpect(jsonPath("$[0].aadhaar").value(OWNER_AADHAAR))
                    .andExpect(jsonPath("$[1].partyRole").value("tenant"))
                    .andExpect(jsonPath("$[1].aadhaar").value(TENANT_AADHAAR))

                    .andExpect(jsonPath("$[1].pan").doesNotExist())
                    .andExpect(jsonPath("$[0].purgedAt").doesNotExist());

            readIdentities(otherDesk, id, 403);
        }

        @Test
        @DisplayName("the assignee also needs the request's desk")
        void assigneeMustStillBeOnTheDesk() throws Exception {
            User buyer = customer("9820000330");
            User rentalDesk = staff("9820000331", Teams.RENTAL);
            User legalDesk = staff("9820000332", Teams.LEGAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));
            record(buyer, id, 204);
            setStatus(rentalDesk, id, "assigned", 200);

            jdbc.update("update service_requests set assignee_id = ?::uuid where id = ?::uuid",
                    legalDesk.getId().toString(), id);

            readIdentities(legalDesk, id, 403);
        }

        @Test
        @DisplayName("an admin is refused too, until they take the request themselves")
        void adminMustTakeItFirst() throws Exception {
            User buyer = customer("9820000304");
            User desk = staff("9820000305", Teams.RENTAL);
            User boss = admin("9820000306");
            String id = raise(buyer, "rent-agreement", listing(buyer));
            record(buyer, id, 204);
            setStatus(desk, id, "assigned", 200);

            readIdentities(boss, id, 403);
            setStatus(boss, id, "in-progress", 200);
            setStatus(boss, id, "assigned", 200);
            readIdentities(boss, id, 200);
            readIdentities(desk, id, 403);
        }

        @Test
        @DisplayName("the customer who typed them cannot read them back through the desk's route")
        void customerIsNotAReader() throws Exception {
            User buyer = customer("9820000307");
            User desk = staff("9820000308", Teams.RENTAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));
            record(buyer, id, 204);
            setStatus(desk, id, "assigned", 200);

            // The role guard, not the assignee check — but the outcome the wizard depends on is the
            // same: nothing restores these into a form, and no customer-facing read exists.
            readIdentities(buyer, id, 403);
        }

        @Test
        @DisplayName("they are on no list, and on no request document")
        void notProjectedAnywhere() throws Exception {
            User buyer = customer("9820000309");
            User desk = staff("9820000310", Teams.RENTAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));
            record(buyer, id, 204);
            setStatus(desk, id, "assigned", 200);

            // Assert on the raw JSON rather than on a field, because the failure being guarded against is a number
            // appearing somewhere nobody thought to look.
            assertThat(detail(desk, id)).doesNotContain(OWNER_AADHAAR, OWNER_PAN, TENANT_AADHAAR);
            assertThat(queue(desk)).doesNotContain(OWNER_AADHAAR, OWNER_PAN, TENANT_AADHAAR);
            assertThat(detail(buyer, id)).doesNotContain(OWNER_AADHAAR, TENANT_AADHAAR);
        }
    }

    @Nested
    @DisplayName("only the requester writes them")
    class OneWriter {

        @Test
        @DisplayName("staff and admin are refused — a desk that could write them could invent them")
        void staffCannotWrite() throws Exception {
            User buyer = customer("9820000311");
            User desk = staff("9820000312", Teams.RENTAL);
            User boss = admin("9820000313");
            String id = raise(buyer, "rent-agreement", listing(buyer));

            record(desk, id, 403);
            record(boss, id, 403);
            setStatus(desk, id, "assigned", 200);

            mvc.perform(get(Routes.ServiceRequests.IDENTITIES, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$", org.hamcrest.Matchers.hasSize(0)));
        }

        @Test
        @DisplayName("another customer's request is invisible, not forbidden")
        void strangersRequestIs404() throws Exception {
            User buyer = customer("9820000314");
            User stranger = customer("9820000315");
            String id = raise(buyer, "rent-agreement", listing(buyer));

            record(stranger, id, 404);
        }

        @Test
        @DisplayName("the requester replaces every role not owned by an accepted co-fill party")
        void writeReplaces() throws Exception {
            User buyer = customer("9820000316");
            User desk = staff("9820000317", Teams.RENTAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));
            record(buyer, id, 204);

            // The old value must not survive under a shifted index, or the desk has two candidates; the tenant's row
            // is the co-filling tenant's to write and must survive.
            putIdentities(buyer, id, """
                    {"parties":[
                      {"partyRole":"owner","partyIndex":0,"partyName":"Asha Patil",
                       "pan":"ZZZZZ9999Z","aadhaar":"999988887779"}
                    ]}""", 204);

            setStatus(desk, id, "assigned", 200);
            String read = readIdentities(desk, id, 200);
            assertThat(read).contains("ZZZZZ9999Z").doesNotContain(OWNER_PAN, TENANT_AADHAAR);

            assertThat(jdbc.queryForList(
                    "select pan || '|' || aadhaar from service_request_identities where service_request_id = ?",
                    String.class, UUID.fromString(id)))
                    .singleElement().asString()
                    .doesNotContain("ZZZZZ9999Z", "999988887779")
                    .matches("enc:v1:[a-z0-9-]+:\\S+\\|enc:v1:[a-z0-9-]+:\\S+");
        }

        @Test
        @DisplayName("a party with neither number, a bad PAN or Aadhaar, or a repeated party is refused")
        void malformedIsRejected() throws Exception {
            User buyer = customer("9820000318");
            String id = raise(buyer, "rent-agreement", listing(buyer));

            putIdentities(buyer, id, """
                    {"parties":[{"partyRole":"owner","partyIndex":0,"partyName":"Asha"}]}""", 422);
            putIdentities(buyer, id, """
                    {"parties":[{"partyRole":"owner","partyIndex":0,"pan":"NOTAPAN"}]}""", 422);
            putIdentities(buyer, id, """
                    {"parties":[{"partyRole":"owner","partyIndex":0,"aadhaar":"12345"}]}""", 422);

            putIdentities(buyer, id, """
                    {"parties":[{"partyRole":"owner","partyIndex":0,"aadhaar":"999988887777"}]}""", 422);
            putIdentities(buyer, id, """
                    {"parties":[{"partyRole":"licensee","partyIndex":0,"pan":"ABCDE1234F"}]}""", 422);
            putIdentities(buyer, id, """
                    {"parties":[
                      {"partyRole":"owner","partyIndex":0,"aadhaar":"%s"},
                      {"partyRole":"tenant","partyIndex":0,"aadhaar":"%s"}
                    ]}""".formatted(OWNER_AADHAAR, OWNER_AADHAAR), 422);
            putIdentities(buyer, id, """
                    {"parties":[
                      {"partyRole":"tenant","partyIndex":0,"aadhaar":"%s"},
                      {"partyRole":"tenant","partyIndex":0,"aadhaar":"%s"}
                    ]}""".formatted(OWNER_AADHAAR, TENANT_AADHAAR), 422);
            putIdentities(buyer, id, """
                    {"parties":[
                      {"partyRole":"owner","partyIndex":0,"pan":"ABCDE1234F"},
                      {"partyRole":"tenant","partyIndex":0,"pan":"ABCDE1234F"}
                    ]}""", 422);
            putIdentities(buyer, id, """
                    {"parties":[{"partyRole":"witness","partyIndex":2,"aadhaar":"%s"}]}"""
                    .formatted(OWNER_AADHAAR), 422);
            putIdentities(buyer, id, "{\"parties\":[]}", 422);
        }

        @Test
        @DisplayName("co-owners and both attesting witnesses are recorded alongside the owner")
        void coOwnersAndWitnesses() throws Exception {
            User buyer = customer("9820000328");
            User desk = staff("9820000329", Teams.RENTAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));

            putIdentities(buyer, id, """
                    {"parties":[
                      {"partyRole":"owner","partyIndex":0,"partyName":"Asha Patil","aadhaar":"%s"},
                      {"partyRole":"owner","partyIndex":1,"partyName":"Vikram Patil","aadhaar":"555566667771"},
                      {"partyRole":"witness","partyIndex":0,"partyName":"Meera Kulkarni","aadhaar":"666677778888"},
                      {"partyRole":"witness","partyIndex":1,"partyName":"Sunil Deshmukh","aadhaar":"234567890124"}
                    ]}""".formatted(OWNER_AADHAAR), 204);

            setStatus(desk, id, "assigned", 200);
            mvc.perform(get(Routes.ServiceRequests.IDENTITIES, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$", org.hamcrest.Matchers.hasSize(4)))
                    .andExpect(jsonPath("$[?(@.partyRole == 'witness')].partyName",
                            org.hamcrest.Matchers.containsInAnyOrder("Meera Kulkarni", "Sunil Deshmukh")));
        }
    }

    @Nested
    @DisplayName("the numbers do not outlive the matter")
    class Retention {

        @Test
        @DisplayName("completing the request discards them and says so on the timeline")
        void completionPurges() throws Exception {
            User buyer = customer("9820000319");
            User desk = staff("9820000320", Teams.RENTAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));
            record(buyer, id, 204);

            setStatus(desk, id, "assigned", 200);
            shareDraft(desk, id, 200);
            openDraft(buyer, id, 204);
            decide(buyer, id, "approve", 200);
            finalDoc(desk, id, 201);

            mvc.perform(get(Routes.ServiceRequests.IDENTITIES, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$[0].partyName").value("Asha Patil"))
                    .andExpect(jsonPath("$[0].pan").doesNotExist())
                    .andExpect(jsonPath("$[0].aadhaar").doesNotExist())
                    .andExpect(jsonPath("$[0].purgedAt").isNotEmpty());

            assertThat(detail(buyer, id)).contains("identities.purged");
        }

        @Test
        @DisplayName("cancelling discards them too — nothing will be drafted from them")
        void cancellationPurges() throws Exception {
            User buyer = customer("9820000321");
            User desk = staff("9820000322", Teams.RENTAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));
            record(buyer, id, 204);
            setStatus(desk, id, "assigned", 200);
            setStatus(desk, id, "cancelled", 200);

            assertThat(readIdentities(desk, id, 200))
                    .doesNotContain(OWNER_AADHAAR, OWNER_PAN, TENANT_AADHAAR);
        }

        @Test
        @DisplayName("a closed request will not take a fresh set")
        void closedRequestRefusesAWrite() throws Exception {
            User buyer = customer("9820000323");
            User desk = staff("9820000324", Teams.RENTAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));
            setStatus(desk, id, "cancelled", 200);

            record(buyer, id, 409);
        }
    }

    @Nested
    @DisplayName("every access is recorded")
    class Audited {

        @Test
        @DisplayName("a read and a refused read both leave an audit row naming the caller")
        void readsAreAudited() throws Exception {
            User buyer = customer("9820000325");
            User desk = staff("9820000326", Teams.RENTAL);
            User otherDesk = staff("9820000327", Teams.RENTAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));
            record(buyer, id, 204);
            setStatus(desk, id, "assigned", 200);

            readIdentities(desk, id, 200);
            readIdentities(otherDesk, id, 403);

            assertThat(auditActions(id, desk.getId()))
                    .contains("service-request.identities-viewed");

            assertThat(auditActions(id, otherDesk.getId()))
                    .contains("service-request.identities-refused");
            assertThat(auditActions(id, buyer.getId()))
                    .contains("service-request.identities-recorded");
        }
    }

    /** Record the standard two-party set: an owner with both numbers, a tenant with only Aadhaar. */
    private void record(User caller, String id, int expected) throws Exception {
        putIdentities(caller, id, """
                {"parties":[
                  {"partyRole":"owner","partyIndex":0,"partyName":"Asha Patil",
                   "pan":"%s","aadhaar":"%s"},
                  {"partyRole":"tenant","partyIndex":0,"partyName":"Rahul Joshi",
                   "aadhaar":"%s"}
                ]}""".formatted(OWNER_PAN, OWNER_AADHAAR, TENANT_AADHAAR), expected);
    }

    private void putIdentities(User caller, String id, String body, int expected) throws Exception {
        mvc.perform(put(Routes.ServiceRequests.IDENTITIES, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().is(expected));
    }

    private String readIdentities(User caller, String id, int expected) throws Exception {
        return mvc.perform(get(Routes.ServiceRequests.IDENTITIES, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().is(expected))
                .andReturn().getResponse().getContentAsString();
    }

    private String queue(User desk) throws Exception {
        return mvc.perform(get(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    // Read straight from the table: `AuditService` writes in `REQUIRES_NEW`, so a JPA read of the rolled-back session
    // cannot see the rows.
    private List<String> auditActions(String requestId, UUID actorId) {
        return jdbc.queryForList(
                "SELECT action FROM audit_log WHERE entity = 'service_request' AND entity_id = ? "
                        + "AND actor = ?",
                String.class, requestId, actorId.toString());
    }
}
