package com.punenest.api.services;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.support.AbstractApiTest;
import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import java.math.BigDecimal;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Shared fixtures for the slice-11 tests: users on each side of the workflow, a listing, and the
 * multipart/JSON helpers the three suites all need.
 *
 * <p>Kept as a base class rather than a utility because every one of these needs the autowired
 * {@link MockMvc} and the repositories, and threading five collaborators through static helpers is
 * more machinery than inheritance costs here.
 *
 * <p>Extends {@link AbstractApiTest} (D34), which now owns the Spring annotations, {@code mvc},
 * {@code jwtService} and {@code bearer()} — this class held a 27th copy of that same helper. What
 * stays here is what is genuinely slice-11's: the team-scoped {@code staff()} builder and the
 * multipart request helpers, neither of which any other suite needs.
 */
abstract class ServiceFixtures extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    User customer(String mobile) {
        return user(mobile, Roles.Wire.BUYER, null, "Asha Patil");
    }

    User staff(String mobile, String team) {
        return user(mobile, Roles.Wire.STAFF, team, "Rohit Desk");
    }

    User admin(String mobile) {
        return user(mobile, Roles.Wire.ADMIN, null, "Admin User");
    }

    User user(String mobile, String role, String team, String name) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setTeam(team);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    Property listing(User owner) {
        Property p = new Property(owner, "2BHK in Kothrud", "rent", "apartment", 25000L,
                "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        return properties.saveAndFlush(p);
    }

    /** Raise a request and return its id. */
    String raise(User caller, String type, Property property) throws Exception {
        String body = property == null
                ? "{\"type\":\"" + type + "\"}"
                : "{\"type\":\"" + type + "\",\"propertyId\":\"" + property.getId() + "\"}";
        String json = mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return field(json, "id");
    }

    void setStatus(User caller, String id, String status, int expected) throws Exception {
        mvc.perform(patch(Routes.ServiceRequests.STATUS, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"" + status + "\"}"))
                .andExpect(status().is(expected));
    }

    void shareDraft(User staff, String id, int expected) throws Exception {
        mvc.perform(multipart(Routes.ServiceRequests.DRAFT, id)
                        .file(new MockMultipartFile("file", "draft.pdf", "application/pdf",
                                "%PDF-1.4 draft".getBytes()))
                        .param("note", "Please review clause 7")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().is(expected));
    }

    void decide(User caller, String id, String decision, int expected) throws Exception {
        mvc.perform(post(Routes.ServiceRequests.DRAFT_DECISION, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"" + decision + "\"}"))
                .andExpect(status().is(expected));
    }

    void finalDoc(User staff, String id, int expected) throws Exception {
        mvc.perform(multipart(Routes.ServiceRequests.FINAL_DOC, id)
                        .file(new MockMultipartFile("file", "registered.pdf", "application/pdf",
                                "%PDF-1.4 final".getBytes()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().is(expected));
    }

    String detail(User caller, String id) throws Exception {
        return mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    /** Assert the request's current status without caring about the rest of the document. */
    void expectStatus(User caller, String id, String status) throws Exception {
        mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(status));
    }

    /** First occurrence of a string field. Same regex trick as the slice-10 suites. */
    static String field(String json, String name) {
        return json.replaceAll("(?s)^.*?\"" + name + "\":\"([^\"]+)\".*$", "$1");
    }
}
