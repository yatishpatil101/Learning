package com.draazy.api.catalog.society;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

@DisplayName("Societies — Google place identity")
class SocietyGoogleIdentityTest extends AbstractApiTest {

    private static final double LAT = 18.5000;
    private static final double LNG = 73.8000;

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired SocietyReference societyReference;
    @Autowired jakarta.persistence.EntityManager em;

    private User user(String mobile) {
        User u = new User(mobile, Roles.Wire.OWNER);
        u.setName("Gid " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private UUID society(String slug, String name, String placeId, Double lat, Double lng, boolean archived) {
        return jdbc.queryForObject("""
                insert into societies (slug, name, source, place_id, lat, lng, archived_at)
                values (?, ?, 'community', ?, ?, ?, case when ? then now() end) returning id""",
                UUID.class, slug, name, placeId, lat, lng, archived);
    }


    @Test
    @DisplayName("resolve returns the society that holds the place, and no candidates")
    void resolveExactHit() throws Exception {
        society("gid-exact-towers", "Gid Exact Towers", "gid-p-exact", LAT, LNG, false);

        mvc.perform(get("/societies/resolve").param("placeId", "gid-p-exact"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.society.slug").value("gid-exact-towers"))
                .andExpect(jsonPath("$.candidates.length()").value(0));
    }

    @Test
    @DisplayName("resolve needs a placeId")
    void resolveNeedsAPlaceId() throws Exception {
        mvc.perform(get("/societies/resolve")).andExpect(status().isBadRequest());
        mvc.perform(get("/societies/resolve").param("placeId", " ")).andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("resolve follows a merged-away society to its survivor")
    void resolveReturnsTheMergeSurvivor() throws Exception {
        User ops = user("9867000001");
        UUID survivor = society("gid-survivor-heights", "Gid Survivor Heights", "gid-p-survivor", LAT, LNG, false);
        UUID retired = society("gid-retired-heights", "Gid Retired Heights", "gid-p-retired", LAT, LNG, false);
        jdbc.update("update societies set merged_into = ?, merged_at = now(), merged_by = ? where id = ?",
                survivor, ops.getId(), retired);

        mvc.perform(get("/societies/resolve").param("placeId", "gid-p-retired"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.society.slug").value("gid-survivor-heights"));
    }

    @Test
    @DisplayName("an unknown place offers similar societies within 250 m, and only those")
    void resolveOffersNearbyCandidates() throws Exception {
        society("gid-sunrise-heights", "Gid Sunrise Heights", "gid-p-sun", LAT, LNG, false);
        society("gid-sunrise-heights-far", "Gid Sunrise Heights Far", "gid-p-sun-far", LAT + 0.004, LNG, false);
        society("gid-other-nearby", "Zephyr Gardens Quollhaven", "gid-p-other", LAT, LNG, false);

        mvc.perform(get("/societies/resolve")
                        .param("placeId", "gid-p-unknown")
                        .param("name", "Gid Sunrise Heights")
                        .param("lat", String.valueOf(LAT + 0.0009))
                        .param("lng", String.valueOf(LNG)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.society").doesNotExist())
                .andExpect(jsonPath("$.candidates.length()").value(1))
                .andExpect(jsonPath("$.candidates[0].slug").value("gid-sunrise-heights"));
    }

    @Test
    @DisplayName("an unknown place with no pin has no candidates")
    void resolveWithoutAPinHasNoCandidates() throws Exception {
        society("gid-pinless-heights", "Gid Pinless Heights", "gid-p-pinless", LAT, LNG, false);

        mvc.perform(get("/societies/resolve").param("placeId", "gid-p-nope").param("name", "Gid Pinless Heights"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.candidates.length()").value(0));
    }


    @Test
    @DisplayName("a retired society is absent from browse, detail, resolve, follow and new bindings")
    void archivedSocietiesAreGone() throws Exception {
        UUID id = society("gid-retired-court", "Gid Retired Court", "gid-p-arch", LAT, LNG, true);
        User member = user("9867000002");

        mvc.perform(get("/societies").param("q", "Gid Retired Court"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0));
        mvc.perform(get("/societies/gid-retired-court")).andExpect(status().isNotFound());
        mvc.perform(get("/societies/resolve").param("placeId", "gid-p-arch"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.society").doesNotExist());
        mvc.perform(put("/me/societies/gid-retired-court/follow")
                        .header(HttpHeaders.AUTHORIZATION, bearer(member)))
                .andExpect(status().isNotFound());
        assertThatThrownBy(() -> societyReference.require(id.toString())).isInstanceOf(NotFoundException.class);
    }

    @Test
    @DisplayName("an existing binding to a retired society is left in place")
    void existingBindingSurvives() throws Exception {
        UUID id = society("gid-bound-court", "Gid Bound Court", "gid-p-bound", LAT, LNG, true);
        User owner = user("9867000003");
        Property listing = new Property(owner, "Bound flat", "rent", "apartment", 30000L, "Kothrud", "Pune");
        listing.setSocietyId(id);
        properties.saveAndFlush(listing);

        assertThat(properties.findById(listing.getId()).orElseThrow().getSocietyId()).isEqualTo(id);
    }

    @Test
    @DisplayName("a retired row releases its place, so the building can be added again as a live society")
    void aRetiredPlaceCanBeMintedAgain() throws Exception {
        society("gid-held-court", "Gid Held Court", null, LAT, LNG, true);
        User member = user("9867000004");

        mvc.perform(post("/societies")
                        .header(HttpHeaders.AUTHORIZATION, bearer(member))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"placeId\":\"gid-p-held\",\"name\":\"Gid Held Court\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.slug").value(org.hamcrest.Matchers.startsWith("gid-held-court")));
    }

    @Test
    @DisplayName("a retired society takes no questions, contributions or claims")
    void retiredSocietyRefusesWrites() throws Exception {
        society("gid-quiet-court", "Gid Quiet Court", null, LAT, LNG, true);
        String auth = bearer(user("9867000005"));

        for (String[] call : new String[][] {
                {"/societies/gid-quiet-court/questions", "{\"body\":\"Is parking free?\"}"},
                {"/societies/gid-quiet-court/contributions", "{\"kind\":\"tip\",\"body\":\"Quiet lane\"}"},
                {"/societies/gid-quiet-court/claim", "{\"name\":\"Gid Secretary\"}"}}) {
            mvc.perform(post(call[0]).header(HttpHeaders.AUTHORIZATION, auth)
                            .contentType(MediaType.APPLICATION_JSON).content(call[1]))
                    .andExpect(status().isNotFound());
        }
    }

    @Test
    @DisplayName("the merge desk refuses a retired society as the survivor")
    void mergeIntoARetiredSocietyIsRefused() throws Exception {
        society("gid-live-twin", "Gid Live Twin", "gid-p-twin", LAT, LNG, false);
        society("gid-gone-court", "Gid Gone Court", null, LAT, LNG, true);
        User ops = new User("9867000006", Roles.Wire.STAFF);
        ops.setName("Gid Ops");
        ops.setMobileVerified(true);

        mvc.perform(post("/admin/society-merges")
                        .header(HttpHeaders.AUTHORIZATION, bearer(users.saveAndFlush(ops)))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"from\":\"gid-live-twin\",\"into\":\"gid-gone-court\"}"))
                .andExpect(status().isConflict());
    }

    @Test
    @DisplayName("a listing bound to a retired society still names it, for the owner's edit form")
    void listingCarriesTheSocietyName() throws Exception {
        UUID retired = society("gid-named-court", "Gid Named Court", null, LAT, LNG, true);
        User owner = user("9867000007");
        Property listing = new Property(owner, "Named flat", "rent", "apartment", 30000L, "Kothrud", "Pune");
        listing.setSocietyId(retired);
        properties.saveAndFlush(listing);
        em.clear();

        mvc.perform(get("/properties/" + listing.getId()).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.societyName").value("Gid Named Court"))
                .andExpect(jsonPath("$.societySlug").value("gid-named-court"));
    }


    private String roomSociety(String societyFields) throws Exception {
        User host = user("9867000020");
        String json = mvc.perform(post(Routes.Flatmates.ROOMS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"bhk":"2","roomType":"Private room","attachedBath":"attached",
                                 "furnishing":"semi","locality":"Aundh",%s
                                 "rentShare":15000,"deposit":30000,"availableFrom":"2026-09-01",
                                 "lookingFor":"any","foodPref":"any",
                                 "photos":["https://cdn.example/1.jpg"],"hostRole":"owner",
                                 "note":"Quiet room."}
                                """.formatted(societyFields)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
        return jdbc.queryForObject("select society from flatmate_rooms where id = ?::uuid", String.class, id);
    }

    @Test
    @DisplayName("a room's society text is the bound society's name, whatever the client typed")
    void roomSocietyTextIsDerived() throws Exception {
        UUID id = society("gid-room-towers", "Gid Room Towers", "gid-p-room", LAT, LNG, false);

        assertThat(roomSociety("\"societyId\":\"" + id + "\",\"society\":\"Typed Nonsense\","))
                .isEqualTo("Gid Room Towers");
    }

    @Test
    @DisplayName("a room with no society stores no society text")
    void roomWithoutASocietyHasNoText() throws Exception {
        assertThat(roomSociety("\"society\":\"Typed Nonsense\",")).isNull();
    }


    private Property boundListing(User owner, UUID societyId) {
        Property p = new Property(owner, "Bound flat", "rent", "apartment", 30000L, "Kothrud", "Pune");
        p.setStatus(PropertyStatus.APPROVED);
        p.setSocietyId(societyId);
        p.setSocietySlug(jdbc.queryForObject("select slug from societies where id = ?", String.class, societyId));
        return properties.saveAndFlush(p);
    }

    private void patchListing(String path, String token, String body, int expected) throws Exception {
        mvc.perform(patch(path).header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().is(expected));
    }

    @Test
    @DisplayName("an owner's edit keeps the binding when societyId is absent and removes it when it is empty")
    void ownerPatchKeepsOrClearsTheBinding() throws Exception {
        UUID id = society("gid-edit-court", "Gid Edit Court", "gid-p-edit", LAT, LNG, false);
        User owner = user("9867000030");
        Property listing = boundListing(owner, id);
        String path = "/me/listings/" + listing.getId();

        patchListing(path, bearer(owner), "{\"description\":\"Sunny corner flat\"}", 200);
        assertThat(properties.findById(listing.getId()).orElseThrow().getSocietyId()).isEqualTo(id);

        patchListing(path, bearer(owner), "{\"societyId\":\"\"}", 200);
        Property cleared = properties.findById(listing.getId()).orElseThrow();
        assertThat(cleared.getSocietyId()).isNull();
        assertThat(cleared.getSocietySlug()).isNull();
    }

    @Test
    @DisplayName("a moderator's edit removes the binding with an empty societyId")
    void moderatorPatchClearsTheBinding() throws Exception {
        UUID id = society("gid-admin-court", "Gid Admin Court", "gid-p-admin", LAT, LNG, false);
        User owner = user("9867000031");
        User admin = new User("9867000032", Roles.Wire.ADMIN);
        admin.setName("Gid Admin");
        admin.setMobileVerified(true);
        admin = users.saveAndFlush(admin);
        Property listing = boundListing(owner, id);

        patchListing(Routes.Moderation.PROPERTY_ADMIN_UPDATE.replace("{id}", listing.getId().toString()),
                bearer(admin), "{\"societyId\":\"\"}", 200);

        Property cleared = properties.findById(listing.getId()).orElseThrow();
        assertThat(cleared.getSocietyId()).isNull();
        assertThat(cleared.getSocietySlug()).isNull();
    }

    @Test
    @DisplayName("a listing bound to a retired society stays editable; moving it to another retired one is refused")
    void listingEditChecksOnlyAChangedBinding() throws Exception {
        UUID retired = society("gid-old-court", "Gid Old Court", "gid-p-old", LAT, LNG, true);
        UUID otherRetired = society("gid-older-court", "Gid Older Court", "gid-p-older", LAT, LNG, true);
        User owner = user("9867000033");
        Property listing = boundListing(owner, retired);
        String path = "/me/listings/" + listing.getId();

        patchListing(path, bearer(owner), "{\"societyId\":\"" + retired + "\",\"description\":\"Still here\"}", 200);
        patchListing(path, bearer(owner), "{\"societyId\":\"" + otherRetired + "\"}", 404);
        assertThat(properties.findById(listing.getId()).orElseThrow().getSocietyId()).isEqualTo(retired);
    }

    private String roomBody(String societyFields) {
        return """
                {"bhk":"2","roomType":"Private room","attachedBath":"attached",
                 "furnishing":"semi","locality":"Aundh",%s
                 "rentShare":15000,"deposit":30000,"availableFrom":"2026-09-01",
                 "lookingFor":"any","foodPref":"any",
                 "photos":["https://cdn.example/1.jpg"],"hostRole":"owner",
                 "note":"Quiet room."}
                """.formatted(societyFields);
    }

    private String postRoom(User host, String societyFields) throws Exception {
        String json = mvc.perform(post(Routes.Flatmates.ROOMS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON).content(roomBody(societyFields)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }

    private void patchRoom(User host, String roomId, String societyFields, int expected) throws Exception {
        mvc.perform(patch(Routes.Flatmates.ROOM_BY_ID, roomId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON).content(roomBody(societyFields)))
                .andExpect(status().is(expected));
    }

    private String[] roomSocietyColumns(String roomId) {
        return jdbc.queryForObject("select society_id::text, society from flatmate_rooms where id = ?::uuid",
                (rs, n) -> new String[] {rs.getString(1), rs.getString(2)}, roomId);
    }

    @Test
    @DisplayName("a room edit keeps its society when societyId is absent and removes it, text and all, when empty")
    void roomPatchKeepsOrClearsTheBinding() throws Exception {
        UUID id = society("gid-keep-towers", "Gid Keep Towers", "gid-p-keep", LAT, LNG, false);
        User host = user("9867000040");
        String roomId = postRoom(host, "\"societyId\":\"" + id + "\",");

        patchRoom(host, roomId, "", 200);
        assertThat(roomSocietyColumns(roomId)).containsExactly(id.toString(), "Gid Keep Towers");

        patchRoom(host, roomId, "\"societyId\":\"\",", 200);
        assertThat(roomSocietyColumns(roomId)).containsExactly(null, null);
    }

    @Test
    @DisplayName("a room bound to a retired society stays editable; only a changed id is checked")
    void roomEditChecksOnlyAChangedBinding() throws Exception {
        UUID id = society("gid-retiring-towers", "Gid Retiring Towers", "gid-p-retiring", LAT, LNG, false);
        UUID otherRetired = society("gid-gone-towers", "Gid Gone Towers", "gid-p-gone", LAT, LNG, true);
        User host = user("9867000041");
        String roomId = postRoom(host, "\"societyId\":\"" + id + "\",");
        jdbc.update("update societies set archived_at = now() where id = ?", id);

        patchRoom(host, roomId, "\"societyId\":\"" + id + "\",", 200);
        patchRoom(host, roomId, "", 200);
        assertThat(roomSocietyColumns(roomId)).containsExactly(id.toString(), "Gid Retiring Towers");

        patchRoom(host, roomId, "\"societyId\":\"" + otherRetired + "\",", 404);
    }
}
