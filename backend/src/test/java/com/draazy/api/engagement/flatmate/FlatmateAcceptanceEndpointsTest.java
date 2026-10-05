package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
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
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

@DisplayName("Flatmates — a host's accept takes the seat it promises")
class FlatmateAcceptanceEndpointsTest extends AbstractApiTest {

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

    private User user(String mobile, String name) {
        User u = new User(mobile, Roles.Wire.OWNER);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private static String idOf(String json) {
        return json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }

    private String publish(String table, String id) {
        jdbc.update("update " + table + " set mod_status = 'approved' where id = ?::uuid", id);
        return id;
    }

    private String approvalGroup(User host) throws Exception {
        String json = mvc.perform(post(Routes.Flatmates.GROUPS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"Two of us in Aundh","locality":"Aundh","policy":"women",
                                 "rent":40000,"seats":2,"seatsOpen":1,"name":"Host"}
                                """))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return publish("flatmate_groups", idOf(json));
    }

    private String seatRoom(User host) throws Exception {
        String json = mvc.perform(post(Routes.Flatmates.ROOMS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"bhk":"2","roomType":"Private room","attachedBath":"attached",
                                 "furnishing":"semi","locality":"Aundh","society":"Accept Towers",
                                 "rentShare":15000,"deposit":30000,"availableFrom":"2026-09-01",
                                 "lookingFor":"any","foodPref":"any",
                                 "photos":["https://cdn.example/1.jpg"],"hostRole":"owner",
                                 "note":"Quiet room."}
                                """))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return publish("flatmate_rooms", idOf(json));
    }

    private String splitRoom(User owner, int maxOccupants) throws Exception {
        Property flat = new Property(owner, "Flat in Aundh", "rent", "apartment",
                45000L, "Aundh", "Pune");
        flat.setBhk(BigDecimal.valueOf(2));
        flat.setStatus(PropertyStatus.APPROVED);
        properties.saveAndFlush(flat);
        mvc.perform(post(Routes.Properties.SPLIT, flat.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"maxOccupants\":" + maxOccupants
                                + ",\"rooms\":[{\"roomKind\":\"master\",\"rent\":15000}]}"))
                .andExpect(status().isCreated());
        String id = jdbc.queryForObject(
                "select id::text from flatmate_rooms where property_id = ?::uuid",
                String.class, flat.getId().toString());
        return publish("flatmate_rooms", id);
    }

    private String ask(String route, String targetId, User requester, String share) throws Exception {
        mvc.perform(post(route, targetId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(requester))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"share\":\"" + share + "\"}"))
                .andExpect(status().isCreated());
        return jdbc.queryForObject(
                "select id::text from flatmate_requests where target_id = ?::uuid "
                        + "and requester_id = ?::uuid",
                String.class, targetId, requester.getId().toString());
    }

    private ResultActions decide(User host, String requestId, String decision) throws Exception {
        return mvc.perform(patch(Routes.Flatmates.MY_REQUEST_BY_ID, requestId)
                .header(HttpHeaders.AUTHORIZATION, bearer(host))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"" + decision + "\"}"));
    }

    private int members(String groupId) {
        return jdbc.queryForObject(
                "select count(*) from flatmate_group_members where group_id = ?::uuid",
                Integer.class, groupId);
    }

    private int column(String table, String column, String id) {
        return jdbc.queryForObject(
                "select " + column + " from " + table + " where id = ?::uuid", Integer.class, id);
    }

    @Test
    @DisplayName("accepting a group request adds the member and takes the open seat")
    void groupAcceptAddsTheMember() throws Exception {
        User host = user("9847000001", "Host");
        User asker = user("9847000002", "Asha");
        String groupId = approvalGroup(host);
        String requestId = ask(Routes.Flatmates.GROUP_JOIN, groupId, asker, "solo");

        decide(host, requestId, "accepted")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("accepted"));

        assertThat(members(groupId)).isEqualTo(2);
        assertThat(column("flatmate_groups", "seats_open", groupId)).isZero();
        assertThat(jdbc.queryForObject(
                "select count(*) from flatmate_group_members where group_id = ?::uuid "
                        + "and user_id = ?::uuid and name = 'Asha'",
                Integer.class, groupId, asker.getId().toString()))
                .isEqualTo(1);

        mvc.perform(get(Routes.Flatmates.GROUP_BY_ID, groupId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.item.seatsOpen").value(0))
                .andExpect(jsonPath("$.item.members.length()").value(2));
    }

    @Test
    @DisplayName("a second accept on a group with no seat left is group_full and changes nothing")
    void groupAcceptPastTheLastSeatIsRefused() throws Exception {
        User host = user("9847000003", "Host");
        String groupId = approvalGroup(host);
        String first = ask(Routes.Flatmates.GROUP_JOIN, groupId, user("9847000004", "One"), "solo");
        String second = ask(Routes.Flatmates.GROUP_JOIN, groupId, user("9847000005", "Two"), "solo");

        decide(host, first, "accepted").andExpect(status().isOk());
        decide(host, second, "accepted")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", Matchers.endsWith("(group_full)")));

        assertThat(members(groupId)).isEqualTo(2);
        assertThat(jdbc.queryForObject("select status from flatmate_requests where id = ?::uuid",
                String.class, second)).isEqualTo("pending");
    }

    @Test
    @DisplayName("an answered request cannot be answered again")
    void answeredRequestIsFinal() throws Exception {
        User host = user("9847000006", "Host");
        String groupId = approvalGroup(host);
        String requestId = ask(Routes.Flatmates.GROUP_JOIN, groupId, user("9847000007", "Late"), "solo");

        decide(host, requestId, "declined").andExpect(status().isOk());
        decide(host, requestId, "accepted")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", Matchers.endsWith("(already_decided)")));

        assertThat(members(groupId)).isEqualTo(1);
    }

    @Test
    @DisplayName("accepting for a spare room fills its one seat; a second accept is room_full")
    void seatRoomAcceptTakesTheSeat() throws Exception {
        User host = user("9847000008", "Host");
        String roomId = seatRoom(host);
        String first = ask(Routes.Flatmates.ROOM_INTEREST, roomId, user("9847000009", "A"), "solo");
        String second = ask(Routes.Flatmates.ROOM_INTEREST, roomId, user("9847000010", "B"), "solo");

        decide(host, first, "accepted").andExpect(status().isOk());
        assertThat(column("flatmate_rooms", "seats_open", roomId)).isZero();

        decide(host, second, "accepted")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", Matchers.endsWith("(room_full)")));
    }

    @Test
    @DisplayName("accepting for a split room adds the people who are coming, up to the flat cap")
    void splitRoomAcceptAddsOccupants() throws Exception {
        User owner = user("9847000011", "Owner");
        String roomId = splitRoom(owner, 2);
        String pair = ask(Routes.Flatmates.ROOM_INTEREST, roomId, user("9847000012", "Pair"), "bring");
        String solo = ask(Routes.Flatmates.ROOM_INTEREST, roomId, user("9847000013", "Solo"), "solo");

        decide(owner, pair, "accepted").andExpect(status().isOk());
        assertThat(column("flatmate_rooms", "occupants", roomId)).isEqualTo(2);

        decide(owner, solo, "accepted")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", Matchers.endsWith("(room_full)")));
        assertThat(column("flatmate_rooms", "occupants", roomId)).isEqualTo(2);
    }

    @Test
    @DisplayName("declining takes nothing")
    void declineTakesNothing() throws Exception {
        User host = user("9847000014", "Host");
        String roomId = seatRoom(host);
        String requestId = ask(Routes.Flatmates.ROOM_INTEREST, roomId, user("9847000015", "N"), "solo");

        decide(host, requestId, "declined").andExpect(status().isOk());
        assertThat(column("flatmate_rooms", "seats_open", roomId)).isEqualTo(1);
    }
}
