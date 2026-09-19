package com.draazy.api.catalog;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.billing.plan.TestPlanGrants;
import com.draazy.api.catalog.listing.ListingDuplicateProbe;
import com.draazy.api.catalog.property.AddressKey;
import com.draazy.api.catalog.property.Furnishing;
import com.draazy.api.catalog.property.MeterKey;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
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
 * What the server says for itself when a listing is edited or looks like somebody else's. The assertions are
 * about <em>who is talking</em>: a platform note must come back as {@code ops}, or it counts as owner-read.
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
    com.draazy.api.common.access.BackOfficeGrantRepository grants;
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
     * A moderator with the ordinary staff baseline, which includes the {@code properties:read} grant the
     * service reads before rendering staff-only notes. Contrast {@link #aStaffAccountWithoutTheGrantIsNotAChecker}.
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

    /* BASE/NEAR differ by two bits in the last band, so they are a band candidate AND a real match; BANDED_BUT_DISTANT
       shares those bands but is sixteen bits away, telling "the query found it" apart from "the comparison accepted it". */
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
     * Create a listing carrying photo hashes and nothing the doorway arm can use: with a meter or address
     * present, a collision could be explained by {@code flagSameDoorway} and prove nothing about photos.
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

        // The desk's queue is sorted by last_message_at, so a note is a bid for the front of it. An owner
        // nudging their own price is the cheapest such bid, and the second nudge is news to nobody.
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
        // Approved, because the control at the end of this test is a stays-live edit, which only raises
        // anything on a live listing. See aPendingListingIsNotToldItStaysLive for the other half.
        properties.findById(id).ifPresent(p -> {
            p.setStatus(PropertyStatus.APPROVED);
            properties.saveAndFlush(p);
        });

        mvc.perform(patch("/me/listings/" + id).header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deposit\":60000}"))
                .andExpect(status().isOk());

        // 404 is "no case file": a deposit edit must not manufacture a moderation work item or an unread
        // badge. Prose and photographs deliberately do not qualify — a reviewer looked at those.
        mvc.perform(get("/properties/" + id + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isNotFound());

        // The same 404 would come back if VerificationCases were never wired to this route at all, so a
        // second, genuinely material edit on the same listing is what makes the assertion above load-bearing.
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
                // Property.requestRecheck refuses on a listing that is not publicly visible: it is already
                // in front of a moderator, and a second work item for the same row is queue noise.
                .andExpect(jsonPath("$.recheckPending").value(false));

        // The note has to refuse with it, or an off-search listing's owner is told "your listing stays live"
        // and gets an unread badge pointing at a thread whose only message is false.
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

        // The owner sees nothing: a note that reached them would let anyone submit a throwaway listing with a
        // guessed meter number and read their own thread — an oracle for the column the mapper refuses to return.
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

        /* A status code is an oracle whenever it varies with a fact the caller may not know. Asserting sameness,
         * not refusal: refusing lets an attacker mute an honest owner's thread by colliding on purpose. */
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

        // The queue is the second half of the oracle: leaving the card on the dashboard tells the owner the
        // platform found something. So the case is absent until it holds something addressed to them.
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
        // Approved after the flag was filed, because the owner-addressed note below is a stays-live one and
        // those are only raised on a live listing. The duplicate note is already filed and is not rewritten.
        properties.findById(second).ifPresent(p -> {
            p.setStatus(PropertyStatus.APPROVED);
            properties.saveAndFlush(p);
        });

        // An owner-addressed note in the same case file lifts the 404, leaving the per-message filter as the
        // only thing between the owner and the flag. Elsewhere that filter is shadowed by the 404.
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

        // Distinct meters, so only the (address_key, locality_slug) arm can have matched. The body is asserted
        // too, because "exactly one message" is satisfied by the ordinary re-review notice as well.
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

        // The positive anchor, first: every claim below about what the owner cannot see is worthless unless the
        // note provably exists. The other listing's id is asserted, since a note about the wrong one would pass.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115570"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(1))
                .andExpect(jsonPath("$.messages[0].body").value(containsString("reuses photographs")))
                .andExpect(jsonPath("$.messages[0].body").value(containsString(first.toString())))
                .andExpect(jsonPath("$.messages[0].internal").value(true));

        // No case file at all, not a redacted one: the staff read above proves the record exists, so 404 here
        // can only be the owner filter. An empty 200 would itself answer the probe. See #ownerVisibleCase.
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

        // This pair IS returned by findBandCandidates — three of four bands identical — so no case file means
        // PhotoHash.sameShot turned it away; a listing with no findings 404s on this route.
        mvc.perform(get("/properties/" + distant + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115562"))))
                .andExpect(status().isNotFound());

        // The row that would otherwise pass: same anchor, same stranger, same band hit, two bits away instead
        // of sixteen. Without it, "no case file" is equally the arm never running or the band query missing.
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

        // Distance zero and still nothing, because an owner photographing two flats in the same building is
        // not fraud. The exclusion lives in findBandCandidates' own `owner.id <> :ownerId`, not the doorway arm's.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115564"))))
                .andExpect(status().isNotFound());

        // The row that would otherwise pass: a stranger posting the very same hash. Only the owner differs,
        // so this stops "nothing happened" from being the answer to every question in this test.
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

        // Nothing in signalOf moved, so only the photo set can have re-run the probe. This is the edit the
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
        // Photographs are the only thing either listing is findable by. The first is the interesting side: the
        // second did not exist when it was written, so its create-time probe had nothing to find.
        UUID first = createWithPhotos(bearer(owner("9820000572")), BASE);
        UUID second = createWithPhotos(bearer(owner("9820000573")), NEAR);

        String staffToken = bearer(staff("9871115572"));

        // The precondition, asserted rather than assumed: nothing is on file against the first
        // listing yet. Without this the assertion below would pass on a note that was already there.
        mvc.perform(get("/properties/" + first + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, staffToken))
                .andExpect(status().isNotFound());
        // And the positive anchor for the fixture: the pair really does collide, so a silent sweep below means
        // the sweep did not reach the listing rather than that there was nothing to find.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, staffToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages[0].body").value(containsString("reuses photographs")));

        probe.resweepRecent(Instant.now().minus(Duration.ofMinutes(20)), 500);

        // What findRecentSignalCarrying's photo clause buys: selecting on meter and address alone skips this
        // listing, leaving the earlier owner of a stolen photograph the one person never told.
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

        // A stays-live edit puts an owner-addressed note beside the duplicate flag, so the receipt has
        // something it is entitled to mark. Without it, "nothing got marked" would prove nothing.
        patchOk(second, secondToken, "{\"price\":45000}");

        mvc.perform(post("/properties/" + second + "/verification/read")
                        .header(HttpHeaders.AUTHORIZATION, secondToken))
                .andExpect(status().isNoContent());

        // Staff see both. The duplicate stays unread — a receipt cannot speak for a message its sender never
        // saw — while the note they were shown is read, proving the receipt still works at all.
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

        // The public detail route does not. The address is on this list because it carries the flat number for
        // AddressKey, and the contact gate is worth nothing against a stranger who knows which door.
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
     * Sets {@code flagReason} on an approved listing — a state the service takes care never to produce — so the
     * projection answers for itself, rather than the column's absence resting on three call sites remembering.
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

        // ...nor to the owner: the shorthand is written for colleagues and usually repeats what somebody
        // reported, so handing it back hands back the reporter. The owner is owed the verification thread.
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

        // Without these the note is a suspicion, not a work item: it names two listings and no way to tell which
        // moved. A throwaway carrying a competitor's meter differs only in being newer, dark and unverified.
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

        // This route cannot be grant-gated at the controller, being participant-or-staff, so the service
        // decides — and deciding on the bare role would let a deliberately narrowed account read every note.
        User narrowed = staff("9871115546");
        grants.saveAndFlush(new com.draazy.api.common.access.BackOfficeGrant(
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

        // review_messages owns the association, so inserting a message does not dirty property_reviews by
        // itself and an old case would stay out of sight. What is pinned: something said in a case moves it.
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

        // The foreign key already refused an id naming nothing, but at flush, as a 409 on a request that
        // conflicts with nothing. The boundary check buys the honest status code, not a claim of membership.
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
        // Two live listings is over the free tier's one. Granted rather than worked around: seeding the second
        // past the endpoint would skip the reindex that creates the collision this test looks for.
        plans.grant(owner.getId(), TestPlanGrants.OWNER_PLUS);
        String token = bearer(owner);
        create(token, "MSEDCL-170045999", null);
        UUID second = create(token, "MSEDCL-170045999", null);

        // Asked as staff: the owner gets a 404 either way, so an owner-scoped read would pass no matter what
        // the probe did.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115535"))))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("a listing with no meter number does not collide with every other listing that has none")
    void absentSignalsMatchNothing() throws Exception {
        create(bearer(owner("9820000536")), null, null);

        UUID second = create(bearer(owner("9820000537")), null, null);

        // Every arm of findDuplicateCandidates is a plain `=`, so NULL is unknown rather than true — one
        // well-meant `coalesce` from opening a case against every owner who skipped the optional fields.
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

        // So does one reducing to a single token: "Flat 402" is "402", true of one flat per floor in every
        // building in Baner, and a key that selective files moderation cases against strangers.
        assertThat(AddressKey.of("Flat 402", "Pune", "Baner")).isNull();
    }

    @Test
    @DisplayName("the catch-up sweep flags the pair that submitted in the same second (D219)")
    void theSweepCatchesTheCollisionNeitherWriterCouldSee() throws Exception {
        String firstToken = bearer(owner("9820000560"));
        UUID first = create(firstToken, "MSEDCL-170047100", null);

        /* Staging the race a single-threaded test cannot have: created meterless so the probe early-outs, then
        the meter written straight onto the entity — the state two concurrent commits leave under READ COMMITTED. */
        String secondToken = bearer(owner("9820000561"));
        UUID second = create(secondToken, null, null);
        Property racer = properties.findById(second).orElseThrow();
        racer.setElectricityMeterNo("MSEDCL-170047100");
        // Both columns, because the write path sets both: a raw meter with no derived key is a row only this
        // test could invent, and staging an impossible row would make the sweep look broken.
        racer.setElectricityMeterKey(MeterKey.of("MSEDCL-170047100"));
        properties.saveAndFlush(racer);

        String staffToken = bearer(staff("9871115560"));

        // Neither listing knows about the other. This assertion is the point of the test: without it
        // the one below would pass on a note the create path had already filed.
        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, staffToken))
                .andExpect(status().isNotFound());

        probe.resweepRecent(Instant.now().minus(Duration.ofMinutes(20)), 500);

        // Both sides get the finding. The sweep has no notion of who was first, so a desk opening either case
        // file sees the collision rather than having to know to look at the twin.
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

        /* The window is twice the period, so consecutive ticks re-read the same listing by design. The second
        pass must be silent or an unworked collision grows a note every ten minutes; postInternalOnce holds it. */
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

        /* A window reaching back further than it claims still catches the race, while turning a bounded per-tick
        scan into one that grows with the platform. Ending it before these writes is the only way to see the bound. */
        probe.resweepRecent(Instant.now().plus(Duration.ofMinutes(1)), 500);

        mvc.perform(get("/properties/" + second + "/verification")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff("9871115563"))))
                .andExpect(status().isNotFound());
    }
}
