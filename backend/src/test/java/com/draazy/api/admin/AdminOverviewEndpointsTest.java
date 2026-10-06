package com.draazy.api.admin;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.security.Teams;
import com.draazy.api.support.AbstractApiTest;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

@DisplayName("The admin dashboard and bell are one read each, redacted per atom")
class AdminOverviewEndpointsTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;

    private User owner;
    private User admin;

    @BeforeEach
    void seed() {
        owner = user("9877710001", Roles.Wire.OWNER, null, null);
        admin = user("9877710002", Roles.Wire.ADMIN, null, null);
        UUID stale = listing("Stale", PropertyStatus.PENDING);
        jdbc.update("update properties set created_at = now() - interval '3 days' where id = ?", stale);
        listing("Fresh", PropertyStatus.PENDING);
        UUID staffPosted = listing("Staff posted", PropertyStatus.PENDING);
        jdbc.update("update properties set posted_by_admin = true where id = ?", staffPosted);
        UUID confirmed = listing("Staff posted and confirmed", PropertyStatus.PENDING);
        jdbc.update("update properties set posted_by_admin = true, owner_confirmed_at = now() where id = ?",
                confirmed);
        UUID archived = listing("Archived", PropertyStatus.PENDING);
        jdbc.update("update properties set archived = true where id = ?", archived);
        listing("Flagged", PropertyStatus.FLAGGED);
        UUID approved = listing("Approved", PropertyStatus.APPROVED);

        jdbc.update("insert into contact_requests (property_id, requester_id, status) values (?, ?, 'pending')",
                approved, owner.getId());
        jdbc.update("insert into contact_requests (property_id, requester_id, status) values (?, ?, 'approved')",
                stale, owner.getId());
        jdbc.update("insert into visits (property_id, visitor_id, slot, status) values (?, ?, now(), 'scheduled')",
                approved, owner.getId());
        jdbc.update("insert into visits (property_id, visitor_id, slot, status) values (?, ?, now(), 'completed')",
                approved, owner.getId());
        jdbc.update("insert into deals (id, property_id, deal, status) values (?, ?, 'rent', 'active')",
                UUID.randomUUID(), approved);
        jdbc.update("insert into deals (id, property_id, deal, status) values (?, ?, 'rent', 'closed')",
                UUID.randomUUID(), listing("Closed deal", PropertyStatus.APPROVED));
        ticket("legal", "open");
        ticket("rental", "open");
        ticket("rental", "in-progress");
    }

    private User user(String mobile, String role, String team, String document) {
        User u = new User(mobile, role);
        u.setName("Overview " + mobile.substring(6));
        u.setTeam(team);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        if (document != null) {
            jdbc.update("insert into back_office_permissions (user_id, permissions) values (?::uuid, ?::jsonb)",
                    saved.getId().toString(), document);
        }
        return saved;
    }

    private UUID listing(String title, String status) {
        Property p = new Property(owner, title, "rent", "apartment", 28000L, "Baner", "Pune");
        p.setStatus(status);
        return properties.saveAndFlush(p).getId();
    }

    private void ticket(String team, String status) {
        jdbc.update("""
                insert into tickets (id, subject, team, priority, status, created_at, updated_at)
                values (?, 'Probe', ?, 'medium', ?, now(), now())
                """, UUID.randomUUID(), team, status);
    }

    private String auth(User user) {
        return bearer(user);
    }

    private org.springframework.test.web.servlet.ResultActions read(String route, User caller) throws Exception {
        return mvc.perform(get(route).header(HttpHeaders.AUTHORIZATION, auth(caller)));
    }

    @Test
    @DisplayName("every dashboard figure is a whole-set count that matches the list it replaced")
    void dashboardCountsMatchTheOldReads() throws Exception {
        long pending = total(Routes.Moderation.ADMIN_PROPERTIES + "?status=pending&archived=false&size=1");
        long openTickets = total(Routes.Tickets.BASE + "?status=open&size=1");
        read(Routes.Admin.DASHBOARD, admin)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.listings.pending").value((int) pending))
                .andExpect(jsonPath("$.listings.pending").value(4))
                .andExpect(jsonPath("$.listings.flagged").value(1))
                // stale + staff-posted-unconfirmed; the confirmed staff listing and the archived one are out
                .andExpect(jsonPath("$.listings.followUp").value(2))
                .andExpect(jsonPath("$.listings.oldestPending", hasSize(4)))
                .andExpect(jsonPath("$.listings.oldestPending[0].title").value("Stale"))
                .andExpect(jsonPath("$.demand.newEnquiries").value(1))
                .andExpect(jsonPath("$.demand.scheduledVisits").value(1))
                .andExpect(jsonPath("$.demand.dealsInProgress").value(1))
                .andExpect(jsonPath("$.tickets.open").value((int) openTickets))
                .andExpect(jsonPath("$.tickets.open").value(2))
                .andExpect(jsonPath("$.tickets.latest", hasSize(3)))
                .andExpect(jsonPath("$.owners").value(1))
                .andExpect(jsonPath("$.kpis.revenue30d").isNumber())
                .andExpect(jsonPath("$.traffic.sessions30d").isNumber())
                .andExpect(jsonPath("$.sla.listingApproval.targetHours").isNumber());
    }

    @Test
    @DisplayName("a section the caller cannot read is absent, not empty")
    void dashboardRedactsPerAtom() throws Exception {
        User ticketsOnly = user("9877710003", Roles.Wire.STAFF, Teams.RENTAL,
                "[\"support\",\"desk:rental\"]");
        read(Routes.Admin.DASHBOARD, ticketsOnly)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tickets.open").value(1))
                .andExpect(jsonPath("$.kpis").doesNotExist())
                .andExpect(jsonPath("$.traffic").doesNotExist())
                .andExpect(jsonPath("$.sla").doesNotExist())
                .andExpect(jsonPath("$.listings").doesNotExist())
                .andExpect(jsonPath("$.demand.newEnquiries").value(1))
                .andExpect(jsonPath("$.owners").doesNotExist());

        User noTickets = user("9877710004", Roles.Wire.STAFF, Teams.RENTAL,
                "[\"analytics\",\"listingModeration\",\"desk:rental\"]");
        read(Routes.Admin.DASHBOARD, noTickets)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tickets").doesNotExist())
                .andExpect(jsonPath("$.listings.pending").value(4))
                .andExpect(jsonPath("$.kpis.revenue30d").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.demand").doesNotExist());
    }

    @Test
    @DisplayName("staff never see revenue; a staffer on no desk gets no ticket section")
    void staffGetNoRevenueAndNoDeskMeansNoTickets() throws Exception {
        User staff = user("9877710005", Roles.Wire.STAFF, Teams.RENTAL, "[\"analytics\",\"desk:rental\"]");
        read(Routes.Admin.DASHBOARD, staff)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.kpis.revenue30d").value(org.hamcrest.Matchers.nullValue()));

        User noDesk = user("9877710006", Roles.Wire.STAFF, null,
                "[\"support\"]");
        read(Routes.Admin.DASHBOARD, noDesk)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tickets").doesNotExist());
        read(Routes.Admin.BELL, noDesk)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.openTickets").doesNotExist());
    }

    @Test
    @DisplayName("a plain user cannot read either")
    void plainUsersAreRefused() throws Exception {
        read(Routes.Admin.DASHBOARD, owner).andExpect(status().isForbidden());
        read(Routes.Admin.BELL, owner).andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("bell totals equal the three standalone reads, with slim items")
    void bellTotalsMatchTheOldReads() throws Exception {
        long pending = total(Routes.Moderation.ADMIN_PROPERTIES + "?status=pending&archived=false&size=5");
        long open = total(Routes.Tickets.BASE + "?status=open&size=5");
        long replies = total(Routes.Moderation.ADMIN_PROPERTY_REVIEWS + "?size=5&unread=true");
        read(Routes.Admin.BELL, admin)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pendingListings.total").value((int) pending))
                .andExpect(jsonPath("$.pendingListings.items", hasSize(4)))
                .andExpect(jsonPath("$.pendingListings.items[0].title").exists())
                .andExpect(jsonPath("$.pendingListings.items[0].status").doesNotExist())
                .andExpect(jsonPath("$.openTickets.total").value((int) open))
                .andExpect(jsonPath("$.ownerReplies.total").value((int) replies));
    }

    @Test
    @DisplayName("the bell leaves out what the caller holds no atom for")
    void bellRedactsPerAtom() throws Exception {
        User ticketsOnly = user("9877710007", Roles.Wire.STAFF, Teams.RENTAL,
                "[\"support\",\"desk:rental\"]");
        read(Routes.Admin.BELL, ticketsOnly)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.openTickets.total").value(1))
                .andExpect(jsonPath("$.pendingListings").doesNotExist())
                .andExpect(jsonPath("$.ownerReplies").doesNotExist());

        User listingsOnly = user("9877710008", Roles.Wire.STAFF, Teams.RENTAL,
                "[\"listingModeration\",\"desk:rental\"]");
        read(Routes.Admin.BELL, listingsOnly)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pendingListings.total").value(4))
                .andExpect(jsonPath("$.openTickets").doesNotExist());
    }

    private long total(String route) throws Exception {
        String body = read(route, admin).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return com.jayway.jsonpath.JsonPath.<Number>read(body, "$.totalElements").longValue();
    }
}