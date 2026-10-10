package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.documents.vault.PersonalDocument;
import com.draazy.api.documents.vault.PersonalDocumentRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import com.jayway.jsonpath.JsonPath;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

@DisplayName("Flatmate moderation desk — slim cards, global pages, true tab counts")
class FlatmateModerationSlimTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @Autowired
    PersonalDocumentRepository personalDocuments;

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

    private String createTenantRoom(User host, String society) throws Exception {
        PersonalDocument doc = personalDocuments.saveAndFlush(new PersonalDocument(host.getId(),
                "Registered Leave and Licence", "leave-and-licence.pdf",
                "personal/" + host.getId() + "/" + UUID.randomUUID(), 184320L, "application/pdf"));
        String body = """
                {"bhk":"2","roomType":"Private room","attachedBath":"attached","furnishing":"semi",
                 "locality":"Baner","society":"%s","rentShare":15000,"deposit":30000,
                 "availableFrom":"2026-09-01","lookingFor":"any","foodPref":"any",
                 "agreementDeclared":true,"photos":["https://cdn.example/s1.jpg","https://cdn.example/s2.jpg"],
                 "note":"Sunny room.",%s}
                """.formatted(society, FlatmateAgreementFixture.EVIDENCE)
                .replace("\"id\":\"agr-doc-1\"", "\"id\":\"" + doc.getId() + "\"");
        return idIn(mvc.perform(post(Routes.Flatmates.ROOMS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
    }

    private String createPost(User author, String name) throws Exception {
        return idIn(mvc.perform(post(Routes.Flatmates.POSTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"%s","gender":"any","age":27,"budget":18000,
                                 "localities":["Baner"],"moveIn":"2026-09-01",
                                 "flatPref":"any","roomPref":"private","tags":[],"note":"Quiet."}
                                """.formatted(name)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
    }

    private void moderate(User mod, String id, String state) throws Exception {
        mvc.perform(patch(Routes.Moderation.FLATMATE_MODERATION, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(mod))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"modStatus\":\"" + state + "\"}"))
                .andExpect(status().isOk());
    }

    private String read(String path, User mod, String... params) throws Exception {
        var request = get(path).header(HttpHeaders.AUTHORIZATION, bearer(mod));
        for (int i = 0; i < params.length; i += 2) {
            request = request.param(params[i], params[i + 1]);
        }
        return mvc.perform(request).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    }

    private long count(String json, String tab) {
        return ((Number) JsonPath.read(json, "$." + tab)).longValue();
    }

    @Test
    @DisplayName("a badge-claim card carries no agreement file and no mobile; the popup's detail still does")
    void reviewRowIsACard() throws Exception {
        User host = user("9813000001", "Slim Host", Roles.Wire.BUYER);
        User staff = user("9813000002", "Mod", Roles.Wire.ADMIN);
        String roomId = createTenantRoom(host, "Slim Court");

        String list = read(Routes.Moderation.FLATMATE_REVIEWS, staff, "status", "pending", "size", "100");
        List<Map<String, Object>> rows = JsonPath.read(list, "$.content[?(@.roomId == '" + roomId + "')]");
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).keySet()).containsExactlyInAnyOrder("id", "kind", "roomId", "groupId", "host",
                "address", "tier", "flagForReview", "ownerConsent", "createdAt");
        assertThat(rows.get(0)).containsEntry("host", "Slim Host").containsEntry("tier", "tenant");

        mvc.perform(get(Routes.Moderation.FLATMATE_MODERATION_DETAIL, roomId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.review.hostMobile").value("9813000001"))
                .andExpect(jsonPath("$.review.agreementDoc.dataUrl").exists())
                .andExpect(jsonPath("$.review.status").value("pending"));
    }

    @Test
    @DisplayName("a queue card counts photos instead of listing them, and never names the author's id")
    void moderationRowCountsPhotos() throws Exception {
        User host = user("9813000003", "Photo Host", Roles.Wire.BUYER);
        User staff = user("9813000004", "Mod", Roles.Wire.ADMIN);
        String roomId = createTenantRoom(host, "Photo Court");
        String postId = createPost(host, "Photo Seeker");

        String list = read(Routes.Moderation.FLATMATE_MODERATION_QUEUE, staff,
                "kind", "room,post", "modStatus", "pending,recheck", "sort", "createdAt,desc", "size", "50");
        List<Map<String, Object>> room = JsonPath.read(list, "$.content[?(@.id == '" + roomId + "')]");
        List<Map<String, Object>> seeker = JsonPath.read(list, "$.content[?(@.id == '" + postId + "')]");
        assertThat(room).hasSize(1);
        assertThat(room.get(0).keySet()).containsExactlyInAnyOrder("id", "kind", "modStatus", "authorName",
                "headline", "locality", "freeText", "photoCount", "recheckReason", "recheckRequestedAt",
                "createdAt");
        assertThat(room.get(0)).containsEntry("photoCount", 2).containsEntry("authorName", "Photo Host");
        assertThat(seeker.get(0)).containsEntry("photoCount", 0);

        mvc.perform(get(Routes.Moderation.FLATMATE_MODERATION_DETAIL, roomId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(jsonPath("$.item.photos.length()").value(2))
                .andExpect(jsonPath("$.item.authorId").doesNotExist());
    }

    @Test
    @DisplayName("a page across several kinds never exceeds the requested size, and pages join up in age order")
    void pagesAreGlobal() throws Exception {
        User host = user("9813000005", "Paging Host", Roles.Wire.BUYER);
        User staff = user("9813000006", "Mod", Roles.Wire.ADMIN);
        Set<String> mine = Set.of(createTenantRoom(host, "Page A"), createTenantRoom(host, "Page B"),
                createPost(user("9813000010", "Seeker C", Roles.Wire.BUYER), "Page C"),
                createPost(user("9813000011", "Seeker D", Roles.Wire.BUYER), "Page D"),
                createPost(user("9813000012", "Seeker E", Roles.Wire.BUYER), "Page E"));

        List<String> seen = new ArrayList<>();
        List<java.time.Instant> stamps = new ArrayList<>();
        for (int page = 0; page < 200 && !seen.containsAll(mine); page++) {
            String json = read(Routes.Moderation.FLATMATE_MODERATION_QUEUE, staff, "kind", "post,room,group", "modStatus", "pending,recheck",
                    "sort", "createdAt,desc", "page", String.valueOf(page), "size", "2");
            List<String> ids = JsonPath.read(json, "$.content[*].id");
            assertThat(ids).hasSizeBetween(1, 2);
            seen.addAll(ids);
            JsonPath.<List<String>>read(json, "$.content[*].createdAt").forEach(s -> stamps.add(java.time.Instant.parse(s)));
        }
        assertThat(seen).doesNotHaveDuplicates().containsAll(mine);
        assertThat(stamps).isSortedAccordingTo(java.util.Comparator.reverseOrder());
    }

    @Test
    @DisplayName("the summary counts each tab's cards, a badge claim sharing its post's card once")
    void summaryCountsCards() throws Exception {
        User host = user("9813000007", "Count Host", Roles.Wire.BUYER);
        User staff = user("9813000008", "Mod", Roles.Wire.ADMIN);
        String summary = Routes.Moderation.FLATMATE_MODERATION_SUMMARY;
        String before = read(summary, staff);

        String roomId = createTenantRoom(host, "Count Court");
        String awaiting = read(summary, staff);
        assertThat(count(awaiting, "pending")).isEqualTo(count(before, "pending") + 1);

        moderate(staff, roomId, "approved");
        String published = read(summary, staff);
        assertThat(count(published, "pending")).isEqualTo(count(before, "pending") + 1);
        assertThat(count(published, "published")).isEqualTo(count(before, "published") + 1);

        moderate(staff, roomId, "removed");
        String hidden = read(summary, staff);
        assertThat(count(hidden, "published")).isEqualTo(count(before, "published"));
        assertThat(count(hidden, "hidden")).isEqualTo(count(before, "hidden") + 1);

        mvc.perform(get(summary).header(HttpHeaders.AUTHORIZATION, bearer(host)))
                .andExpect(status().isForbidden());
    }
}
