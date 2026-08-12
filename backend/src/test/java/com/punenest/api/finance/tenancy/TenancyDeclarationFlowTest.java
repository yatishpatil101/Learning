package com.punenest.api.finance.tenancy;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The owner-confirmed half of review eligibility (D194).
 *
 * <p>The load-bearing tests are the two that describe what a confirmation is <em>worth</em>: a
 * pending declaration must not open the review door, and a stranger must not be able to close it.
 * Everything else here is plumbing. If those two ever go green with the guard removed, the feature
 * has become "anyone may claim they lived anywhere and then review it", which is strictly worse than
 * the dead client-side check it replaced — that one at least failed closed.
 *
 * <p>Each eligibility assertion is made by actually writing a review, not by reading a flag. The bug
 * this closes was precisely a flag that agreed with itself and with nothing else.
 */
class TenancyDeclarationFlowTest extends AbstractApiTest {

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired TenancyRepository tenancies;
    @Autowired TenancyDeclarationRepository declarations;

    // ---- helpers ----

    private User user(String mobile, String name) {
        User u = new User(mobile, "buyer");
        u.setName(name);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "2BHK in Wakad", "rent", "apartment", 22000L,
                "Wakad", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("900"));
        p.setStatus(PropertyStatus.APPROVED);
        return properties.saveAndFlush(p);
    }

    private String declarationsPath(Property p) {
        return "/properties/" + p.getId() + "/tenancy-declarations";
    }

    private String declare(User caller, Property p) throws Exception {
        String json = mvc.perform(post(declarationsPath(p))
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"livedFrom\":\"2024-01-01\",\"livedTo\":\"2025-06-30\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value(TenancyDeclarationStatuses.PENDING))
                .andReturn().getResponse().getContentAsString();
        return com.jayway.jsonpath.JsonPath.read(json, "$.id");
    }

    /** Eligibility, asked the only way that cannot lie: try to write the review. */
    private int reviewAttempt(User author, Property p) throws Exception {
        return mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rating\":4,\"body\":\"Lived here for eighteen months.\"}"))
                .andReturn().getResponse().getStatus();
    }

    // ---------------------------------------------------------------- the gate

    @Test
    @DisplayName("a pending declaration proves nothing — the review door stays shut")
    void pendingDeclarationDoesNotMakeAnyoneEligible() throws Exception {
        User owner = user("9833000001", "Nikhil Rane");
        User claimant = user("9833000002", "Sneha Kale");
        Property p = listing(owner);

        declare(claimant, p);

        // Unopposed is not the same as agreed. Without this, "declare" would be a self-service
        // eligibility button and the confirmation step would be decoration. 422, per
        // ReviewNotEligibleException: nothing the caller can be granted fixes it.
        assertThat(reviewAttempt(claimant, p)).isEqualTo(422);
    }

    @Test
    @DisplayName("the owner's confirmation is what opens the door, and it badges as a tenancy")
    void confirmedDeclarationMakesTheDeclarantEligible() throws Exception {
        User owner = user("9833000011", "Nikhil Rane");
        User claimant = user("9833000012", "Sneha Kale");
        Property p = listing(owner);
        String id = declare(claimant, p);

        mvc.perform(post("/tenancy-declarations/" + id + "/confirm")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(TenancyDeclarationStatuses.CONFIRMED))
                .andExpect(jsonPath("$.decidedAt").isNotEmpty());

        // `tenant`, not `visit`: a confirmed stay is a stay. The two sources of tenancy standing
        // are stored apart and read the same, which is the whole point of routing the declaration
        // through PropertyExperience rather than giving reviews a second door of their own.
        mvc.perform(post("/properties/" + p.getId() + "/reviews")
                        .header(HttpHeaders.AUTHORIZATION, bearer(claimant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rating\":4,\"body\":\"Lived here for eighteen months.\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.context").value("tenant"));
    }

    @Test
    @DisplayName("revoking a confirmation closes the door again")
    void revokedDeclarationStopsBeingEvidence() throws Exception {
        User owner = user("9833000021", "Nikhil Rane");
        User claimant = user("9833000022", "Sneha Kale");
        Property p = listing(owner);
        String id = declare(claimant, p);

        mvc.perform(post("/tenancy-declarations/" + id + "/confirm")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk());
        mvc.perform(post("/tenancy-declarations/" + id + "/revoke")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(TenancyDeclarationStatuses.REVOKED));

        assertThat(reviewAttempt(claimant, p)).isEqualTo(422);
        // Retained, not deleted: "claimed, agreed, withdrawn" is the trail an abuse report needs.
        assertThat(declarations.findByPropertyIdAndDeclarantId(p.getId(), claimant.getId()))
                .isPresent();
    }

    @Test
    @DisplayName("a stranger cannot confirm a claim about somebody else's flat, and gets a 404")
    void onlyTheListingOwnerMayDecide() throws Exception {
        User owner = user("9833000031", "Nikhil Rane");
        User claimant = user("9833000032", "Sneha Kale");
        User stranger = user("9833000033", "Passing Stranger");
        Property p = listing(owner);
        String id = declare(claimant, p);

        // Being a real, mobile-verified account is not the fact that matters. 404 and not 403,
        // so the id is never confirmed to exist to somebody with no business knowing it.
        mvc.perform(post("/tenancy-declarations/" + id + "/confirm")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());
        // Revoke is guarded by the same check and not merely by the same annotation — a stranger
        // who could withdraw a confirmation could silence a review they did not like.
        mvc.perform(post("/tenancy-declarations/" + id + "/revoke")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());
        // The claimant cannot wave their own claim through either.
        mvc.perform(post("/tenancy-declarations/" + id + "/confirm")
                        .header(HttpHeaders.AUTHORIZATION, bearer(claimant)))
                .andExpect(status().isNotFound());
        assertThat(reviewAttempt(claimant, p)).isEqualTo(422);
    }

    @Test
    @DisplayName("an owner rejects a claim they disagree with by revoking it while it is pending")
    void revokingAPendingClaimIsHowAnOwnerSaysNo() throws Exception {
        User owner = user("9833000091", "Nikhil Rane");
        User claimant = user("9833000092", "Sneha Kale");
        Property p = listing(owner);
        String id = declare(claimant, p);

        // There is no `declined` status, and this test is the reason that is defensible: rejecting
        // an unagreed claim and withdrawing an agreed one are the same act — the owner says this
        // person did not live here — and pending → revoked has to work for that to hold.
        mvc.perform(post("/tenancy-declarations/" + id + "/revoke")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(TenancyDeclarationStatuses.REVOKED));
        assertThat(reviewAttempt(claimant, p)).isEqualTo(422);

        // And the owner can change their mind back, which is what the Javadoc promises and what an
        // owner who tapped the wrong name in a list needs. The unique constraint means the claimant
        // cannot re-declare, so if this did not work the mistake would be permanent.
        mvc.perform(post("/tenancy-declarations/" + id + "/confirm")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(TenancyDeclarationStatuses.CONFIRMED));
        assertThat(reviewAttempt(claimant, p)).isEqualTo(201);
    }

    // ---------------------------------------------------------------- the reads

    @Test
    @DisplayName("the owner sees every claim on their listing; everyone else sees only their own")
    void listIsScopedByWhoIsAsking() throws Exception {
        User owner = user("9833000041", "Nikhil Rane");
        User first = user("9833000042", "Sneha Kale");
        User second = user("9833000043", "Rohit Jadhav");
        Property p = listing(owner);
        declare(first, p);
        declare(second, p);

        mvc.perform(get(declarationsPath(p)).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(2))
                // Newest first, so an owner working through an inbox meets the new claim, not the
                // one they have already read past.
                .andExpect(jsonPath("$.content[0].declarantName").value("Rohit Jadhav"))
                // The dates the claimant typed, echoed back — this is the entire basis on which an
                // owner recognises a former tenant, so a projection that dropped them would leave
                // the confirm button asking about a name and no stay.
                .andExpect(jsonPath("$.content[0].livedFrom").value("2024-01-01"))
                .andExpect(jsonPath("$.content[0].livedTo").value("2025-06-30"))
                .andExpect(jsonPath("$.content[0].decidedAt").doesNotExist())
                // The owner's view is where a leak would happen — it is the one that carries other
                // people's rows. Asserted on the whole key set rather than on a guessed field name,
                // because `declarantMobile` or a nested party object would slip past a check for
                // `mobile` while revealing exactly the thing the contact gate exists to hold.
                .andExpect(jsonPath("$.content[0].*", hasSize(8)))
                .andExpect(jsonPath("$.content[0].mobile").doesNotExist())
                .andExpect(jsonPath("$.content[0].declarantMobile").doesNotExist());

        mvc.perform(get(declarationsPath(p)).header(HttpHeaders.AUTHORIZATION, bearer(first)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].declarantId").value(first.getId().toString()))
                // A name so the owner can recognise a former tenant, and deliberately no mobile:
                // a number here would let anybody mint a contact reveal by asserting a tenancy.
                .andExpect(jsonPath("$.content[0].declarantName").value("Sneha Kale"))
                .andExpect(jsonPath("$.content[0].*", hasSize(8)));

        // A stranger's page is empty, not the owner's inbox with a filter the client could undo.
        mvc.perform(get(declarationsPath(p))
                        .header(HttpHeaders.AUTHORIZATION, bearer(user("9833000044", "Nobody"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0));

        // An unknown listing is a 404 on the read as well as on the write: "no claims" would be a
        // lie about a flat that does not exist.
        mvc.perform(get("/properties/" + UUID.randomUUID() + "/tenancy-declarations")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("a deleted claimant leaves the claim readable rather than breaking the inbox")
    void anAbsentDeclarantProjectsAnEmptyName() throws Exception {
        User owner = user("9833000081", "Nikhil Rane");
        User claimant = user("9833000082", "Sneha Kale");
        Property p = listing(owner);
        declare(claimant, p);

        // Not deleted through a route — there isn't one. The point is the projection's null branch:
        // the owner's inbox must still render, because one vanished account is not a reason the
        // other claims on the listing become undecidable.
        assertThat(TenancyMapper.toDto(
                declarations.findByPropertyIdAndDeclarantId(p.getId(), claimant.getId())
                        .orElseThrow(), null).declarantName())
                .isEmpty();
    }

    // ---------------------------------------------------------------- refusals

    @Test
    @DisplayName("an owner cannot be their own tenant, and nobody may claim the same stay twice")
    void declarationRefusals() throws Exception {
        User owner = user("9833000051", "Nikhil Rane");
        User claimant = user("9833000052", "Sneha Kale");
        Property p = listing(owner);

        // The messages are asserted, not just the status. All three refusals here are 409, and an
        // implementation that collapsed them into one sentence would pass a status-only test while
        // telling an owner they had "already declared" a stay they were never able to declare.
        mvc.perform(post(declarationsPath(p))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message")
                        .value("You cannot declare a tenancy on your own listing"));

        declare(claimant, p);
        mvc.perform(post(declarationsPath(p))
                        .header(HttpHeaders.AUTHORIZATION, bearer(claimant))
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message")
                        .value("You have already declared a stay at this listing"));

        // An unknown listing is a 404 before any of that: we cannot say who owns what does not
        // exist, and answering 409 would be inventing a conflict with nothing.
        mvc.perform(post("/properties/" + UUID.randomUUID() + "/tenancy-declarations")
                        .header(HttpHeaders.AUTHORIZATION, bearer(claimant))
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("a brokered tenancy already proves the stay, so declaring one on top is refused")
    void brokeredTenancyMakesADeclarationPointless() throws Exception {
        User owner = user("9833000061", "Nikhil Rane");
        User tenant = user("9833000062", "Sneha Kale");
        Property p = listing(owner);
        tenancies.saveAndFlush(new Tenancy(p.getId(), tenant.getId(), owner.getId()));

        // Not "invalid" — pointless. The claim would sit pending forever behind a fact the
        // platform already holds, and the tenant is already eligible without it.
        mvc.perform(post(declarationsPath(p))
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message")
                        .value("Your tenancy on this listing is already on record"));
        assertThat(reviewAttempt(tenant, p)).isEqualTo(201);
    }

    @Test
    @DisplayName("a stay that ends before it starts is a typo, and is answered as one")
    void reversedDatesAreRejectedAsBadInput() throws Exception {
        User owner = user("9833000071", "Nikhil Rane");
        User claimant = user("9833000072", "Sneha Kale");
        Property p = listing(owner);

        // 422 and not 409: V68's CHECK would catch this too, but only as an integrity violation the
        // caller reads as "that request conflicts with existing data" — a sentence that says nothing
        // about the two dates they just typed. The field key is pinned as well as the status,
        // because a `fields[]` entry naming nothing useful is the failure mode worth catching.
        mvc.perform(post(declarationsPath(p))
                        .header(HttpHeaders.AUTHORIZATION, bearer(claimant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"livedFrom\":\"2025-06-30\",\"livedTo\":\"2024-01-01\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[0].field").value("dateRangeOrdered"));

        // And nothing was stored, so the slot is still free for the corrected claim.
        mvc.perform(get(declarationsPath(p)).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.content.length()").value(0));
    }
}
