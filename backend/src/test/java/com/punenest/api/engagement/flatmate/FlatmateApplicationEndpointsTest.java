package com.punenest.api.engagement.flatmate;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import com.punenest.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * A group applies to a whole flat, and the flat's owner answers.
 *
 * <p>These three routes exist because the admin board over {@code flatmate_group_applications} was
 * a correct, guarded, paged read over a table nothing could write to: the entity's constructor had
 * no callers and {@code decide()} had none either. So the interesting assertions here are not the
 * happy paths — they are the ones that prove the two axes stay apart. An owner writes
 * {@code status} and can never write {@code modStatus}; a moderator writes {@code modStatus} and
 * can never decide on the owner's behalf; and a removed row leaves the owner's inbox without its
 * {@code status} moving, because "ops took this down" is not the same statement as "the owner said
 * no".
 */
@DisplayName("Flatmate group applications — the group applies, the owner answers")
class FlatmateApplicationEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @Autowired
    PropertyRepository properties;

    @Autowired
    EntityManager em;

    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String mobile, String name) {
        return user(mobile, name, Roles.Wire.BUYER);
    }

    private User user(String mobile, String name, String role) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private Property listing(User owner, String title, String deal, long price) {
        Property p = new Property(owner, title, deal, "apartment", price, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("3"));
        p.setStatus("approved");
        p.setPriceUnit("rent".equals(deal) ? "per-month" : "total");
        p.setArea(new BigDecimal("1100"));
        return properties.saveAndFlush(p);
    }

    /**
     * A group, published past the D72 queue.
     *
     * <p>Applying deliberately requires a <em>visible</em> group, so a test that skipped this would
     * be asserting against a 400 rather than the thing it meant to assert.
     */
    private String group(User host, String title) throws Exception {
        String json = mvc.perform(post(Routes.Flatmates.GROUPS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"%s","locality":"Kothrud","policy":"any","rent":45000,
                                 "seats":3,"seatsOpen":1,"name":"%s"}
                                """.formatted(title, host.getName())))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
        jdbc.update("update flatmate_groups set mod_status = 'approved' where id = ?::uuid", id);
        /* The whole test class runs in one transaction, so the row Hibernate is holding still says
           `pending` after that UPDATE — and `apply` reads visibility off the entity, not off the
           WHERE clause. Clearing forces the next read to come from the database, which is what the
           running application would always have done. */
        em.clear();
        return id;
    }

    private String apply(User host, String groupId, Property listing) throws Exception {
        String json = mvc.perform(post(Routes.Flatmates.GROUP_APPLY.replace("{id}", groupId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"listingId\":\"" + listing.getId() + "\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }

    @Nested
    @DisplayName("applying")
    class Applying {

        @Test
        @DisplayName("the host applies and the owner's inbox carries the per-head split")
        void happyPath() throws Exception {
            User owner = user("9811100001", "Owner One", Roles.Wire.OWNER);
            User host = user("9811100002", "Host One");
            Property flat = listing(owner, "3BHK in Kothrud", "rent", 45000L);
            String groupId = group(host, "Three of us for a 3BHK");

            mvc.perform(post(Routes.Flatmates.GROUP_APPLY.replace("{id}", groupId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"listingId\":\"" + flat.getId() + "\"}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.listingTitle").value("3BHK in Kothrud"))
                    .andExpect(jsonPath("$.groupTitle").value("Three of us for a 3BHK"))
                    .andExpect(jsonPath("$.applicantName").value("Host One"))
                    .andExpect(jsonPath("$.status").value("pending"))
                    // 45000 over 3 seats. The per-head figure is what an owner actually reads, and
                    // it is computed from the group's seats rather than its current members —
                    // a group applies for the seats it intends to fill.
                    .andExpect(jsonPath("$.perHead").value(15000))
                    .andExpect(jsonPath("$.seatsTotal").value(3));
        }

        @Test
        @DisplayName("only the group's own host may commit it")
        void nonHostRefused() throws Exception {
            User owner = user("9811100003", "Owner Two", Roles.Wire.OWNER);
            User host = user("9811100004", "Host Two");
            User stranger = user("9811100005", "Stranger");
            Property flat = listing(owner, "3BHK in Kothrud", "rent", 45000L);
            String groupId = group(host, "Not your group");

            mvc.perform(post(Routes.Flatmates.GROUP_APPLY.replace("{id}", groupId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"listingId\":\"" + flat.getId() + "\"}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message", Matchers.containsString("started this group")));
        }

        @Test
        @DisplayName("a second application to the same flat is a sentence, not a constraint error")
        void duplicateRefused() throws Exception {
            User owner = user("9811100006", "Owner Three", Roles.Wire.OWNER);
            User host = user("9811100007", "Host Three");
            Property flat = listing(owner, "3BHK in Kothrud", "rent", 45000L);
            String groupId = group(host, "Applying twice");
            apply(host, groupId, flat);

            mvc.perform(post(Routes.Flatmates.GROUP_APPLY.replace("{id}", groupId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"listingId\":\"" + flat.getId() + "\"}"))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.message", Matchers.containsString("the owner has it")));
        }

        @Test
        @DisplayName("a sale listing is refused — its price is not a monthly figure")
        void saleListingRefused() throws Exception {
            User owner = user("9811100008", "Owner Four", Roles.Wire.OWNER);
            User host = user("9811100009", "Host Four");
            Property flat = listing(owner, "3BHK for sale", "buy", 9_500_000L);
            String groupId = group(host, "Wrong deal");

            mvc.perform(post(Routes.Flatmates.GROUP_APPLY.replace("{id}", groupId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"listingId\":\"" + flat.getId() + "\"}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message", Matchers.containsString("rental listing")));
        }

        @Test
        @DisplayName("you cannot apply your group to your own flat")
        void ownListingRefused() throws Exception {
            User both = user("9811100010", "Owner Host", Roles.Wire.OWNER);
            Property flat = listing(both, "My own 3BHK", "rent", 45000L);
            String groupId = group(both, "My own group");

            mvc.perform(post(Routes.Flatmates.GROUP_APPLY.replace("{id}", groupId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(both))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"listingId\":\"" + flat.getId() + "\"}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message", Matchers.containsString("your own listing")));
        }
    }

    @Nested
    @DisplayName("the owner's inbox")
    class Inbox {

        @Test
        @DisplayName("shows applications on my flats and nobody else's")
        void scopedToMe() throws Exception {
            User mine = user("9811100011", "Owner Mine", Roles.Wire.OWNER);
            User theirs = user("9811100012", "Owner Theirs", Roles.Wire.OWNER);
            User host = user("9811100013", "Host Five");
            Property myFlat = listing(mine, "My flat", "rent", 45000L);
            Property theirFlat = listing(theirs, "Their flat", "rent", 45000L);
            apply(host, group(host, "Group A"), myFlat);
            apply(host, group(host, "Group B"), theirFlat);

            mvc.perform(get(Routes.Flatmates.MY_GROUP_APPLICATIONS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(mine)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content.length()").value(1))
                    .andExpect(jsonPath("$.content[0].listingTitle").value("My flat"));
        }

        @Test
        @DisplayName("a moderator's removal hides the row without answering for the owner")
        void moderationRemovalHides() throws Exception {
            User owner = user("9811100014", "Owner Five", Roles.Wire.OWNER);
            User host = user("9811100015", "Host Six");
            Property flat = listing(owner, "Moderated flat", "rent", 45000L);
            String appId = apply(host, group(host, "Group C"), flat);

            jdbc.update("update flatmate_group_applications set mod_status = 'removed' where id = ?::uuid",
                    appId);

            mvc.perform(get(Routes.Flatmates.MY_GROUP_APPLICATIONS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content.length()").value(0));

            // Still pending. Taking a row down is a moderation act; declining is the owner's, and
            // one must never be recorded as the other.
            String status = jdbc.queryForObject(
                    "select status from flatmate_group_applications where id = ?::uuid",
                    String.class, appId);
            org.assertj.core.api.Assertions.assertThat(status).isEqualTo("pending");
        }
    }

    @Nested
    @DisplayName("deciding")
    class Deciding {

        @Test
        @DisplayName("the owner accepts, and the row carries the decision back")
        void accept() throws Exception {
            User owner = user("9811100016", "Owner Six", Roles.Wire.OWNER);
            User host = user("9811100017", "Host Seven");
            Property flat = listing(owner, "Decided flat", "rent", 45000L);
            String appId = apply(host, group(host, "Group D"), flat);

            mvc.perform(patch(Routes.Flatmates.MY_GROUP_APPLICATION_BY_ID.replace("{id}", appId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"status\":\"accepted\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.status").value("accepted"));
        }

        @Test
        @DisplayName("answering twice is refused — a decision is not a toggle")
        void decideTwice() throws Exception {
            User owner = user("9811100018", "Owner Seven", Roles.Wire.OWNER);
            User host = user("9811100019", "Host Eight");
            Property flat = listing(owner, "Twice flat", "rent", 45000L);
            String appId = apply(host, group(host, "Group E"), flat);
            String path = Routes.Flatmates.MY_GROUP_APPLICATION_BY_ID.replace("{id}", appId);

            mvc.perform(patch(path)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"status\":\"declined\"}"))
                    .andExpect(status().isOk());

            mvc.perform(patch(path)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"status\":\"accepted\"}"))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.message", Matchers.containsString("already answered")));
        }

        @Test
        @DisplayName("someone else's application is a 404, not a 403")
        void strangerGets404() throws Exception {
            User owner = user("9811100020", "Owner Eight", Roles.Wire.OWNER);
            User other = user("9811100021", "Owner Nine", Roles.Wire.OWNER);
            User host = user("9811100022", "Host Nine");
            Property flat = listing(owner, "Private flat", "rent", 45000L);
            String appId = apply(host, group(host, "Group F"), flat);

            // 404 rather than 403 deliberately: a 403 would confirm the id exists, which is an
            // existence oracle over other owners' inboxes.
            mvc.perform(patch(Routes.Flatmates.MY_GROUP_APPLICATION_BY_ID.replace("{id}", appId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(other))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"status\":\"accepted\"}"))
                    .andExpect(status().isNotFound());
        }

        @Test
        @DisplayName("`pending` is not a decision anyone can take")
        void pendingRefused() throws Exception {
            User owner = user("9811100023", "Owner Ten", Roles.Wire.OWNER);
            User host = user("9811100024", "Host Ten");
            Property flat = listing(owner, "Pending flat", "rent", 45000L);
            String appId = apply(host, group(host, "Group G"), flat);

            mvc.perform(patch(Routes.Flatmates.MY_GROUP_APPLICATION_BY_ID.replace("{id}", appId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"status\":\"pending\"}"))
                    .andExpect(status().isBadRequest());
        }
    }

    @Nested
    @DisplayName("my own groups")
    class MyGroups {

        @Test
        @DisplayName("includes a group still waiting on moderation — the host is not a stranger")
        void includesPending() throws Exception {
            User host = user("9811100025", "Host Eleven");
            mvc.perform(post(Routes.Flatmates.GROUPS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"title":"Still pending","locality":"Kothrud","policy":"any",
                                     "rent":45000,"seats":3,"seatsOpen":1,"name":"Host Eleven"}
                                    """))
                    .andExpect(status().isCreated());

            mvc.perform(get(Routes.Flatmates.MY_GROUPS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content.length()").value(1))
                    .andExpect(jsonPath("$.content[0].title").value("Still pending"))
                    .andExpect(jsonPath("$.content[0].modStatus").value("pending"));
        }

        @Test
        @DisplayName("does not include anyone else's")
        void scopedToHost() throws Exception {
            User host = user("9811100026", "Host Twelve");
            User other = user("9811100027", "Host Thirteen");
            group(host, "Mine");

            mvc.perform(get(Routes.Flatmates.MY_GROUPS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(other)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content.length()").value(0));
        }
    }
}
