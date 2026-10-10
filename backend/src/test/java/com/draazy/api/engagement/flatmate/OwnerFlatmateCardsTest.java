package com.draazy.api.engagement.flatmate;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

@DisplayName("Flatmates — the owner's own rows carry only what their screens draw")
class OwnerFlatmateCardsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String mobile, String name) {
        User u = new User(mobile, Roles.Wire.BUYER);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private String createPost(User author) throws Exception {
        String json = mvc.perform(post(Routes.Flatmates.POSTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Poster","gender":"female","age":26,"occupation":"Designer",
                                 "budget":18000,"localities":["Baner"],"moveIn":"2026-09-01",
                                 "flatPref":"women","roomPref":"private","tags":["Vegetarian"]}
                                """))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = json.replaceAll(".*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
        jdbc.update("update flatmate_seeker_posts set mod_status = 'approved' where id = ?::uuid", id);
        return id;
    }

    private String express(User requester, String postId) throws Exception {
        mvc.perform(post(Routes.Flatmates.POST_INTEREST, postId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(requester))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"message\":\"Hi!\"}"))
                .andExpect(status().isCreated());
        return jdbc.queryForObject(
                "select id::text from flatmate_requests where target_id = ?::uuid and requester_id = ?::uuid",
                String.class, postId, requester.getId());
    }

    private void decide(User host, String requestId, String decision) throws Exception {
        mvc.perform(patch(Routes.Flatmates.MY_REQUEST_BY_ID, requestId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"" + decision + "\"}"))
                .andExpect(status().isOk());
    }

    @Nested
    @DisplayName("GET /me/flatmate-groups")
    class GroupCards {

        @Test
        @DisplayName("is a card: seats and moderation state, none of the claim forensics or numbers")
        void carriesOnlyTheCardFields() throws Exception {
            User host = user("9850000001", "Group Host");
            String json = mvc.perform(post(Routes.Flatmates.GROUPS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"title":"Card group","locality":"Baner","rent":40000,
                                     "name":"Group Host","role":"tenant","consentMobile":"9850000099"}
                                    """))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            String id = json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");

            mvc.perform(get(Routes.Flatmates.MY_GROUPS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content.length()").value(1))
                    .andExpect(jsonPath("$.content[0].id").value(id))
                    .andExpect(jsonPath("$.content[0].title").value("Card group"))
                    .andExpect(jsonPath("$.content[0].locality").value("Baner"))
                    .andExpect(jsonPath("$.content[0].localities[0]").value("Baner"))
                    .andExpect(jsonPath("$.content[0].rent").value(40000))
                    .andExpect(jsonPath("$.content[0].seatsTotal").isNumber())
                    .andExpect(jsonPath("$.content[0].seatsOpen").isNumber())
                    .andExpect(jsonPath("$.content[0].memberCount").value(1))
                    .andExpect(jsonPath("$.content[0].modStatus").value("pending"))
                    .andExpect(jsonPath("$.content[0].createdAt").isNotEmpty())
                    .andExpect(jsonPath("$.content[0].members").doesNotExist())
                    .andExpect(jsonPath("$.content[0].ownerConsentMobile").doesNotExist())
                    .andExpect(jsonPath("$.content[0].addressFingerprint").doesNotExist())
                    .andExpect(jsonPath("$.content[0].flagForReview").doesNotExist())
                    .andExpect(jsonPath("$.content[0].verificationTier").doesNotExist())
                    .andExpect(jsonPath("$.content[0].reviewStatus").doesNotExist())
                    .andExpect(jsonPath("$.content[0].ownerMobile").doesNotExist())
                    .andExpect(jsonPath("$.content[0].ownerName").doesNotExist())
                    .andExpect(jsonPath("$.content[0].preferences").doesNotExist());

            mvc.perform(get(Routes.Flatmates.MY_GROUPS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(user("9850000002", "Someone Else"))))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content.length()").value(0));
        }
    }

    @Nested
    @DisplayName("GET /me/flatmate-posts/{id}")
    class OwnPost {

        @Test
        @DisplayName("is the author's post with their own number, and nobody else's")
        void onlyTheAuthorReadsIt() throws Exception {
            User author = user("9850000011", "Author");
            String id = createPost(author);

            mvc.perform(get(Routes.Flatmates.MY_POST_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(author)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.id").value(id))
                    .andExpect(jsonPath("$.mobile").value("9850000011"));

            mvc.perform(get(Routes.Flatmates.MY_POST_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(user("9850000012", "Stranger"))))
                    .andExpect(status().isNotFound());
        }

        @Test
        @DisplayName("an unknown id is a 404, and anonymous is refused")
        void unknownAndAnonymous() throws Exception {
            mvc.perform(get(Routes.Flatmates.MY_POST_BY_ID, UUID.randomUUID())
                            .header(HttpHeaders.AUTHORIZATION, bearer(user("9850000013", "Nobody"))))
                    .andExpect(status().isNotFound());
            mvc.perform(get(Routes.Flatmates.MY_POST_BY_ID, UUID.randomUUID()))
                    .andExpect(status().isUnauthorized());
        }
    }

    @Nested
    @DisplayName("the requester's number on the host inbox")
    class RequesterMobile {

        @Test
        @DisplayName("is masked while pending, in full once accepted, masked again if declined")
        void releasedOnlyOnAcceptance() throws Exception {
            User host = user("9850000021", "Host");
            User accepted = user("9850000022", "Accepted");
            User declined = user("9850000023", "Declined");
            String postId = createPost(host);
            String acceptedRequest = express(accepted, postId);
            String declinedRequest = express(declined, postId);

            mvc.perform(get(Routes.Flatmates.MY_REQUESTS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[?(@.requesterName == 'Accepted')].requesterMobile")
                            .value("98XXXXX022"))
                    .andExpect(jsonPath("$.content[?(@.requesterName == 'Declined')].requesterMobile")
                            .value("98XXXXX023"));

            decide(host, acceptedRequest, "accepted");
            mvc.perform(patch(Routes.Flatmates.MY_REQUEST_BY_ID, declinedRequest)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"decision\":\"declined\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.requesterMobile").value("98XXXXX023"));

            mvc.perform(get(Routes.Flatmates.MY_REQUESTS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                    .andExpect(jsonPath("$.content[?(@.requesterName == 'Accepted')].requesterMobile")
                            .value("9850000022"))
                    .andExpect(jsonPath("$.content[?(@.requesterName == 'Declined')].requesterMobile")
                            .value("98XXXXX023"));
        }

        @Test
        @DisplayName("accepting answers with the number the host has just been given")
        void theDecisionResponseCarriesItOnAcceptance() throws Exception {
            User host = user("9850000031", "Host");
            User requester = user("9850000032", "Requester");
            String requestId = express(requester, createPost(host));

            mvc.perform(patch(Routes.Flatmates.MY_REQUEST_BY_ID, requestId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"decision\":\"accepted\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.requesterMobile").value("9850000032"));
        }

        @Test
        @DisplayName("the requester's own outbox keeps their own number")
        void outboxIsTheRequestersOwn() throws Exception {
            User host = user("9850000041", "Host");
            User requester = user("9850000042", "Requester");
            express(requester, createPost(host));

            mvc.perform(get(Routes.Flatmates.MY_INTERESTS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(requester)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].requesterMobile").value("9850000042"));
        }
    }
}
