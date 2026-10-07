package com.draazy.api.engagement.flatmate;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
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

@DisplayName("Flatmate moderation desk — the review popup's detail read and multi-state queues")
class FlatmateModerationDetailTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @Autowired
    PropertyRepository properties;

    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String mobile, String name, String role) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private static String idIn(String json) {
        return json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }

    private String createRoom(User host, String society) throws Exception {
        return idIn(mvc.perform(post(Routes.Flatmates.ROOMS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"bhk":"2","roomType":"Private room","attachedBath":"attached",
                                 "furnishing":"semi","locality":"DetailTown","society":"%s",
                                 "rentShare":15500,"deposit":31000,"availableFrom":"2026-09-01",
                                 "lookingFor":"any","foodPref":"any",
                                 "photos":["https://cdn.example/1.jpg"],"hostRole":"owner",
                                 "note":"Sunny room near the metro."}
                                """.formatted(society)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
    }

    private String createPost(User author) throws Exception {
        return idIn(mvc.perform(post(Routes.Flatmates.POSTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"Detail Seeker","gender":"any","age":27,"budget":18000,
                                 "localities":["DetailTown"],"moveIn":"2026-09-01",
                                 "flatPref":"any","roomPref":"private","tags":[],"note":"Quiet."}
                                """))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
    }

    private void moderate(User mod, String id, String state) throws Exception {
        mvc.perform(patch(Routes.Moderation.FLATMATE_MODERATION.replace("{id}", id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(mod))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"modStatus\":\"" + state + "\"}"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("a room opens in full — rent, deposit, photos and the host's number")
    void roomDetail() throws Exception {
        String id = createRoom(user("9811100001", "Detail Host", Roles.Wire.BUYER), "Detail Heights");
        User staff = user("9811100002", "Mod", Roles.Wire.ADMIN);

        mvc.perform(get(Routes.Moderation.FLATMATE_MODERATION_DETAIL, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.item.kind").value("room"))
                .andExpect(jsonPath("$.item.modStatus").value("pending"))
                .andExpect(jsonPath("$.item.freeText").value("Sunny room near the metro."))
                .andExpect(jsonPath("$.room.budget").value(15500))
                .andExpect(jsonPath("$.room.deposit").value(31000))
                .andExpect(jsonPath("$.room.photos[0]").value("https://cdn.example/1.jpg"))
                .andExpect(jsonPath("$.room.owner").value("Detail Host"))
                .andExpect(jsonPath("$.room.ownerMobile").value("9811100001"))
                .andExpect(jsonPath("$.group").doesNotExist())
                .andExpect(jsonPath("$.post").doesNotExist());
    }

    @Test
    @DisplayName("a seeker post opens as a post, with the seeker's number")
    void postDetail() throws Exception {
        String id = createPost(user("9811100003", "Detail Seeker", Roles.Wire.BUYER));
        User staff = user("9811100004", "Mod", Roles.Wire.ADMIN);

        mvc.perform(get(Routes.Moderation.FLATMATE_MODERATION_DETAIL, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.item.kind").value("post"))
                .andExpect(jsonPath("$.post.budget").value(18000))
                .andExpect(jsonPath("$.post.mobile").value("9811100003"))
                .andExpect(jsonPath("$.room").doesNotExist());
    }

    @Test
    @DisplayName("an unknown id is a 404, and a buyer cannot open the desk's read at all")
    void guarded() throws Exception {
        User staff = user("9811100005", "Mod", Roles.Wire.ADMIN);
        mvc.perform(get(Routes.Moderation.FLATMATE_MODERATION_DETAIL, UUID.randomUUID())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isNotFound());

        String id = createPost(user("9811100006", "Author", Roles.Wire.BUYER));
        User nosy = user("9811100007", "Nosy", Roles.Wire.BUYER);
        mvc.perform(get(Routes.Moderation.FLATMATE_MODERATION_DETAIL, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(nosy)))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("the queue takes several kinds and states at once, recheck beside them")
    void multiStateQueue() throws Exception {
        User host = user("9811100008", "Multi Host", Roles.Wire.BUYER);
        User staff = user("9811100009", "Mod", Roles.Wire.ADMIN);
        String approved = createRoom(host, "Multi A");
        String removed = createRoom(host, "Multi B");
        moderate(staff, approved, "approved");
        moderate(staff, removed, "removed");

        mvc.perform(get(Routes.Moderation.FLATMATE_MODERATION_QUEUE)
                        .param("kind", "room").param("modStatus", "approved,live")
                        .param("size", "200")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.id == '" + approved + "')]", Matchers.hasSize(1)))
                .andExpect(jsonPath("$.content[?(@.id == '" + removed + "')]", Matchers.hasSize(0)));

        String post = createPost(host);
        mvc.perform(get(Routes.Moderation.FLATMATE_MODERATION_QUEUE)
                        .param("kind", "room,post").param("modStatus", "recheck,pending")
                        .param("size", "200")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.id == '" + post + "')].kind",
                        Matchers.contains("post")))
                .andExpect(jsonPath("$.content[?(@.id == '" + approved + "')]", Matchers.hasSize(0)));
    }

    @Test
    @DisplayName("group applications can be narrowed by moderation state")
    void applicationsFilter() throws Exception {
        User owner = user("9811100041", "Landlord", Roles.Wire.OWNER);
        User applicant = user("9811100042", "Applicant", Roles.Wire.BUYER);
        User staff = user("9811100043", "Mod", Roles.Wire.ADMIN);
        Property flat = new Property(owner, "Flat in Baner", "rent", "apartment",
                45000L, "Baner", "Pune");
        flat.setStatus(PropertyStatus.APPROVED);
        flat = properties.saveAndFlush(flat);
        String groupId = idIn(mvc.perform(post(Routes.Flatmates.GROUPS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(applicant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"Four of us","locality":"Baner","rent":45000,
                                 "seats":4,"name":"Applicant"}
                                """))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
        // No API creates an application, so the row is seeded directly.
        String appId = jdbc.queryForObject(
                "insert into flatmate_group_applications (listing_id, group_id, applicant_id) "
                        + "values (?::uuid, ?::uuid, ?::uuid) returning id::text",
                String.class, flat.getId().toString(), groupId, applicant.getId().toString());

        mvc.perform(get(Routes.Moderation.GROUP_APPLICATIONS)
                        .param("modStatus", "live")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", Matchers.hasSize(1)));

        mvc.perform(patch(Routes.Moderation.GROUP_APPLICATION_BY_ID, appId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"modStatus\":\"removed\"}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Moderation.GROUP_APPLICATIONS)
                        .param("modStatus", "live")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", Matchers.hasSize(0)));
        mvc.perform(get(Routes.Moderation.GROUP_APPLICATIONS)
                        .param("modStatus", "removed")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", Matchers.hasSize(1)));

        mvc.perform(get(Routes.Moderation.GROUP_APPLICATIONS)
                        .param("modStatus", "nonsense")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().is4xxClientError());
    }
}
