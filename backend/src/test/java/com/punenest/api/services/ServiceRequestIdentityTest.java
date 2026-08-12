package com.punenest.api.services;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.security.Teams;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * The identity-number channel (D151), organised around the one property that matters:
 * <strong>exactly one person can read a party's Aadhaar number, and the platform knows who it
 * was.</strong>
 *
 * <p>Everything here exists to keep that true. A Leave &amp; License prints PAN and Aadhaar, so the
 * drafting desk needs them; the security pass that closed the {@code details} leak stopped them
 * reaching the server at all, and this is the replacement. The failure that would matter is not a
 * broken URL — it is the numbers becoming visible to one more person than intended, or outliving the
 * matter they were collected for.
 */
@DisplayName("D151 — service-request identities: one reader, recorded, and discarded when done")
class ServiceRequestIdentityTest extends ServiceFixtures {

    private static final String OWNER_PAN = "ABCDE1234F";
    private static final String OWNER_AADHAAR = "111122223333";
    private static final String TENANT_AADHAAR = "444455556666";

    /**
     * {@code AuditService} writes in {@code REQUIRES_NEW}, so its rows commit outside this test's
     * transaction and survive the rollback {@code AbstractApiTest} does for everything else. Same
     * cleanup as {@code ServiceRequestUnpaidExitTest}, keyed on the three actions this suite
     * produces.
     */
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

            // Nobody has taken the request yet, so there is no "the person working the matter".
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
                    // The tenant sent no PAN, which is allowed and is not the same as a purge.
                    .andExpect(jsonPath("$[1].pan").doesNotExist())
                    .andExpect(jsonPath("$[0].purgedAt").doesNotExist());

            // A colleague on the same team is still not the person working this matter.
            readIdentities(otherDesk, id, 403);
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

            // "Admin can do anything" would quietly delete the control, exactly as it would on the
            // draft decision. The way through is to take the matter — and taking one that somebody
            // else already holds costs two visible moves, because the transition table has no
            // assigned → assigned edge: the request goes back to in-progress first. Both moves are
            // timeline entries the customer reads and audit rows naming the admin.
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

            // This is the regression that matters: `details` used to carry them, and the paged ops
            // queue echoed it verbatim. Assert on the raw JSON rather than on a field, because the
            // failure being guarded against is a number appearing somewhere nobody thought to look.
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
            // and nothing was written by either attempt
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
        @DisplayName("resubmitting replaces the set rather than appending to it")
        void writeReplaces() throws Exception {
            User buyer = customer("9820000316");
            User desk = staff("9820000317", Teams.RENTAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));
            record(buyer, id, 204);

            // The customer notices the owner's PAN was mistyped and resubmits the whole form. The
            // old value must not survive under a shifted index, or the desk has two candidates.
            putIdentities(buyer, id, """
                    {"parties":[
                      {"partyRole":"owner","partyIndex":0,"partyName":"Asha Patil",
                       "pan":"ZZZZZ9999Z","aadhaar":"999988887777"}
                    ]}""", 204);

            setStatus(desk, id, "assigned", 200);
            String read = readIdentities(desk, id, 200);
            assertThat(read).contains("ZZZZZ9999Z").doesNotContain(OWNER_PAN, TENANT_AADHAAR);
        }

        @Test
        @DisplayName("a party with neither number, a bad PAN and an over-long set are all refused")
        void malformedIsRejected() throws Exception {
            User buyer = customer("9820000318");
            String id = raise(buyer, "rent-agreement", listing(buyer));

            // Nothing to say about this person — silently dropping them would leave the desk short
            // of a number it had no way to know it should have asked for.
            putIdentities(buyer, id, """
                    {"parties":[{"partyRole":"owner","partyIndex":0,"partyName":"Asha"}]}""", 422);
            putIdentities(buyer, id, """
                    {"parties":[{"partyRole":"owner","partyIndex":0,"pan":"NOTAPAN"}]}""", 422);
            putIdentities(buyer, id, """
                    {"parties":[{"partyRole":"owner","partyIndex":0,"aadhaar":"12345"}]}""", 422);
            putIdentities(buyer, id, """
                    {"parties":[{"partyRole":"witness","partyIndex":0,"pan":"ABCDE1234F"}]}""", 422);
            putIdentities(buyer, id, "{\"parties\":[]}", 422);
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
            decide(buyer, id, "approve", 200);
            finalDoc(desk, id, 201);

            // "Recorded, and since discarded" stays distinguishable from "never recorded" — which is
            // what purgedAt is for, and why the row and the name survive.
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
            // The refusal is the more interesting of the two: somebody reached for a matter that is
            // not theirs, and nothing else on this resource would have noticed.
            assertThat(auditActions(id, otherDesk.getId()))
                    .contains("service-request.identities-refused");
            assertThat(auditActions(id, buyer.getId()))
                    .contains("service-request.identities-recorded");
        }
    }

    // ---------------------------------------------------------------- helpers

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

    /** The ops queue as a staff caller sees it — the page that used to be the identity dump. */
    private String queue(User desk) throws Exception {
        return mvc.perform(get(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    /**
     * The audit actions recorded by one actor against one request.
     *
     * <p>Read straight out of the table rather than through a repository: {@code AuditService} writes
     * in {@code REQUIRES_NEW}, so the rows are committed outside this test's transaction and are not
     * visible to a JPA read of the rolled-back session.
     */
    private List<String> auditActions(String requestId, UUID actorId) {
        return jdbc.queryForList(
                "SELECT action FROM audit_log WHERE entity = 'service_request' AND entity_id = ? "
                        + "AND actor = ?",
                String.class, requestId, actorId.toString());
    }
}
