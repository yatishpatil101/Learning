package com.draazy.api.leads.photos;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

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

    private String decideUrl(PhotoRequest row) {
        return Routes.MePhotoRequests.BY_ID.replace("{reqId}", row.getId().toString());
    }

    /**
     * The owner's PATCH, carrying the V118 decision body.
     *
     * <p>Hand-rolled JSON rather than a serialised record: the body is the wire contract, and a
     * helper that built it from {@link MePhotoRequestsController.DecisionRequest} would keep passing
     * through a rename of the field, which is precisely the break a client would feel.
     */
    private MockHttpServletRequestBuilder decide(String url, User actor, String decision) {
        return patch(url)
                .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"" + decision + "\"}");
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
        mvc.perform(decide(decideUrl(row), owner, PhotoRequestStatuses.RESOLVED))
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
        mvc.perform(decide(decideUrl(row), owner, PhotoRequestStatuses.RESOLVED));

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
        String url = decideUrl(row);

        mvc.perform(decide(url, rohan, PhotoRequestStatuses.RESOLVED))
                .andExpect(status().isNotFound());
        assertThat(photoRequests.findById(row.getId()).orElseThrow().getStatus())
                .isEqualTo(PhotoRequestStatuses.PENDING);

        // the same id, from the real owner, succeeds — so the 404 above was the scope, not the id
        mvc.perform(decide(url, meera, PhotoRequestStatuses.RESOLVED))
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
        String url = decideUrl(row);

        mvc.perform(decide(url, buyer, PhotoRequestStatuses.RESOLVED))
                .andExpect(status().isNotFound());
        assertThat(photoRequests.findById(row.getId()).orElseThrow().getStatus())
                .isEqualTo(PhotoRequestStatuses.PENDING);
        assertThat(photoRequests.findById(row.getId()).orElseThrow().getDecidedAt()).isNull();

        // the checker, and only the checker, can close it
        mvc.perform(decide(url, owner, PhotoRequestStatuses.RESOLVED))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(PhotoRequestStatuses.RESOLVED));
    }

    /** Answering twice keeps the original {@code decidedAt} — "when did the owner respond" cannot drift. */
    @Test
    void decidingTwice_doesNotMoveDecidedAt() throws Exception {
        User owner = user("9000000112", "owner", "Rohan Kulkarni");
        User buyer = user(BUYER_MOBILE, "buyer", "Asha Patil");
        Property p = listing(owner, "2 BHK in Kothrud");
        mvc.perform(post(askUrl(p)).header(HttpHeaders.AUTHORIZATION, bearer(buyer)));
        PhotoRequest row = photoRequests.findAll().get(0);
        String url = decideUrl(row);

        mvc.perform(decide(url, owner, PhotoRequestStatuses.RESOLVED));
        var first = photoRequests.findById(row.getId()).orElseThrow().getDecidedAt();
        assertThat(first).isNotNull();

        mvc.perform(decide(url, owner, PhotoRequestStatuses.RESOLVED))
                .andExpect(status().isOk());
        assertThat(photoRequests.findById(row.getId()).orElseThrow().getDecidedAt())
                .isEqualTo(first);
    }

    // ---------------- the `declined` exit (V118) ----------------

    /**
     * The whole point of V118: an owner with no more photos can close the loop honestly, and the
     * badge clears without them claiming a satisfaction that never happened.
     *
     * <p>The badge assertions bracket the action — {@code 1} before, {@code 0} after — because
     * asserting only the {@code 0} would pass identically against a count that was always zero, i.e.
     * against an inbox wired to the wrong owner.
     */
    @Test
    void decliningAPendingRequest_closesItAndClearsTheBadge() throws Exception {
        User owner = user("9000000120", "owner", "Rohan Kulkarni");
        User buyer = user(BUYER_MOBILE, "buyer", "Asha Patil");
        Property p = listing(owner, "2 BHK in Kothrud");
        mvc.perform(post(askUrl(p)).header(HttpHeaders.AUTHORIZATION, bearer(buyer)));
        PhotoRequest row = photoRequests.findAll().get(0);

        mvc.perform(get(Routes.MePhotoRequests.PENDING_COUNT)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.pending").value(1));

        mvc.perform(decide(decideUrl(row), owner, PhotoRequestStatuses.DECLINED))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(PhotoRequestStatuses.DECLINED))
                .andExpect(jsonPath("$.decidedAt").isNotEmpty());

        mvc.perform(get(Routes.MePhotoRequests.PENDING_COUNT)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.pending").value(0));
    }

    /**
     * A decision is terminal in both directions: a decline cannot be converted into a
     * {@code resolved}, and a resolution cannot be walked back into a decline.
     *
     * <p>Without this an owner could clear a badge by declining and then quietly re-mark the row
     * satisfied, and "when did the owner respond" would move with it. The pending-anchor at the top
     * is what makes the two no-ops meaningful — it proves the row was reachable and answerable, so
     * the unchanged status afterwards is the guard rather than a PATCH that never landed.
     *
     * <p><strong>Parameterised because the guard is symmetric and the sentence above says so.</strong>
     * {@code PhotoRequest#decide} rejects on {@code isTerminal(this.status)}, which does not care
     * which terminal state it is looking at — but a later change that special-cased {@code resolved}
     * (to let an owner "correct" a mis-tap, say) would leave a single-direction test green while
     * reopening exactly the badge-laundering path this exists to close.
     */
    @ParameterizedTest(name = "{0} cannot be flipped to {1}")
    @CsvSource({"declined,resolved", "resolved,declined"})
    void aDecidedRequest_cannotBeFlippedToTheOtherDecision(String first, String second)
            throws Exception {
        User owner = user("9000000121", "owner", "Rohan Kulkarni");
        User buyer = user(BUYER_MOBILE, "buyer", "Asha Patil");
        Property p = listing(owner, "2 BHK in Kothrud");
        mvc.perform(post(askUrl(p)).header(HttpHeaders.AUTHORIZATION, bearer(buyer)));
        PhotoRequest row = photoRequests.findAll().get(0);
        String url = decideUrl(row);
        assertThat(photoRequests.findById(row.getId()).orElseThrow().getStatus())
                .isEqualTo(PhotoRequestStatuses.PENDING);

        mvc.perform(decide(url, owner, first)).andExpect(status().isOk());
        var decidedAt = photoRequests.findById(row.getId()).orElseThrow().getDecidedAt();

        mvc.perform(decide(url, owner, second))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(first));
        assertThat(photoRequests.findById(row.getId()).orElseThrow().getDecidedAt())
                .isEqualTo(decidedAt);
    }

    /**
     * A declined request still blocks a re-ask, for the same reason a resolved one does — V118 left
     * {@code uq_photo_requests_requester_property} unscoped by status on purpose. Scoping it to
     * {@code pending} would turn "no" into a rate limit the buyer could out-wait.
     *
     * <p>The row-count assertion is what carries this; {@code created=false} alone would still pass
     * against a service that inserted a second row and mislabelled the response.
     */
    @Test
    void askingAgainAfterTheOwnerDeclined_isStillADuplicate() throws Exception {
        User owner = user("9000000122", "owner", "Rohan Kulkarni");
        User buyer = user(BUYER_MOBILE, "buyer", "Asha Patil");
        Property p = listing(owner, "2 BHK in Kothrud");
        mvc.perform(post(askUrl(p)).header(HttpHeaders.AUTHORIZATION, bearer(buyer)));
        PhotoRequest row = photoRequests.findAll().get(0);
        mvc.perform(decide(decideUrl(row), owner, PhotoRequestStatuses.DECLINED))
                .andExpect(status().isOk());

        mvc.perform(post(askUrl(p)).header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.created").value(false))
                .andExpect(jsonPath("$.request.status").value(PhotoRequestStatuses.DECLINED));

        assertThat(photoRequests.findAll()).hasSize(1);
        assertThat(photoRequests.findById(row.getId()).orElseThrow().getStatus())
                .isEqualTo(PhotoRequestStatuses.DECLINED);
    }

    /**
     * A decision the domain does not have is a {@code 400} naming the two that work, not a {@code 500}
     * from the V118 CHECK and not a {@code 200} that silently did nothing.
     *
     * <p>{@code pending} is the interesting half. It is a real status, so it survives the CHECK and
     * would be accepted by any guard written as "is this a known status" — and the entity ignores it,
     * so the caller would get a {@code 200} describing an un-answering that did not happen. The
     * arbitrary-garbage case is the easy one; this is the one the guard exists for.
     */
    @Test
    void anUnknownDecision_is400_andLeavesTheRowPending() throws Exception {
        User owner = user("9000000123", "owner", "Rohan Kulkarni");
        User buyer = user(BUYER_MOBILE, "buyer", "Asha Patil");
        Property p = listing(owner, "2 BHK in Kothrud");
        mvc.perform(post(askUrl(p)).header(HttpHeaders.AUTHORIZATION, bearer(buyer)));
        PhotoRequest row = photoRequests.findAll().get(0);
        String url = decideUrl(row);

        mvc.perform(decide(url, owner, "approved")).andExpect(status().isBadRequest());
        mvc.perform(decide(url, owner, PhotoRequestStatuses.PENDING))
                .andExpect(status().isBadRequest());
        assertThat(photoRequests.findById(row.getId()).orElseThrow().getStatus())
                .isEqualTo(PhotoRequestStatuses.PENDING);

        // the same route, with a legal decision, works — so the 400s were the word, not the URL
        mvc.perform(decide(url, owner, PhotoRequestStatuses.DECLINED)).andExpect(status().isOk());
    }

    // ---------------- the buyer is told ----------------

    /**
     * Answering tells the buyer. Until it did, this endpoint moved a badge on the owner's screen and
     * nothing else — the person who asked the question was the only party to it who could not
     * observe the answer.
     *
     * <p>The link is asserted against the <em>slug</em>, which is why this test sets one explicitly.
     * A notification pointing at {@code /property/&lt;uuid&gt;} would still open the right page, so a
     * test that only checked the row existed would pass on either — and the buyer would land on a
     * second address for a listing they first reached by slug.
     *
     * <p>The owner's own inbox is asserted empty for the reason the contact gate asserts it: nobody
     * needs telling about a decision they just made, and a notifier keyed on the wrong side of the
     * pair is a mistake that otherwise reads as success on the only inbox anyone checks.
     */
    @Test
    void resolvingARequest_tellsTheBuyerPhotosArrived_andTellsTheOwnerNothing() throws Exception {
        User owner = user("9000000130", "owner", "Rohan Kulkarni");
        User buyer = user(BUYER_MOBILE, "buyer", "Asha Patil");
        Property p = listing(owner, "2 BHK in Kothrud", "two-bhk-kothrud-resolved");
        mvc.perform(post(askUrl(p)).header(HttpHeaders.AUTHORIZATION, bearer(buyer)));
        PhotoRequest row = photoRequests.findAll().get(0);

        mvc.perform(decide(decideUrl(row), owner, PhotoRequestStatuses.RESOLVED))
                .andExpect(status().isOk());

        List<Map<String, Object>> notes = notificationsFor(buyer);
        assertThat(notes).hasSize(1);
        assertThat(notes.getFirst().get("type")).isEqualTo("photo.added");
        assertThat(notes.getFirst().get("link")).isEqualTo("/property/two-bhk-kothrud-resolved");
        assertThat((String) notes.getFirst().get("body")).contains("2 BHK in Kothrud");
        assertThat(notificationsFor(owner)).isEmpty();
    }

    /**
     * A decline is announced too — the one place this domain parts company with the contact gate,
     * which stays silent on a decline because "a terminal no is not news the buyer needs pushed at
     * them".
     *
     * <p>That reasoning does not survive the move. A buyer refused a phone number can read the answer
     * off the listing, because the number is still hidden. A buyer whose photo request is declined
     * has nowhere to look: the gallery simply never grows, which is indistinguishable from an owner
     * who has not got round to it. Silence would leave them waiting on photos that are never coming.
     *
     * <p>Asserted on the type rather than merely on "a notification exists", so the two outcomes
     * cannot collapse into one another — a service that announced {@code photo.added} for both would
     * satisfy any count-only check while telling the buyer the opposite of the truth.
     */
    @Test
    void decliningARequest_tellsTheBuyerNoMoreAreComing() throws Exception {
        User owner = user("9000000131", "owner", "Rohan Kulkarni");
        User buyer = user(BUYER_MOBILE, "buyer", "Asha Patil");
        Property p = listing(owner, "2 BHK in Kothrud", "two-bhk-kothrud-declined");
        mvc.perform(post(askUrl(p)).header(HttpHeaders.AUTHORIZATION, bearer(buyer)));
        PhotoRequest row = photoRequests.findAll().get(0);

        mvc.perform(decide(decideUrl(row), owner, PhotoRequestStatuses.DECLINED))
                .andExpect(status().isOk());

        List<Map<String, Object>> notes = notificationsFor(buyer);
        assertThat(notes).hasSize(1);
        assertThat(notes.getFirst().get("type")).isEqualTo("photo.declined");
        assertThat(notes.getFirst().get("link")).isEqualTo("/property/two-bhk-kothrud-declined");
        assertThat(notificationsFor(owner)).isEmpty();
    }

    /**
     * Nothing is announced for a decision the domain refused, and nothing for a request the caller
     * does not own. Both are rejections, and a notify placed above either guard would tell a buyer
     * their photos had arrived on the strength of a call that changed no row at all — the worst
     * available failure, because the notification is the only surface the buyer has.
     *
     * <p><strong>The legal decide at the end is what stops this being vacuous.</strong> Every
     * assertion before it is an absence, and absences pass trivially against a notifier that is
     * simply broken, or a query pointed at the wrong user. Proving the same buyer, through the same
     * helper, does receive one the moment a decision succeeds is what makes the earlier silences
     * mean "suppressed" rather than "never works".
     */
    @Test
    void aRefusedDecision_announcesNothing() throws Exception {
        User owner = user("9000000132", "owner", "Rohan Kulkarni");
        User stranger = user("9000000133", "owner", "Not The Owner");
        User buyer = user(BUYER_MOBILE, "buyer", "Asha Patil");
        Property p = listing(owner, "2 BHK in Kothrud", "two-bhk-kothrud-refused");
        mvc.perform(post(askUrl(p)).header(HttpHeaders.AUTHORIZATION, bearer(buyer)));
        PhotoRequest row = photoRequests.findAll().get(0);
        String url = decideUrl(row);

        mvc.perform(decide(url, owner, "approved")).andExpect(status().isBadRequest());
        assertThat(notificationsFor(buyer)).isEmpty();

        mvc.perform(decide(url, stranger, PhotoRequestStatuses.RESOLVED))
                .andExpect(status().isNotFound());
        assertThat(notificationsFor(buyer)).isEmpty();

        // The positive anchor: the same buyer, the same query, does hear about a decision that lands.
        mvc.perform(decide(url, owner, PhotoRequestStatuses.RESOLVED)).andExpect(status().isOk());
        assertThat(notificationsFor(buyer)).hasSize(1);
    }

    /** Read straight from the table: the notification is a side effect, not part of any response. */
    private List<Map<String, Object>> notificationsFor(User user) {
        return jdbc.queryForList(
                "select type, title, body, link from notifications where user_id = ?", user.getId());
    }
}
