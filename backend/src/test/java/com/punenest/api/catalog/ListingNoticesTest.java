package com.punenest.api.catalog;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.billing.plan.TestPlanGrants;
import com.punenest.api.catalog.listing.ListingDuplicateProbe;
import com.punenest.api.catalog.property.AddressKey;
import com.punenest.api.catalog.property.Furnishing;
import com.punenest.api.catalog.property.MeterKey;
import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * What the server now says for itself when a listing is edited or looks like somebody else's (D218).
 *
 * <p>Both of these used to happen in the browser. The re-review explanation was composed in
 * {@code list-property/submit.js} and written to localStorage, so the sentence explaining why an
 * owner's listing had gone dark existed only on the machine that made the edit; the duplicate
 * warning was written the same way, addressed to an ops desk that could not read it. Neither was a
 * feature so much as a description of one.
 *
 * <p>The assertions here are therefore about <em>who is talking</em> as much as about what is said.
 * A note the platform writes must come back attributed to {@code ops} — the wire derives {@code from}
 * by comparing the message's sender to the listing owner, and a system note has no sender at all —
 * because a note attributed to the owner would count as already-read from their side and never raise
 * the badge that makes them look.
 */
@DisplayName("Listing writes — server-authored re-review notes and duplicate flags")
class ListingNoticesTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    ListingDuplicateProbe probe;
    @Autowired
    com.punenest.api.common.access.BackOfficeGrantRepository grants;
    @Autowired
    TestPlanGrants plans;

    /** Audit rows are written {@code REQUIRES_NEW} and therefore survive this test's rollback. */
    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User owner(String mobile) {
        return user(mobile, Roles.Wire.OWNER);
    }

    /**
     * A moderator with the ordinary staff baseline, which includes {@code properties:read} — the
     * grant {@code PropertyVerificationService} now reads before rendering staff-only notes. See
     * {@link #aStaffAccountWithoutTheGrantIsNotAChecker} for the account that has the role and not
     * the grant.
     */
    private User staff(String mobile) {
        return user(mobile, Roles.Wire.STAFF);
    }

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("User " + mobile);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    /** A create body with only the fields these tests care about; everything else takes its default. */
    private static String body(String meter, String address) {
        return """
                {"title":"2BHK in Kothrud","deal":"rent","propertyType":"apartment","price":32000,
                 "bhk":2,"locality":"Kothrud","city":"Pune","floor":4
                 %s %s}
                """.formatted(
                meter == null ? "" : ",\"electricityMeterNo\":\"" + meter + "\"",
                address == null ? "" : ",\"address\":\"" + address + "\"");
    }

    private UUID create(String token, String meter, String address) throws Exception {
        String json = mvc.perform(post("/me/listings").header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON).content(body(meter, address)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(com.jayway.jsonpath.JsonPath.read(json, "$.id"));
    }

    /* The photo arm's fixtures, chosen so that each pair isolates one step of the lookup.
     *
     * BASE and NEAR differ by two bits, both inside the last 16-bit band, so bands 0-2 match and the
     * pair is both a band candidate and a real duplicate.
     *
     * BASE and BANDED_BUT_DISTANT also share bands 0-2 — so the index returns it exactly as readily —
     * but they differ in sixteen bits, above the threshold of ten. It is the only fixture that can
     * tell "the query found it" apart from "the comparison accepted it": a probe that trusted band
     * equality and skipped PhotoHash.sameShot would flag this pair, and every other case here would
     * still pass. */
    private static final String BASE = "ffff0000ffff0000";
    private static final String NEAR = "ffff0000ffff0003";
    private static final String BANDED_BUT_DISTANT = "ffff0000ffffffff";

    private static String photoBody(String... hashes) {
        return """
                {"title":"2BHK in Kothrud","deal":"rent","propertyType":"apartment","price":32000,
                 "bhk":2,"locality":"Kothrud","city":"Pune","floor":4,
                 "photoHashes":[%s]}
                """.formatted(Arrays.stream(hashes).map(h -> '"' + h + '"')
                        .collect(java.util.stream.Collectors.joining(",")));
    }

    /**
     * Create a listing carrying photo hashes and nothing the doorway arm can use.
     *
     * <p>No meter and no address, deliberately. With either of them present a collision could be
     * explained by {@code flagSameDoorway}, and every assertion below about the photo arm would hold
     * just as well with the photo arm deleted.
     */
    private UUID createWithPhotos(String token, String... hashes) throws Exception {
        String json = mvc.perform(post("/me/listings").header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON).content(photoBody(hashes)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(com.jayway.jsonpath.JsonPath.read(json, "$.id"));
    }

    @Test
    @DisplayName("a stays-live edit posts an ops-attributed note naming the fields re-checked")
    void aRecheckExplainsItselfInTheThread() throws Exception {
        User owner = owner("9820000530");
        String token = bearer(owner);
        UUID id = create(token, null, null);
        properties.findById(id).ifPresent(p -> {
            p.setStatus(PropertyStatus.APPROVED);
            properties.saveAndFlush(p);
        });

        mvc.perform(patch("/me/listings/" + id).header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"price\":34000}"))
                .andExpect(status().isOk())
                // Stays live, which is the half of Q14 this note has to be consistent with.
                .andExpect(jsonPath("$.status").value(PropertyStatus.APPROVED))
                .andExpect(jsonPath("$.recheckPending").value(true));

        mvc.perform(get("/properties/" + id + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(1))
                .andExpect(jsonPath("$.messages[0].from").value("ops"))
                .andExpect(jsonPath("$.messages[0].body").value(
                        org.hamcrest.Matchers.containsString("You updated: price")))
                .andExpect(jsonPath("$.messages[0].read").value(false));
    }

    @Test
    @DisplayName("re-editing a field already under re-check does not write a second note")
    void aRepeatEditOnTheSameFieldDoesNotReopenTheThread() throws Exception {
        User owner = owner("9820000531");
        String token = bearer(owner);
        UUID id = create(token, null, null);
        properties.findById(id).ifPresent(p -> {
            p.setStatus(PropertyStatus.APPROVED);
            p.setFurnishing(Furnishing.UNFURNISHED);
            properties.saveAndFlush(p);
        });

        // The desk's queue is sorted by last_message_at, so a note is not free: it is a bid for the
        // front of that queue. An owner nudging their own price is the cheapest way to make that bid,
        // and nothing about the second nudge is new information for either side.
        patchOk(id, token, "{\"price\":34000}");
        patchOk(id, token, "{\"price\":34001}");
        patchOk(id, token, "{\"price\":34002}");

        mvc.perform(get("/properties/" + id + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(1))
                .andExpect(jsonPath("$.messages[0].body").value(containsString("You updated: price")));

        // Suppressing the repeat must not suppress the next real thing. A field the desk has not been
        // told about yet still earns its note, because the work item genuinely grew.
        patchOk(id, token, "{\"furnishing\":\"furnished\"}");

        mvc.perform(get("/properties/" + id + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(2))
                .andExpect(jsonPath("$.messages[1].body").value(containsString("You updated: furnishing")));

        // And the re-check itself still names both fields: the note was skipped, not the work item.
        assertThat(properties.findById(id).orElseThrow().getRecheckReason())
                .isEqualTo("price, furnishing");
    }

    private void patchOk(UUID id, String token, String body) throws Exception {
        mvc.perform(patch("/me/listings/" + id).header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("an identity edit reverts to pending and says so, in one note not two")
    void aRemoderationExplainsItselfAndDoesNotAlsoRaiseARecheck() throws Exception {
        User owner = owner("9820000531");
        String token = bearer(owner);
        UUID id = create(token, null, null);
        properties.findById(id).ifPresent(p -> {
            p.setStatus(PropertyStatus.APPROVED);
            properties.saveAndFlush(p);
        });

        // Both halves in one PATCH: bhk is an identity field, price a stays-live one. The revert
        // wins, and the owner must not be told two contradictory things about the same edit.
        mvc.perform(patch("/me/listings/" + id).header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"bhk\":3,\"price\":34000}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(PropertyStatus.PENDING));

        mvc.perform(get("/properties/" + id + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(1))
                .andExpect(jsonPath("$.messages[0].from").value("ops"))
                .andExpect(jsonPath("$.messages[0].read").value(false))
                .andExpect(jsonPath("$.messages[0].body").value(
                        org.hamcrest.Matchers.containsString("off search")));
    }

    @Test
    @DisplayName("an edit that changes nothing material says nothing")
    void anOrdinaryEditDoesNotOpenACaseFile() throws Exception {
        User owner = owner("9820000532");
        String token = bearer(owner);
        UUID id = create(token, null, null);
        // Approved, because the control at the end of this test is a stays-live edit and a
        // stays-live edit only raises anything on a listing that is actually live. See
        // aPendingListingIsNotToldItStaysLive for the other half of that rule.
        properties.findById(id).ifPresent(p -> {
            p.setStatus(PropertyStatus.APPROVED);
            properties.saveAndFlush(p);
        });

        mvc.perform(patch("/me/listings/" + id).header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"description\":\"Sunny, quiet lane.\"}"))
                .andExpect(status().isOk());

        // 404 is "no case file", which is the point: a description edit must not manufacture a
        // moderation work item, and must not put an unread badge on the owner's dashboard.
        mvc.perform(get("/properties/" + id + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isNotFound());

        // The same 404 would also be returned if VerificationCases were never wired to this route
        // at all, so on its own the assertion above proves very little. A second edit that *is*
        // material, on the same listing and the same token, is what makes it load-bearing.
        mvc.perform(patch("/me/listings/" + id).header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"price\":41000}"))
                .andExpect(status().isOk());
        mvc.perform(get("/properties/" + id + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(1));
    }

    @Test
    @DisplayName("a pending listing is not told it stays live")
    void aPendingListingIsNotToldItStaysLive() throws Exception {
        User owner = owner("9820000552");
        String token = bearer(owner);
        // Left pending, which is where every listing starts.
        UUID id = create(token, null, null);

        mvc.perform(patch("/me/listings/" + id).header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"price\":41000}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(PropertyStatus.PENDING))
                // Property.requestRecheck refuses on a listing that is not publicly visible: it is
                // already in front of a moderator, and a second work item for the same row is queue
                // noise.
                .andExpect(jsonPath("$.recheckPending").value(false));

        // The note has to refuse with it. Posted anyway, it told the owner of an off-search listing
        // "your listing stays live", and opened a case file with no work item behind it -- an unread
        // badge pointing at a thread whose only message is false.
        mvc.perform(get("/properties/" + id + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("a matching meter number opens a staff-only case, and the listing still submits")
    void aDuplicateMeterFlagsForOpsWithoutRefusingTheListing() throws Exception {
        String firstToken = bearer(owner("9820000533"));
        UUID first = create(firstToken, "MSEDCL-170045321", null);
        Property firstListing = properties.findById(first).orElseThrow();
        // Whatever the note will name it by — slug once one is minted, id until then.
        String firstRef = firstListing.getSlug() == null
                ? first.toString() : firstListing.getSlug();

        String secondToken = bearer(owner("9820000534"));
        UUID second = create(secondToken, "MSEDCL-170045321", null);

        // Created as normal. A collision is a suspicion, not a finding — refusing it would make an
        // honest owner argue with a string comparison.
        assertThat(properties.findById(second)).get()
                .extracting(Property::getStatus).isEqualTo(PropertyStatus.PENDING);

        // The owner sees nothing. This is the whole of the finding that made D218's field-hiding
        // pointless: if the note reached the owner, anyone could submit a throwaway listing carrying
        // a guessed meter number and read their own thread to learn whether that meter is already on
        // the platform — an oracle for exactly the column the mapper refuses to return.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, secondToken))
                .andExpect(status().isNotFound());

        // Staff see it, and it names the listing to compare against — without the other listing's
        // identity the note is a rumour rather than a work item.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115533"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(1))
                .andExpect(jsonPath("$.messages[0].from").value("ops"))
                .andExpect(jsonPath("$.messages[0].body").value(
                        org.hamcrest.Matchers.containsString("Possible duplicate")))
                .andExpect(jsonPath("$.messages[0].body").value(
                        org.hamcrest.Matchers.containsString(firstRef)));
    }

    @Test
    @DisplayName("the write routes answer a flagged owner exactly as they answer an unflagged one")
    void theOracleIsClosedOnEveryRouteAndNotJustTheReadOne() throws Exception {
        create(bearer(owner("9820000540")), "MSEDCL-170046200", null);

        String flaggedToken = bearer(owner("9820000541"));
        UUID flagged = create(flaggedToken, "MSEDCL-170046200", null);

        // The control: an owner nobody collided with, on a listing with no case file at all.
        String cleanToken = bearer(owner("9820000542"));
        UUID clean = create(cleanToken, "MSEDCL-170046201", null);

        /* Hiding the note and hiding the case from GET closed one door of three. The read-receipt
         * and message routes both loaded the case by property id and 404ed on its absence, so either
         * of them answered the probe just as well as the note would have: submit a listing carrying
         * a guessed meter number, POST a read receipt, and 204 means that meter is on the platform
         * while 404 means it is not. Two requests, any authenticated account, no note ever read. A
         * status code is an oracle whenever it varies with a fact the caller may not know.
         *
         * Which is why these assert *sameness* rather than 404. Refusing both routes would close the
         * oracle too, and was the first fix written here — but it hands any attacker a way to mute
         * an honest owner's support thread by colliding with them on purpose, which is a worse bug
         * than the one being fixed. Uniform-and-permissive is the version worth having. */
        for (UUID id : new UUID[] {flagged, clean}) {
            String token = id.equals(flagged) ? flaggedToken : cleanToken;
            mvc.perform(post("/properties/" + id + "/verification/read")
                            .header(HttpHeaders.AUTHORIZATION, token))
                    .andExpect(status().isNoContent());
            mvc.perform(post("/properties/" + id + "/verification/messages")
                            .header(HttpHeaders.AUTHORIZATION, token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"body\":\"is something wrong with my listing?\"}"))
                    .andExpect(status().isCreated())
                    // And the reply the flagged owner gets back is the same shape: their own
                    // message, and no sign of the finding that is sitting beside it.
                    .andExpect(jsonPath("$.messages.length()").value(1))
                    .andExpect(jsonPath("$.messages[0].from").value("owner"));
        }
    }

    @Test
    @DisplayName("a staff-only case is absent from the owner's own queue entirely")
    void aStaffOnlyCaseIsAbsentFromTheOwnersQueue() throws Exception {
        create(bearer(owner("9820000538")), "MSEDCL-170046100", null);

        String secondToken = bearer(owner("9820000539"));
        create(secondToken, "MSEDCL-170046100", null);

        // The queue is the second half of the oracle. Filtering the note out of the thread but
        // leaving the card on the dashboard would still tell the owner the platform found something
        // — quieter, but the same fact. So the case does not appear at all until there is something
        // in it addressed to them.
        mvc.perform(get("/me/property-reviews").header(HttpHeaders.AUTHORIZATION, secondToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0));
    }

    @Test
    @DisplayName("once the case has something for the owner, they see that and only that")
    void theOwnerReadsPastAnInternalNoteWithoutSeeingIt() throws Exception {
        create(bearer(owner("9820000542")), "MSEDCL-170046200", null);

        String secondToken = bearer(owner("9820000543"));
        UUID second = create(secondToken, "MSEDCL-170046200", null);
        // Approved after the flag was filed, because the owner-addressed note below is a stays-live
        // one and those are only raised on a listing that is live. The duplicate note is already in
        // the case file by now and is not rewritten by this.
        properties.findById(second).ifPresent(p -> {
            p.setStatus(PropertyStatus.APPROVED);
            properties.saveAndFlush(p);
        });

        // A material edit puts a genuine, owner-addressed note into the same case file the duplicate
        // flag is sitting in. Now the case is no longer internal-only, so the 404 lifts — and the
        // per-message filter is the only thing still standing between the owner and the flag. Every
        // other test here has that filter shadowed by the 404, so this is where it is actually proven.
        mvc.perform(patch("/me/listings/" + second).header(HttpHeaders.AUTHORIZATION, secondToken)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"price\":45000}"))
                .andExpect(status().isOk());

        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, secondToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(1))
                .andExpect(jsonPath("$.messages[0].body").value(
                        org.hamcrest.Matchers.containsString("You updated: price")));

        // Staff read the same case file and get both, in the order they were written.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115543"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(2))
                .andExpect(jsonPath("$.messages[0].body").value(
                        org.hamcrest.Matchers.containsString("Possible duplicate")));

        // And the dashboard counts one unread, not two — the flag must not inflate a badge either.
        mvc.perform(get("/me/property-reviews").header(HttpHeaders.AUTHORIZATION, secondToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].unread").value(1));
    }

    @Test
    @DisplayName("the same address by two owners collides even when the meters differ")
    void theAddressArmOfTheProbeFires() throws Exception {
        create(bearer(owner("9820000540")), "MSEDCL-170047001", "Flat 402, B Wing, Rohan Nilay");

        String secondToken = bearer(owner("9820000541"));
        UUID second = create(secondToken, "MSEDCL-170047002", "B-402 Rohan Nilay");

        // Distinct meters, so only the (address_key, locality_slug) arm can be what matched. Without
        // this the normaliser is exercised as a pure function and never as a query predicate. The
        // body is asserted rather than just the count, because "exactly one message" is satisfied by
        // any note at all — including the ordinary re-review notice, which is not what is under test.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115540"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(1))
                .andExpect(jsonPath("$.messages[0].body").value(containsString("Possible duplicate")));
    }

    @Test
    @DisplayName("reused photographs collide across owners, and the submitter is never told")
    void thePhotoArmOfTheProbeFires() throws Exception {
        UUID first = createWithPhotos(bearer(owner("9820000570")), BASE);

        String secondToken = bearer(owner("9820000571"));
        UUID second = createWithPhotos(secondToken, NEAR);

        // The positive anchor. It has to come first: everything this test claims about what the
        // owner cannot see is worthless unless something proves the note exists and this route
        // renders it. Asserting the other listing's id as well as the wording, because "reuses
        // photographs" would also be satisfied by a note about the wrong listing.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115570"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(1))
                .andExpect(jsonPath("$.messages[0].body").value(containsString("reuses photographs")))
                .andExpect(jsonPath("$.messages[0].body").value(containsString(first.toString())))
                .andExpect(jsonPath("$.messages[0].internal").value(true));

        // Same route, same listing, the owner's own token: not a redacted case file but no case file
        // at all. The staff read directly above is what makes this non-vacuous — it has just proved
        // the record exists and this route renders it, so 404 here can only be the owner filter.
        //
        // 404 rather than an empty 200 is the point rather than an implementation detail. An empty
        // 200 is itself the answer to the question the probe asks: post a listing carrying somebody
        // else's photograph, then ask your own case file whether it exists. Quieter than the note,
        // and the same oracle. See PropertyVerificationService#ownerVisibleCase.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, secondToken))
                .andExpect(status().isNotFound());

        // And nothing is filed against the listing that was there first. It did nothing. A listing
        // with no findings has no case file at all, which is what 404 means on this route.
        mvc.perform(get("/properties/" + first + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115571"))))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("a photograph that only shares an index band is not a duplicate")
    void theHammingCheckRejectsAChanceBandCollision() throws Exception {
        UUID first = createWithPhotos(bearer(owner("9820000562")), BASE);

        UUID distant = createWithPhotos(bearer(owner("9820000563")), BANDED_BUT_DISTANT);

        // This pair IS returned by findBandCandidates — three of its four bands are identical — so
        // no case file means PhotoHash.sameShot turned it away. A listing with no findings has no
        // case file at all, which is what 404 means on this route.
        mvc.perform(get("/properties/" + distant + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115562"))))
                .andExpect(status().isNotFound());

        // The row that would otherwise pass. Same anchor, same stranger relationship, same band hit;
        // the only difference is that this hash is two bits from the anchor rather than sixteen.
        // Without it, "no case file" is equally the result of the arm never running, of the anchor
        // never storing its hashes, or of the band query matching nothing.
        UUID near = createWithPhotos(bearer(owner("9820000567")), NEAR);
        mvc.perform(get("/properties/" + near + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115567"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages[0].body").value(containsString("reuses photographs")))
                .andExpect(jsonPath("$.messages[0].body").value(containsString(first.toString())));
    }

    @Test
    @DisplayName("your own photographs on your own second listing are not a duplicate")
    void thePhotoArmSkipsTheSameOwner() throws Exception {
        User both = owner("9820000564");
        // Two listings need two slots, and the free allowance is one.
        plans.grant(both.getId(), TestPlanGrants.OWNER_PLUS);
        String token = bearer(both);

        UUID first = createWithPhotos(token, BASE);
        UUID second = createWithPhotos(token, BASE);

        // Identical hashes, distance zero — the strongest possible match — and still nothing, because
        // an owner photographing the two flats they are letting in the same building is not fraud.
        // The exclusion lives in findBandCandidates' own `owner.id <> :ownerId`, which is a different
        // query from the doorway arm's and would not be covered by that arm's tests.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115564"))))
                .andExpect(status().isNotFound());

        // The row that would otherwise pass: a stranger posting the very same hash. Only the owner
        // differs, so this is what stops "nothing happened" from being the answer to every question
        // in this test.
        UUID stranger = createWithPhotos(bearer(owner("9820000568")), BASE);
        mvc.perform(get("/properties/" + stranger + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115568"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages[0].body").value(containsString("reuses photographs")))
                .andExpect(jsonPath("$.messages[0].body").value(containsString(first.toString())));
    }

    @Test
    @DisplayName("swapping in somebody else's photographs on an edit raises the flag")
    void changingPhotographsReprobes() throws Exception {
        UUID first = createWithPhotos(bearer(owner("9820000565")), BASE);

        String secondToken = bearer(owner("9820000566"));
        UUID second = createWithPhotos(secondToken, BANDED_BUT_DISTANT);

        mvc.perform(patch("/me/listings/" + second).header(HttpHeaders.AUTHORIZATION, secondToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"photoHashes\":[\"" + NEAR + "\"]}"))
                .andExpect(status().isOk());

        // None of the values in signalOf moved — no meter, no address, same locality — so the only
        // thing that can have re-run the probe is the photo set changing. This is the edit the
        // address arm is structurally blind to: retype nothing, replace the pictures.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115565"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(1))
                .andExpect(jsonPath("$.messages[0].body").value(containsString("reuses photographs")))
                .andExpect(jsonPath("$.messages[0].body").value(containsString(first.toString())));
    }

    @Test
    @DisplayName("the catch-up sweep reaches a listing whose only signal is its photographs")
    void theSweepReadsPhotoOnlyListings() throws Exception {
        // Neither listing carries a meter or an address, so photographs are the only thing either
        // of them is findable by. The first one is the interesting side: when it was written the
        // second did not exist, so its own create-time probe had nothing to find and filed nothing.
        UUID first = createWithPhotos(bearer(owner("9820000572")), BASE);
        UUID second = createWithPhotos(bearer(owner("9820000573")), NEAR);

        String staffToken = bearer(staff("9871115572"));

        // The precondition, asserted rather than assumed: nothing is on file against the first
        // listing yet. Without this the assertion below would pass on a note that was already there.
        mvc.perform(get("/properties/" + first + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, staffToken))
                .andExpect(status().isNotFound());
        // And the positive anchor for the fixture itself: the pair really does collide, so a silent
        // sweep below means the sweep did not reach the listing rather than that there was nothing
        // to find.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages[0].body").value(containsString("reuses photographs")));

        probe.resweepRecent(Instant.now().minus(Duration.ofMinutes(20)), 500);

        // This is what findRecentSignalCarrying's photo clause buys. Selecting on the meter and
        // address columns alone — which is what it did before V116 — skips this listing entirely,
        // and the earlier owner of a stolen photograph is then the one person never told.
        mvc.perform(get("/properties/" + first + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(1))
                .andExpect(jsonPath("$.messages[0].body").value(containsString("reuses photographs")))
                .andExpect(jsonPath("$.messages[0].body").value(containsString(second.toString())));
    }

    @Test
    @DisplayName("an owner's read receipt cannot mark the note it never showed them")
    void aReadReceiptSkipsTheNotesTheOwnerCannotSee() throws Exception {
        create(bearer(owner("9820000544")), "MSEDCL-170046201", null);

        String secondToken = bearer(owner("9820000545"));
        UUID second = create(secondToken, "MSEDCL-170046201", null);
        properties.findById(second).ifPresent(p -> {
            p.setStatus(PropertyStatus.APPROVED);
            properties.saveAndFlush(p);
        });

        // A stays-live edit puts an owner-addressed note into the same case file the duplicate flag
        // is sitting in, so the thread now holds one of each and the receipt has something it is
        // genuinely entitled to mark. Without that, "nothing got marked" would pass for the right
        // answer while proving nothing.
        patchOk(second, secondToken, "{\"price\":45000}");

        mvc.perform(post("/properties/" + second + "/verification/read")
                        .header(HttpHeaders.AUTHORIZATION, secondToken))
                .andExpect(status().isNoContent());

        // Staff see both. The duplicate finding is still unread, because it is deliberately kept from
        // this owner and a receipt cannot speak for a message its sender never saw — while the note
        // they were actually shown is read, which is what proves the receipt still works at all.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115545"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(2))
                .andExpect(jsonPath("$.messages[0].internal").value(true))
                .andExpect(jsonPath("$.messages[0].read").value(false))
                .andExpect(jsonPath("$.messages[1].internal").value(false))
                .andExpect(jsonPath("$.messages[1].read").value(true));
    }

    @Test
    @DisplayName("the meter number and the flat number are the owner's to see and nobody else's")
    void theMeterNumberNeverReachesThePublicResponse() throws Exception {
        User owner = owner("9820000542");
        String token = bearer(owner);
        UUID id = create(token, "MSEDCL-170048777", "A-902, Rohan Nilay, Baner");
        properties.findById(id).ifPresent(p -> {
            p.setStatus(PropertyStatus.APPROVED);
            properties.saveAndFlush(p);
        });

        // The owner's own route returns it, because an edit form that cannot show the stored value
        // clears it on the next save.
        mvc.perform(get("/me/listings/" + id).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.electricityMeterNo").value("MSEDCL-170048777"))
                .andExpect(jsonPath("$.address").value("A-902, Rohan Nilay, Baner"));

        // The public detail route does not, signed out or signed in as somebody else. This is the
        // one assertion standing between the mapper's PrivateFieldVisibility argument and a silent
        // downgrade to VISIBLE at any of its call sites.
        //
        // The address is on this list for a reason that is easy to lose: it carries the flat number
        // because AddressKey needs the unit token to tell one flat from its neighbour. That makes it
        // a duplicate signal and a doorway at the same time, and the contact gate is worth nothing
        // against a stranger who already knows which door.
        mvc.perform(get("/properties/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.electricityMeterNo").doesNotExist())
                .andExpect(jsonPath("$.address").doesNotExist());
        mvc.perform(get("/properties/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner("9820000543"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.electricityMeterNo").doesNotExist())
                .andExpect(jsonPath("$.address").doesNotExist());
    }

    /**
     * The moderator's reason is the desk's, and the housekeeping that used to keep it off the public
     * read is not a guarantee.
     *
     * <p>This sets {@code flagReason} directly on an approved listing, which is a state the
     * moderation service takes care never to produce: approving clears the column, lowering a flag
     * clears it, and the verification service clears it. That is exactly the point. The column's
     * absence from consumer responses was a property of three call sites all remembering, not of
     * the projection, and this test is the projection's own answer — it stays right when one of
     * those three forgets.
     */
    @Test
    @DisplayName("the flag reason is the desk's note, not the listing's, on every consumer read")
    void theFlagReasonNeverReachesAConsumerResponse() throws Exception {
        User owner = owner("9820000549");
        String token = bearer(owner);
        UUID id = create(token, null, null);
        properties.findById(id).ifPresent(p -> {
            p.setStatus(PropertyStatus.APPROVED);
            p.setFlagReason("reporter says the photos are from a hotel listing");
            properties.saveAndFlush(p);
        });

        // Not to a stranger, signed out...
        mvc.perform(get("/properties/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flagReason").doesNotExist());

        // ...nor to the owner, which is the half that looks wrong and is not. The shorthand is
        // written for colleagues and usually repeats what somebody reported about this owner;
        // handing it back hands back the reporter too. What the owner is owed is an explanation,
        // and that is the verification thread, where the message is addressed to them.
        mvc.perform(get("/me/listings/" + id).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flagReason").doesNotExist());

        // And the assertion that stops this from being satisfied by dropping the field: the desk
        // still gets it, from the queue the desk actually reads.
        mvc.perform(get("/admin/properties").param("size", "200")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115571"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.id == '" + id + "')].flagReason")
                        .value("reporter says the photos are from a hotel listing"));
    }

    @Test
    @DisplayName("the duplicate note says which listing is the doubtful one, not just that two exist")
    void theNoteCarriesEnoughToActOn() throws Exception {
        String firstToken = bearer(owner("9820000544"));
        UUID first = create(firstToken, "MSEDCL-170049100", null);
        // The incumbent: live, and its owner has proved who they are.
        properties.findById(first).ifPresent(p -> {
            p.setStatus(PropertyStatus.APPROVED);
            p.setOwnerVerified(true);
            properties.saveAndFlush(p);
        });

        UUID second = create(bearer(owner("9820000545")), "MSEDCL-170049100", null);

        // Without these the note is a suspicion rather than a work item: it names two listings and
        // gives a moderator no way to tell which one moved. That asymmetry is the attack — a
        // throwaway listing carrying a competitor's meter number costs nothing and manufactures an
        // investigation, and the only thing that distinguishes it from the real listing is that the
        // real one is older, live, and verified. So the note has to carry all three.
        String body = mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115544"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(1))
                .andReturn().getResponse().getContentAsString();
        String note = com.jayway.jsonpath.JsonPath.read(body, "$.messages[0].body");

        assertThat(note)
                .contains(PropertyStatus.APPROVED)
                .contains("owner verified")
                .contains(PropertyStatus.PENDING)
                .contains("owner unverified")
                .contains("listed ");
    }

    @Test
    @DisplayName("a case a moderator has been denied properties:read is not a case they can read")
    void aStaffAccountWithoutTheGrantIsNotAChecker() throws Exception {
        create(bearer(owner("9820000546")), "MSEDCL-170049200", null);
        UUID second = create(bearer(owner("9820000547")), "MSEDCL-170049200", null);

        // A staff account whose properties:read has been taken away. Every other verification route
        // is gated on the grant at the controller; this one cannot be, because it is
        // participant-or-staff and an owner has no grants at all. So the service decides, and until
        // D218 it decided on the bare role — which meant revoking the grant did nothing here and a
        // deliberately narrowed account still read every internal note on the platform.
        User narrowed = staff("9871115546");
        grants.saveAndFlush(new com.punenest.api.common.access.BackOfficeGrant(
                narrowed.getId(), "[\"users:read\"]", narrowed.getId()));

        // Answered exactly as the owner is answered, because to this account the case is one that
        // holds nothing but staff-only material and nothing it may read.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(narrowed)))
                .andExpect(status().isNotFound());

        // The control: same role, same route, grant intact.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115547"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(1));
    }

    @Test
    @DisplayName("a flag on an old case file lifts it back up the ops queue instead of sinking")
    void anInternalNoteResurfacesTheCase() throws Exception {
        // The incumbent, holding the meter number that will be collided with later.
        create(bearer(owner("9820000548")), "MSEDCL-170049300", null);

        // An old case: opened by its owner, then left alone.
        String ownerToken = bearer(owner("9820000549"));
        UUID stale = create(ownerToken, null, null);
        mvc.perform(post("/properties/" + stale + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, ownerToken))
                .andExpect(status().isCreated());

        // A newer case arrives after it, so the old one is not at the head of the queue.
        String otherToken = bearer(owner("9820000550"));
        UUID newer = create(otherToken, null, null);
        mvc.perform(post("/properties/" + newer + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, otherToken))
                .andExpect(status().isCreated());

        String staffToken = bearer(staff("9871115548"));
        mvc.perform(get("/admin/property-reviews?page=0&size=20")
                        .header(HttpHeaders.AUTHORIZATION, staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].propertyId").value(newer.toString()));

        // Now the stale listing edits its way onto somebody else's meter number, and the flag lands
        // on a case file that already existed. That is the path S5 was about: review_messages owns
        // the association, so inserting a message left property_reviews untouched — neither
        // @UpdateTimestamp nor the set_updated_at trigger fired — and the ops queue left the case
        // exactly where it already was, which for an old case is out of sight. The fix is that
        // adding a message now writes lastMessageAt on the parent, and what this pins is that
        // consequence: something said in a case moves the case.
        //
        // Deliberately not asserted here: that ordering on lastMessageAt differs from ordering on
        // updated_at. It does not, and pretending otherwise would be a test that proves a
        // distinction the schema cannot currently make — writing lastMessageAt dirties the row, so
        // updated_at follows it, and every other writer that touches this row (decide) also speaks
        // in the thread. See PropertyReviewRepository#findAllForDesk for why the column is still the
        // right one to sort on.
        mvc.perform(patch("/me/listings/" + stale).header(HttpHeaders.AUTHORIZATION, ownerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"electricityMeterNo\":\"MSEDCL-170049300\"}"))
                .andExpect(status().isOk());

        mvc.perform(get("/admin/property-reviews?page=0&size=20")
                        .header(HttpHeaders.AUTHORIZATION, staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].propertyId").value(stale.toString()));
    }

    @Test
    @DisplayName("a society that does not exist is not a society this listing can join")
    void anUnknownSocietyIsRefused() throws Exception {
        String token = bearer(owner("9820000551"));

        // societyId arrives in the request body, is published on the society hub and feeds its
        // listing count. There *is* a foreign key behind it (V3), so an id naming nothing was always
        // refused — but at flush, as a constraint violation, which answers 409 on a request that
        // conflicts with nothing. What the boundary check buys is the honest status code; what
        // neither buys is a claim, since nothing links an owner to the society they name.
        mvc.perform(post("/me/listings").header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"2BHK in Kothrud","deal":"rent","propertyType":"apartment",
                                 "price":32000,"bhk":2,"locality":"Kothrud","city":"Pune",
                                 "societyId":"00000000-0000-4000-8000-00000000dead"}
                                """))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("the same owner listing the same meter twice is housekeeping, not fraud")
    void oneOwnerDoesNotCollideWithThemselves() throws Exception {
        User owner = owner("9820000535");
        // Two live listings is over the free tier's one, and POST /me/listings enforces that now.
        // Granted rather than worked around, because the point of this test is what the duplicate
        // probe makes of two listings that genuinely exist — seeding the second past the endpoint
        // would skip the reindex that creates the collision it is looking for.
        plans.grant(owner.getId(), TestPlanGrants.OWNER_PLUS);
        String token = bearer(owner);
        create(token, "MSEDCL-170045999", null);
        UUID second = create(token, "MSEDCL-170045999", null);

        // Asked as staff, not as the owner. Since the duplicate note became staff-only the owner
        // gets a 404 either way, so an owner-scoped read here would pass no matter what the probe
        // did — the assertion has to be made by the one party that would see the case file.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115535"))))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("a listing with no meter number does not collide with every other listing that has none")
    void absentSignalsMatchNothing() throws Exception {
        create(bearer(owner("9820000536")), null, null);

        UUID second = create(bearer(owner("9820000537")), null, null);

        // What makes this pass is that every arm of findDuplicateCandidates is a plain `=`, and SQL
        // equality against NULL is unknown rather than true. It is one well-meant `coalesce` away
        // from breaking, and the failure mode is a moderation case opened against every honest owner
        // who skipped the optional fields — so it is asserted rather than assumed. Staff-scoped for
        // the same reason as the test above.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115537"))))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("two spellings of one address normalise to the same key")
    void theAddressNormaliserCollapsesTheSpellingsThatActuallyOccur() {
        String a = AddressKey.of("Flat 402, B Wing, Rohan Nilay, Baner", "Pune", "Baner");
        String b = AddressKey.of("B-402 Rohan Nilay, Baner, Pune 411045", "Pune", "Baner");
        assertThat(a).isEqualTo(b).isEqualTo("402 b nilay rohan");

        // Different unit in the same building must not collapse — the whole rule is worthless if it
        // cannot tell 402 from 403.
        assertThat(AddressKey.of("Flat 403, B Wing, Rohan Nilay, Baner", "Pune", "Baner"))
                .isNotEqualTo(a);

        // An address made entirely of filler carries no signal, and null is how the probe is told so.
        assertThat(AddressKey.of("The society building", "Pune", "Baner")).isNull();
        assertThat(AddressKey.of(null, "Pune", "Baner")).isNull();

        // So does one that reduces to a single token. "Flat 402" is "402", which is true of one flat
        // per floor in every building in Baner — a key that selective would file a moderation case
        // against strangers, and the cost of that lands on an honest owner stuck behind the queue.
        assertThat(AddressKey.of("Flat 402", "Pune", "Baner")).isNull();
    }

    @Test
    @DisplayName("the catch-up sweep flags the pair that submitted in the same second (D219)")
    void theSweepCatchesTheCollisionNeitherWriterCouldSee() throws Exception {
        String firstToken = bearer(owner("9820000560"));
        UUID first = create(firstToken, "MSEDCL-170047100", null);

        /* Staging the race, since a single-threaded test cannot have one.

        The second listing is created with no meter at all, so the synchronous probe takes its
        early-out and files nothing — and then the meter is written straight onto the entity,
        bypassing ListingService and therefore the probe. What is left is the exact state two
        concurrent commits produce under READ COMMITTED: two listings sharing a meter number, and
        not a note between them. Doing it this way rather than through the update route matters,
        because going through the route would run the probe and prove nothing about the sweep. */
        String secondToken = bearer(owner("9820000561"));
        UUID second = create(secondToken, null, null);
        Property racer = properties.findById(second).orElseThrow();
        racer.setElectricityMeterNo("MSEDCL-170047100");
        // Both columns, because the write path sets both (V115) and a row with a raw meter and no
        // derived key is not a state a concurrent commit can leave behind — it is a state only this
        // test could invent. Staging an impossible row would make the sweep look broken here and
        // hide whether it works there.
        racer.setElectricityMeterKey(MeterKey.of("MSEDCL-170047100"));
        properties.saveAndFlush(racer);

        String staffToken = bearer(staff("9871115560"));

        // Neither listing knows about the other. This assertion is the point of the test: without it
        // the one below would pass on a note the create path had already filed.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, staffToken))
                .andExpect(status().isNotFound());

        probe.resweepRecent(Instant.now().minus(Duration.ofMinutes(20)), 500);

        // Both sides get the finding, not just the later one. The sweep has no notion of who was
        // first — it re-reads each listing and asks the same question the writer asked, so a desk
        // opening either case file sees the collision rather than having to know to look at the twin.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(1))
                .andExpect(jsonPath("$.messages[0].from").value("ops"))
                .andExpect(jsonPath("$.messages[0].body").value(containsString("Possible duplicate")));
        mvc.perform(get("/properties/" + first + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages[0].body").value(containsString("Possible duplicate")));

        /* A sweep on a timer re-reads the same listing on consecutive ticks by design — the window
        is twice the period so that a tick dying mid-run does not leave a permanent hole. That makes
        this the difference between a useful desk and an unusable one: the second pass must be
        silent, or a collision nobody has got round to yet grows a new note every ten minutes until
        the case file is unreadable. What holds it is postInternalOnce comparing bodies. */
        probe.resweepRecent(Instant.now().minus(Duration.ofMinutes(20)), 500);

        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, staffToken))
                .andExpect(jsonPath("$.messages.length()").value(1));
    }

    @Test
    @DisplayName("the sweep does not reach back past its window")
    void theSweepLooksOnlyAtWhatWasJustWritten() throws Exception {
        create(bearer(owner("9820000562")), "MSEDCL-170047200", null);

        String secondToken = bearer(owner("9820000563"));
        UUID second = create(secondToken, null, null);
        Property racer = properties.findById(second).orElseThrow();
        racer.setElectricityMeterNo("MSEDCL-170047200");
        properties.saveAndFlush(racer);

        /* A window that reached back further than it claims would work — it would still catch the
        race — while quietly turning a bounded per-tick scan into one that grows with the age of the
        platform. That failure has no symptom until the table is large, at which point every tick
        re-reads every listing ever created and the sweep starts costing real database time. Asking
        for a window that ends before these listings were written is the only way to see the bound
        from outside. */
        probe.resweepRecent(Instant.now().plus(Duration.ofMinutes(1)), 500);

        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115563"))))
                .andExpect(status().isNotFound());
    }
}
