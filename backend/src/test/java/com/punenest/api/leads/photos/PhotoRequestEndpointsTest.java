package com.punenest.api.leads.photos;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
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
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

/**
 * Contract + behaviour proof for the photo-request signal (V117), driven through the real filter
 * chain against the live Flyway'd Postgres.
 *
 * <p>Organised around the invariants rather than the endpoints, because the invariants are what a
 * regression would break: de-dupe, strict owner-scoping, and — the one with teeth — that the
 * requester's mobile is never revealed. That last one matters more here than anywhere else in
 * {@code leads}: this is the only lead endpoint with no badge and no owner consent in front of it, so
 * if it ever emitted a raw number it would be a way to harvest buyer contacts that bypasses the
 * contact gate completely.
 */
class PhotoRequestEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    PhotoRequestRepository photoRequests;

    private static final String BUYER_MOBILE = "9000000001";

    private User user(String mobile, String role, String name) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /**
     * The slug is set explicitly because nothing in the entity populates it — it is assigned by the
     * listing service, which this test does not go through. Left null, the {@code propertySlug}
     * assertion below would be {@code value(null)}, which passes just as happily against a mapper
     * that never sets the field at all.
     */
    private Property listing(User owner, String title, String slug) {
        Property p = new Property(owner, title, "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        p.setSlug(slug);
        return properties.saveAndFlush(p);
    }

    /** For the tests that do not care what the slug is, only that the row exists. */
    private Property listing(User owner, String title) {
        return listing(owner, title, "listing-" + UUID.randomUUID());
    }

    private String askUrl(Property p) {
        return Routes.PropertyPhotoRequests.BASE.replace("{id}", p.getId().toString());
    }

    // ---------------- POST /properties/{id}/photo-requests ----------------

    /**
     * The de-dupe, proven on the row count rather than on the response alone. Asserting only
     * {@code created=false} would still pass if the service inserted a second row and merely
     * mislabelled it, which is the failure that actually matters — a double-tap inflating an owner's
     * demand count is the one number this feature produces.
     */
    @Test
    void askingTwice_returnsTheOriginalRow_andInsertsNothingTheSecondTime() throws Exception {
        User owner = user("9000000100", "owner", "Rohan Kulkarni");
        User buyer = user(BUYER_MOBILE, "buyer", "Asha Patil");
        Property p = listing(owner, "2 BHK in Kothrud");

        mvc.perform(post(askUrl(p)).header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.created").value(true))
                .andExpect(jsonPath("$.request.status").value(PhotoRequestStatuses.PENDING));

        mvc.perform(post(askUrl(p)).header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.created").value(false));

        assertThat(photoRequests.findAll()).hasSize(1);
    }

    /**
     * A resolved request still blocks a re-ask. Without this the same buyer could re-nag an owner
     * every time they added photos, and the count would stop meaning "distinct people who wanted
     * this" — which is the only thing it is good for.
     */
    @Test
    void askingAgainAfterTheOwnerResolved_isStillADuplicate() throws Exception {
        User owner = user("9000000101", "owner", "Rohan Kulkarni");
        User buyer = user(BUYER_MOBILE, "buyer", "Asha Patil");
        Property p = listing(owner, "2 BHK in Kothrud");

        mvc.perform(post(askUrl(p)).header(HttpHeaders.AUTHORIZATION, bearer(buyer)));
        PhotoRequest row = photoRequests.findAll().get(0);
        mvc.perform(patch(Routes.MePhotoRequests.BY_ID.replace("{reqId}", row.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(PhotoRequestStatuses.RESOLVED));

        mvc.perform(post(askUrl(p)).header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(jsonPath("$.created").value(false));
        assertThat(photoRequests.findAll()).hasSize(1);
    }

    /** An owner cannot manufacture interest in their own listing. */
    @Test
    void anOwnerAskingForPhotosOfTheirOwnListing_is400_andWritesNothing() throws Exception {
        User owner = user("9000000102", "owner", "Rohan Kulkarni");
        Property p = listing(owner, "2 BHK in Kothrud");

        mvc.perform(post(askUrl(p)).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isBadRequest());

        assertThat(photoRequests.findAll()).isEmpty();
    }

    /** Sign-in is the gate, so an anonymous caller is turned away before any row exists. */
    @Test
    void anAnonymousCaller_cannotAsk() throws Exception {
        User owner = user("9000000103", "owner", "Rohan Kulkarni");
        Property p = listing(owner, "2 BHK in Kothrud");

        mvc.perform(post(askUrl(p))).andExpect(status().isUnauthorized());

        assertThat(photoRequests.findAll()).isEmpty();
    }

    // ---------------- GET /me/photo-requests ----------------

    /**
     * The security claim, and the reason this domain exists as its own type.
     *
     * <p>Anchored on the name first: an assertion that reads "the mobile is not the raw one" passes
     * trivially against an empty inbox or a null party, which is exactly the shape of vacuous
     * absence test that lets a leak ship. The name proves the requester block rendered at all;
     * only then does the masked-mobile claim mean anything.
     */
    @Test
    void theOwnerSeesWhoAsked_butNeverTheirRealMobile() throws Exception {
        User owner = user("9000000104", "owner", "Rohan Kulkarni");
        User buyer = user(BUYER_MOBILE, "buyer", "Asha Patil");
        Property p = listing(owner, "2 BHK in Kothrud", "2-bhk-kothrud-pune");
        mvc.perform(post(askUrl(p)).header(HttpHeaders.AUTHORIZATION, bearer(buyer)));

        mvc.perform(get(Routes.MePhotoRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                // positive anchors: the row and the requester block are really there
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].requester.name").value("Asha Patil"))
                .andExpect(jsonPath("$.content[0].propertyTitle").value("2 BHK in Kothrud"))
                .andExpect(jsonPath("$.content[0].propertySlug").value("2-bhk-kothrud-pune"))
                // ...and only now, the claim
                .andExpect(jsonPath("$.content[0].requester.mobile").value("90XXXXX001"));
    }

    /**
     * Owner-scoping, proven with an adversarial row.
     *
     * <p>The request against the <em>other</em> owner's listing is the whole test: it is a real,
     * pending, otherwise-visible row, so "Rohan's inbox is empty" can only be true because the scope
     * held. Asserting emptiness without seeding it would pass against a service that returned nothing
     * to anybody. The second half — that Meera <em>does</em> see it — is what rules that out.
     */
    @Test
    void anOwnerSeesOnlyRequestsAgainstTheirOwnListings() throws Exception {
        User rohan = user("9000000105", "owner", "Rohan Kulkarni");
        User meera = user("9000000106", "owner", "Meera Joshi");
        User buyer = user(BUYER_MOBILE, "buyer", "Asha Patil");
        listing(rohan, "Rohan's 2 BHK");
        Property meeras = listing(meera, "Meera's 3 BHK");

        mvc.perform(post(askUrl(meeras)).header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(jsonPath("$.created").value(true));

        mvc.perform(get(Routes.MePhotoRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(rohan)))
                .andExpect(jsonPath("$.content.length()").value(0));

        mvc.perform(get(Routes.MePhotoRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(meera)))
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].propertyTitle").value("Meera's 3 BHK"));
    }

    /** An owner with no listings gets their own empty inbox, not everyone else's. */
    @Test
    void anOwnerWithNoListings_getsAnEmptyInbox() throws Exception {
        User owner = user("9000000107", "owner", "Rohan Kulkarni");
        User stranger = user("9000000108", "owner", "Meera Joshi");
        User buyer = user(BUYER_MOBILE, "buyer", "Asha Patil");
        Property p = listing(stranger, "Meera's 3 BHK");
        mvc.perform(post(askUrl(p)).header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(jsonPath("$.created").value(true));

        mvc.perform(get(Routes.MePhotoRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.content.length()").value(0));
    }

    // ---------------- GET /me/photo-requests/pending-count ----------------

    /** The badge counts pending only, and drops when one is resolved. */
    @Test
    void thePendingCount_tracksResolution() throws Exception {
        User owner = user("9000000109", "owner", "Rohan Kulkarni");
        User a = user("9000000201", "buyer", "Asha Patil");
        User b = user("9000000202", "buyer", "Sunil More");
        Property p = listing(owner, "2 BHK in Kothrud");
        mvc.perform(post(askUrl(p)).header(HttpHeaders.AUTHORIZATION, bearer(a)));
        mvc.perform(post(askUrl(p)).header(HttpHeaders.AUTHORIZATION, bearer(b)));

        mvc.perform(get(Routes.MePhotoRequests.PENDING_COUNT)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.pending").value(2));

        PhotoRequest row = photoRequests.findAll().get(0);
        mvc.perform(patch(Routes.MePhotoRequests.BY_ID.replace("{reqId}", row.getId().toString()))
                .header(HttpHeaders.AUTHORIZATION, bearer(owner)));

        mvc.perform(get(Routes.MePhotoRequests.PENDING_COUNT)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.pending").value(1));
    }

    // ---------------- PATCH /me/photo-requests/{reqId} ----------------

    /**
     * Resolving someone else's row is a {@code 404}, not a {@code 403} — a 403 would confirm the id
     * exists, which is itself a leak. Paired with a proof that the row really was resolvable, so the
     * 404 cannot be coming from the id simply being unknown.
     */
    @Test
    void resolvingAForeignRequest_is404_andLeavesItPending() throws Exception {
        User meera = user("9000000110", "owner", "Meera Joshi");
        User rohan = user("9000000111", "owner", "Rohan Kulkarni");
        User buyer = user(BUYER_MOBILE, "buyer", "Asha Patil");
        Property meeras = listing(meera, "Meera's 3 BHK");
        mvc.perform(post(askUrl(meeras)).header(HttpHeaders.AUTHORIZATION, bearer(buyer)));
        PhotoRequest row = photoRequests.findAll().get(0);
        String url = Routes.MePhotoRequests.BY_ID.replace("{reqId}", row.getId().toString());

        mvc.perform(patch(url).header(HttpHeaders.AUTHORIZATION, bearer(rohan)))
                .andExpect(status().isNotFound());
        assertThat(photoRequests.findById(row.getId()).orElseThrow().getStatus())
                .isEqualTo(PhotoRequestStatuses.PENDING);

        // the same id, from the real owner, succeeds — so the 404 above was the scope, not the id
        mvc.perform(patch(url).header(HttpHeaders.AUTHORIZATION, bearer(meera)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(PhotoRequestStatuses.RESOLVED));
    }

    /**
     * Maker-checker separation, which is the invariant the two tests either side of this one do
     * <em>not</em> cover.
     *
     * <p>{@link #anOwnerAskingForPhotosOfTheirOwnListing_is400_andWritesNothing} proves the checker
     * cannot be the maker. {@link #resolvingAForeignRequest_is404_andLeavesItPending} proves one
     * owner cannot reach another owner's rows. Neither proves the case that actually worries a
     * maker-checker design: <strong>the maker closing their own request</strong>. A buyer who could
     * PATCH their own row would be marking their own ask satisfied, and the owner's badge would drop
     * without the owner ever doing anything.
     *
     * <p>It is a {@code 404} rather than a {@code 403} for the same reason as the foreign-owner case:
     * a 403 confirms the id exists. The owner-succeeds half is the positive anchor — without it this
     * passes against a route that 404s for everyone.
     */
    @Test
    void theRequester_cannotResolveTheirOwnRequest() throws Exception {
        User owner = user("9000000113", "owner", "Rohan Kulkarni");
        User buyer = user(BUYER_MOBILE, "buyer", "Asha Patil");
        Property p = listing(owner, "2 BHK in Kothrud");
        mvc.perform(post(askUrl(p)).header(HttpHeaders.AUTHORIZATION, bearer(buyer)));
        PhotoRequest row = photoRequests.findAll().get(0);
        String url = Routes.MePhotoRequests.BY_ID.replace("{reqId}", row.getId().toString());

        mvc.perform(patch(url).header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isNotFound());
        assertThat(photoRequests.findById(row.getId()).orElseThrow().getStatus())
                .isEqualTo(PhotoRequestStatuses.PENDING);
        assertThat(photoRequests.findById(row.getId()).orElseThrow().getResolvedAt()).isNull();

        // the checker, and only the checker, can close it
        mvc.perform(patch(url).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(PhotoRequestStatuses.RESOLVED));
    }

    /** Resolving twice keeps the original {@code resolvedAt} — "when did the owner respond" cannot drift. */
    @Test
    void resolvingTwice_doesNotMoveResolvedAt() throws Exception {
        User owner = user("9000000112", "owner", "Rohan Kulkarni");
        User buyer = user(BUYER_MOBILE, "buyer", "Asha Patil");
        Property p = listing(owner, "2 BHK in Kothrud");
        mvc.perform(post(askUrl(p)).header(HttpHeaders.AUTHORIZATION, bearer(buyer)));
        PhotoRequest row = photoRequests.findAll().get(0);
        String url = Routes.MePhotoRequests.BY_ID.replace("{reqId}", row.getId().toString());

        mvc.perform(patch(url).header(HttpHeaders.AUTHORIZATION, bearer(owner)));
        var first = photoRequests.findById(row.getId()).orElseThrow().getResolvedAt();
        assertThat(first).isNotNull();

        mvc.perform(patch(url).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk());
        assertThat(photoRequests.findById(row.getId()).orElseThrow().getResolvedAt())
                .isEqualTo(first);
    }
}
