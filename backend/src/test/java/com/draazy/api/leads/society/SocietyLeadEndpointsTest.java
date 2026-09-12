package com.draazy.api.leads.society;

import com.draazy.api.support.AbstractApiTest;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * Contract + behaviour proof for the B2B society pipeline (slice 14).
 *
 * <p>The interesting thing about this resource is its asymmetry, and that is what the tests are
 * about. The submit is the platform's only unauthenticated write of free text, so:
 *
 * <ol>
 *   <li><strong>Anyone may file a lead</strong> — a building secretary is not a user and will not
 *       create an account to ask a question.</li>
 *   <li><strong>Nobody but ops may read one back.</strong> The list is a pile of names and mobile
 *       numbers belonging to people who never signed up, so it is staff/admin and paged (S57), not
 *       an unbounded array anyone can export in one call.</li>
 *   <li><strong>The submit is rate-limited per mobile</strong>, against the table rather than an
 *       in-memory counter — there is no session to hang a bucket off, and a counter that resets on
 *       deploy is not a limit.</li>
 *   <li><strong>Status is not a state machine.</strong> A lead marked lost that answers the phone
 *       goes back to contacted, so any transition is allowed and only unknown values are refused.
 *       </li>
 * </ol>
 */
class SocietyLeadEndpointsTest extends AbstractApiTest {

    @Autowired UserRepository users;

    private String bearer(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Leads " + mobile.substring(6));
        u.setMobileVerified(true);
        return "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(u));
    }

    private String staff() {
        return bearer("9877730001", Roles.Wire.STAFF);
    }

    private static String body(String society, String mobile) {
        return "{\"societyName\":\"" + society + "\",\"contactName\":\"Secretary\",\"mobile\":\""
                + mobile + "\",\"units\":120,\"interest\":\"bulk-listing\"}";
    }

    private String submit(String society, String mobile) throws Exception {
        String json = mvc.perform(post(Routes.SocietyLeads.BASE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(society, mobile)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        int at = json.indexOf("\"id\":\"") + 6;
        return json.substring(at, json.indexOf('"', at));
    }

    // ---- the public front door ----

    @Test
    void anyoneMaySubmitWithoutSigningIn() throws Exception {
        mvc.perform(post(Routes.SocietyLeads.BASE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("Kumar Prithvi", "9812300001")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.societyName").value("Kumar Prithvi"))
                .andExpect(jsonPath("$.status").value(SocietyLeadStatuses.NEW))
                .andExpect(jsonPath("$.mobile").value("9812300001"))
                .andExpect(jsonPath("$.units").value(120))
                .andExpect(jsonPath("$.id").exists());
    }

    /**
     * Three in a window, then refused. Three rather than one because a genuine builder with three
     * societies fills the form three times in a sitting.
     */
    @Test
    void theFourthEnquiryFromOneNumberIsRefused() throws Exception {
        String mobile = "9812300002";
        for (int i = 1; i <= 3; i++) {
            submit("Society " + i, mobile);
        }
        mvc.perform(post(Routes.SocietyLeads.BASE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("Society 4", mobile)))
                .andExpect(status().isTooManyRequests());
    }

    /** The limit is per number, so one noisy submitter cannot close the form for everyone. */
    @Test
    void theLimitIsPerNumber() throws Exception {
        String noisy = "9812300003";
        for (int i = 1; i <= 3; i++) {
            submit("Noisy " + i, noisy);
        }
        mvc.perform(post(Routes.SocietyLeads.BASE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("Quiet", "9812300004")))
                .andExpect(status().isCreated());
    }

    @Test
    void aMalformedSubmissionIsRefused() throws Exception {
        mvc.perform(post(Routes.SocietyLeads.BASE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"societyName\":\"\",\"contactName\":\"X\",\"mobile\":\"12345\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void anUnknownInterestIsRefused() throws Exception {
        mvc.perform(post(Routes.SocietyLeads.BASE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"societyName\":\"S\",\"contactName\":\"C\","
                                + "\"mobile\":\"9812300005\",\"interest\":\"world-domination\"}"))
                .andExpect(status().isBadRequest());
    }

    /** {@code units} is bounded in the DTO so an absurd value is a 422, not a constraint 409. */
    @Test
    void anAbsurdUnitCountIsRefusedBeforeTheDatabaseSeesIt() throws Exception {
        mvc.perform(post(Routes.SocietyLeads.BASE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"societyName\":\"S\",\"contactName\":\"C\","
                                + "\"mobile\":\"9812300006\",\"units\":99999}"))
                .andExpect(status().isUnprocessableEntity());
    }

    // ---- the staff-only read ----

    @Test
    void theListIsPagedAndStaffOnly() throws Exception {
        submit("Paged Society", "9812300007");

        mvc.perform(get(Routes.SocietyLeads.BASE).header(HttpHeaders.AUTHORIZATION, staff()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isArray())
                .andExpect(jsonPath("$.page").exists())
                .andExpect(jsonPath("$.totalElements").exists())
                .andExpect(jsonPath("$.content[?(@.societyName == 'Paged Society')]").exists());
    }

    /**
     * The mobile is deliberately unmasked here, unlike every other staff surface: the number was
     * volunteered on a "call me about my building" form, and masking it leaves ops a lead they
     * cannot work.
     */
    @Test
    void opsSeesTheWholeNumberBecauseTheLeadExistsToBeCalled() throws Exception {
        submit("Callable", "9812300008");
        mvc.perform(get(Routes.SocietyLeads.BASE)
                        .param("status", SocietyLeadStatuses.NEW)
                        .header(HttpHeaders.AUTHORIZATION, staff()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.societyName == 'Callable')].mobile")
                        .value(org.hamcrest.Matchers.hasItem("9812300008")));
    }

    @Test
    void theStatusFilterNarrowsThePipeline() throws Exception {
        String token = staff();
        String id = submit("Filtered", "9812300009");
        move(token, id, SocietyLeadStatuses.WON);

        mvc.perform(get(Routes.SocietyLeads.BASE)
                        .param("status", SocietyLeadStatuses.NEW)
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.id == '" + id + "')]").doesNotExist());

        mvc.perform(get(Routes.SocietyLeads.BASE)
                        .param("status", SocietyLeadStatuses.WON)
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.id == '" + id + "')]").exists());
    }

    @Test
    void anUnknownStatusFilterIsRefusedRatherThanReturningNothing() throws Exception {
        mvc.perform(get(Routes.SocietyLeads.BASE)
                        .param("status", "maybe")
                        .header(HttpHeaders.AUTHORIZATION, staff()))
                .andExpect(status().isBadRequest());
    }

    @Test
    void aPlainUserCannotReadTheLeadList() throws Exception {
        mvc.perform(get(Routes.SocietyLeads.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer("9877730002", Roles.Wire.OWNER)))
                .andExpect(status().isForbidden());
    }

    @Test
    void theLeadListIsNotPublic() throws Exception {
        mvc.perform(get(Routes.SocietyLeads.BASE)).andExpect(status().isUnauthorized());
    }

    // ---- working the pipeline ----

    @Test
    void aLeadMovesThroughThePipelineAndBack() throws Exception {
        String token = staff();
        String id = submit("Reversible", "9812300010");

        move(token, id, SocietyLeadStatuses.CONTACTED);
        move(token, id, SocietyLeadStatuses.LOST);
        // Not a state machine: a lost lead that answers the phone goes back.
        move(token, id, SocietyLeadStatuses.CONTACTED);
    }

    @Test
    void theOpsNoteIsStored() throws Exception {
        String token = staff();
        String id = submit("Noted", "9812300011");
        mvc.perform(patch(Routes.SocietyLeads.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"contacted\",\"note\":\"Called, wants a demo\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.note").value("Called, wants a demo"));
    }

    @Test
    void anUnknownStatusIsRefused() throws Exception {
        String token = staff();
        String id = submit("Bad status", "9812300012");
        mvc.perform(patch(Routes.SocietyLeads.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"pondering\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void anUnknownLeadIsNotFound() throws Exception {
        mvc.perform(patch(Routes.SocietyLeads.BY_ID, UUID.randomUUID())
                        .header(HttpHeaders.AUTHORIZATION, staff())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"contacted\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void aPlainUserCannotWorkThePipeline() throws Exception {
        String id = submit("Guarded", "9812300013");
        mvc.perform(patch(Routes.SocietyLeads.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer("9877730003", Roles.Wire.BUYER))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"won\"}"))
                .andExpect(status().isForbidden());
    }

    private void move(String token, String id, String status) throws Exception {
        mvc.perform(patch(Routes.SocietyLeads.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"" + status + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(status));
    }
}
