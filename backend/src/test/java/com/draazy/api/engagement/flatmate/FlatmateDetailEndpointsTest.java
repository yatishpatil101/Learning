package com.draazy.api.engagement.flatmate;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.documents.vault.PersonalDocument;
import com.draazy.api.documents.vault.PersonalDocumentRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

@DisplayName("Flatmate detail — one ad by id")
class FlatmateDetailEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @Autowired
    PersonalDocumentRepository personalDocuments;

    @PersistenceContext
    EntityManager em;

    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User seeker(String mobile, String name) {
        User u = new User(mobile, Roles.Wire.BUYER);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private static String idIn(String json) {
        return json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }

    private String create(String route, User author, String body) throws Exception {
        return idIn(mvc.perform(post(route)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
    }

    private String group(User host) throws Exception {
        return create(Routes.Flatmates.GROUPS, host, """
                {"title":"Detail trio","locality":"DetailTown","policy":"any","rent":40000,
                 "seats":3,"seatsOpen":1,"name":"Host","tags":[]}
                """);
    }

    private String room(User host) throws Exception {
        return create(Routes.Flatmates.ROOMS, host, """
                {"bhk":"2","roomType":"Private room","attachedBath":"attached",
                 "furnishing":"semi","locality":"DetailTown","society":"Detail Heights",
                 "rentShare":15000,"deposit":30000,"availableFrom":"2026-09-01",
                 "lookingFor":"any","foodPref":"any","lat":18.5912345,"lng":73.7712345,
                 "photos":["https://cdn.example/1.jpg"],"hostRole":"owner","note":"Sunny."}
                """);
    }

    private String seekerPost(User author) throws Exception {
        return create(Routes.Flatmates.POSTS, author, """
                {"name":"Detail","gender":"any","age":27,"occupation":"Analyst",
                 "budget":18000,"localities":["DetailTown"],"moveIn":"2026-09-01",
                 "flatPref":"any","roomPref":"private","tags":[],"note":"Hello."}
                """);
    }

    private void approve(String table, String id) {
        jdbc.update("update " + table + " set mod_status = 'approved' where id = ?::uuid", id);
        em.clear();
    }

    @Test
    @DisplayName("the host reaches their own pending group, with host-only fields")
    void hostSeesOwnPendingGroup() throws Exception {
        User host = seeker("9812000001", "Host");
        String id = group(host);

        mvc.perform(get(Routes.Flatmates.GROUP_BY_ID, id).header(HttpHeaders.AUTHORIZATION, bearer(host)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.kind").value("group"))
                .andExpect(jsonPath("$.owned").value(true))
                .andExpect(jsonPath("$.item.id").value(id))
                .andExpect(jsonPath("$.item.modStatus").exists())
                .andExpect(jsonPath("$.verification").doesNotExist());
    }

    @Test
    @DisplayName("the host reads what the tenant badge waits on; a visitor gets no checklist")
    void verificationChecklistIsTheHostsAlone() throws Exception {
        User host = seeker("9812000007", "Host");
        String docId = personalDocuments.saveAndFlush(new PersonalDocument(host.getId(),
                "Registered Leave and Licence", "a.png",
                "personal/" + host.getId() + "/" + UUID.randomUUID(), 70L, "image/png"))
                .getId().toString();
        String id = create(Routes.Flatmates.GROUPS, host, """
                {"title":"Checklist trio","locality":"DetailTown","policy":"any","rent":40000,
                 "seats":3,"seatsOpen":1,"name":"Host","tags":[],"role":"tenant","agreement":true,
                 "agreementDoc":{"id":"%s","name":"a.png","mime":"image/png","size":70,
                   "dataUrl":"data:image/png;base64,iVBORw0KGgo="}}
                """.formatted(docId));

        mvc.perform(get(Routes.Flatmates.GROUP_BY_ID, id).header(HttpHeaders.AUTHORIZATION, bearer(host)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verification.status").value("pending"))
                .andExpect(jsonPath("$.verification.ownerConsent").value(false));

        approve("flatmate_groups", id);
        mvc.perform(get(Routes.Flatmates.GROUP_BY_ID, id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.verification").doesNotExist());
    }

    @Test
    @DisplayName("the host gets their own consent number back unmasked; a visitor never sees it")
    void consentNumberIsUnmaskedOnlyForTheHost() throws Exception {
        User host = seeker("9812000006", "Host");
        String id = create(Routes.Flatmates.GROUPS, host, """
                {"title":"Consent trio","locality":"DetailTown","policy":"any","rent":40000,
                 "seats":3,"seatsOpen":1,"name":"Host","tags":[],"role":"tenant",
                 "consentMobile":"9876543210"}
                """);

        mvc.perform(get(Routes.Flatmates.GROUP_BY_ID, id).header(HttpHeaders.AUTHORIZATION, bearer(host)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.item.ownerConsentMobile").value("9876543210"));

        approve("flatmate_groups", id);
        mvc.perform(get(Routes.Flatmates.GROUP_BY_ID, id))
                .andExpect(status().isOk())
                .andExpect(content().string(Matchers.not(Matchers.containsString("9876543210"))));
    }

    @Test
    @DisplayName("a pending ad is 404 to anyone but its author")
    void pendingIsHiddenFromOthers() throws Exception {
        User host = seeker("9812000002", "Host");
        User other = seeker("9812000003", "Other");
        String groupId = group(host);
        String roomId = room(host);

        mvc.perform(get(Routes.Flatmates.GROUP_BY_ID, groupId)).andExpect(status().isNotFound());
        mvc.perform(get(Routes.Flatmates.ROOM_BY_ID, roomId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(other)))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("an approved room is public, with photos and without host forensics")
    void approvedRoomIsPublic() throws Exception {
        User host = seeker("9812000004", "Host");
        String id = room(host);
        approve("flatmate_rooms", id);

        mvc.perform(get(Routes.Flatmates.ROOM_BY_ID, id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.owned").value(false))
                .andExpect(jsonPath("$.photos", Matchers.hasSize(1)))
                .andExpect(jsonPath("$.item.addressFingerprint").doesNotExist())
                .andExpect(jsonPath("$.item.ownerMobile").doesNotExist())
                .andExpect(jsonPath("$.item.lat").value(18.591))
                .andExpect(jsonPath("$.item.lng").value(73.771));
    }

    @Test
    @DisplayName("a seeker post is public at once, without the author's number")
    void seekerPostIsPublic() throws Exception {
        User author = seeker("9812000005", "Author");
        String id = seekerPost(author);

        mvc.perform(get(Routes.Flatmates.POST_BY_ID, id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.kind").value("post"))
                .andExpect(jsonPath("$.owned").value(false))
                .andExpect(jsonPath("$.item.mobile").doesNotExist())
                .andExpect(jsonPath("$.item.modStatus").doesNotExist());
    }

    @Test
    @DisplayName("a visitor's group card names its members without their row ids")
    void visitorGroupHasNoMemberIds() throws Exception {
        User host = seeker("9812000008", "Host");
        String id = group(host);
        approve("flatmate_groups", id);

        mvc.perform(get(Routes.Flatmates.GROUP_BY_ID, id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.item.members[0].host").value(true))
                .andExpect(jsonPath("$.item.members[0].id").doesNotExist());
    }
}
