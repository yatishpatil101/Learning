package com.draazy.api.catalog.listing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyController;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.RequestParam;

/** Facets are reflected off {@link PropertyController#search} so a third hand-kept list cannot drift. */
@DisplayName("Listings — every search facet costs a re-review, at one of two prices")
class ListingFoundationTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    /** Edits that take the listing off search. {@code landUse} is stated rather than derived: it carries no
     *  {@code @RequestParam}, so the facet loop below can never reach it. */
    private static final Set<String> OFF_SEARCH =
            Set.of("bhk", "propertyType", "locality", "deal", "landUse");

    private static final Set<String> STAYS_LIVE =
            Set.of("price", "furnishing", "possession", "address", "societyId", "electricityMeterNo",
                    "carpetArea", "images", "description", "amenities", "reraId");

    /** Facets with no listing attribute behind them: price bounds, free text, moderation state, the owner id
     *  (untransferable by PATCH) and the result ordering. */
    private static final Set<String> NOT_LISTING_ATTRIBUTES =
            Set.of("minPrice", "maxPrice", "q", "status", "owner", "rank");

    private static String toFieldName(String facet) {
        return "type".equals(facet) ? "propertyType" : facet;
    }

    private static List<String> searchFacets() {
        Method search = Arrays.stream(PropertyController.class.getDeclaredMethods())
                .filter(m -> "search".equals(m.getName()))
                .findFirst()
                .orElseThrow(() -> new AssertionError(
                        "PropertyController.search is gone — this test measures the wrong thing"));
        return Arrays.stream(search.getParameters())
                .filter(p -> p.isAnnotationPresent(RequestParam.class))
                .map(java.lang.reflect.Parameter::getName)
                .toList();
    }

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Foundation Owner");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private User staff(String mobile) {
        User u = new User(mobile, "staff");
        u.setName("Foundation Staff");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property approvedListing(User owner) {
        return approvedListing(owner, "Bright 2BHK");
    }

    private Property approvedListing(User owner, String title) {
        Property p = new Property(owner, title, "rent", "apartment",
                25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setStatus(PropertyStatus.APPROVED);
        p.setFurnishing("unfurnished");
        p.setPossession("under-construction");

        // Filed, because re-approval refuses an unfiled listing.
        p.setLocalitySlug("kothrud");
        return properties.saveAndFlush(p);
    }

    /** Not a behaviour check — only that somebody decided which side a facet is on, and that it is
     *  exactly one of the two sets. */
    private Property pendingListing(User owner, String title) {
        Property p = approvedListing(owner, title);
        p.setStatus(PropertyStatus.PENDING);
        return properties.saveAndFlush(p);
    }

    private Property approvedSalePlot(User owner, String reraId, String plottedProject) {
        Property p = new Property(owner, "Clear title plot", "buy", "Open Plot",
                5_000_000L, "Kothrud", "Pune");
        p.setPriceUnit("total");
        p.setStatus(PropertyStatus.APPROVED);
        p.setLocalitySlug("kothrud");
        p.setArea(new BigDecimal("1200"));
        p.setAreaUnit("sqft");
        p.setReraId(reraId);
        p.setFormDetails(Map.of("plottedProject", plottedProject));
        return properties.saveAndFlush(p);
    }

    private Property approvedSaleListing(User owner) {
        Property p = new Property(owner, "Bright sale flat", "buy", "apartment",
                5_000_000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("total");
        p.setStatus(PropertyStatus.APPROVED);
        p.setLocalitySlug("kothrud");
        p.setCarpetArea(new BigDecimal("1000"));
        return properties.saveAndFlush(p);
    }

    private static String upload(User owner) {
        return "/api/dev/storage/public/photos/" + owner.getId() + "/" + java.util.UUID.randomUUID();
    }

    private UUID society(String slug) {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into societies (id, created_at, updated_at, slug, name, registration, conveyance, amenities) "
                + "values (?, now(), now(), ?, ?, false, false, '[]'::jsonb)",
                id, slug, "Society " + slug);
        return id;
    }

    private String verificationPath(Property p, String suffix) {
        return "/properties/" + p.getId() + "/verification" + suffix;
    }

    private void openCaseAndTickPhotoLine(Property p, User owner, User ops) throws Exception {
        mvc.perform(post(verificationPath(p, "")).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());
        for (String item : List.of(
                "Photos are real and match the listing",
                "Not a duplicate of another listing",
                "Details and location look right")) {
            mvc.perform(patch(verificationPath(p, "/checklist")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"item\":\"" + item + "\",\"pass\":true}"))
                    .andExpect(status().isOk());
        }
        mvc.perform(get(verificationPath(p, "")).header(HttpHeaders.AUTHORIZATION, bearer(ops)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checklist[?(@.item == 'Photos are real and match the listing')].pass")
                        .value(true));
    }

    @Test
    @DisplayName("every search facet is either a foundation field or a recorded exemption")
    void everySearchFacetIsClassified() {
        assertThat(OFF_SEARCH)
                .as("a field cannot both leave search and stay in it — one of the two sets is wrong")
                .doesNotContainAnyElementsOf(STAYS_LIVE);

        Set<String> foundationCases = new TreeSet<>(OFF_SEARCH);
        foundationCases.addAll(STAYS_LIVE);

        List<String> facets = searchFacets();
        assertThat(facets)
                .as("reflection returned no parameter names — the build must keep -parameters on, "
                        + "or this test passes by comparing nothing")
                .isNotEmpty();

        Set<String> unclassified = new TreeSet<>();
        for (String facet : facets) {
            if (!NOT_LISTING_ATTRIBUTES.contains(facet)
                    && !foundationCases.contains(toFieldName(facet))) {
                unclassified.add(facet);
            }
        }

        assertThat(unclassified)
                .as("a buyer can filter on these but an owner can change them on an approved "
                        + "listing with no re-review at all. Add the field to one of the two "
                        + "foundation blocks in ListingEditRules.apply, to the matching set here, "
                        + "and give it a case below — or record why it is exempt in "
                        + "NOT_LISTING_ATTRIBUTES")
                .isEmpty();
    }

    private void assertRevertsToPending(String jsonPatch) throws Exception {
        User o = owner("98765" + String.format("%05d", Math.abs(jsonPatch.hashCode()) % 100000));
        Property p = approvedListing(o);

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(jsonPatch))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("pending"))
                .andExpect(jsonPath("$.recheckPending").value(false));
    }

    /** Searchability is proven separately in {@link #aPriceEditKeepsTheListingInSearch} — status is the
     *  mechanism, being findable is the promise. */
    private void assertStaysLiveAndQueuesRecheck(String jsonPatch, String field) throws Exception {
        User o = owner("98764" + String.format("%05d", Math.abs(jsonPatch.hashCode()) % 100000));
        Property p = approvedListing(o);

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(jsonPatch))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"))
                .andExpect(jsonPath("$.recheckPending").value(true))
                .andExpect(jsonPath("$.recheckReason").value(field))
                .andExpect(jsonPath("$.recheckRequestedAt").exists());
        storedListing(o, p.getId()).andExpect(jsonPath("$.resubmittedAt").exists());
    }

    @Test
    @DisplayName("a ready-to-move sale create drops the future available date")
    void readyToMoveSaleCreateDropsAvailableDate() throws Exception {
        User o = owner("9876300001");

        mvc.perform(post("/me/listings")
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"Ready sale flat","deal":"buy","propertyType":"apartment","price":5000000,
                                 "bhk":2,"locality":"Kothrud","city":"Pune","possession":"ready-to-move",
                                 "images":["%s"],"formDetails":{"availableFrom":"2027-01-20"}}
                                """.formatted(upload(o))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.resubmittedAt").doesNotExist())
                .andExpect(jsonPath("$.availableDate").doesNotExist())
                .andExpect(jsonPath("$.formDetails.availableFrom").doesNotExist());

        assertThat(properties.findAll().stream()
                .filter(p -> "Ready sale flat".equals(p.getTitle()))
                .findFirst()
                .orElseThrow()
                .getResubmittedAt()).isNull();
    }

    @Test
    @DisplayName("owner edit of a rejected listing keeps the final verdict")
    void rejectedListingEditStaysRejected() throws Exception {
        User o = owner("9876300099");
        Property p = approvedListing(o, "Rejected resubmit");
        p.setStatus(PropertyStatus.REJECTED);
        properties.saveAndFlush(p);

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"locality\":\"Baner\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("rejected"))
                .andExpect(jsonPath("$.resubmittedAt").doesNotExist());

        Property saved = properties.findById(p.getId()).orElseThrow();
        assertThat(saved.getStatus()).isEqualTo(PropertyStatus.REJECTED);
        assertThat(saved.getResubmittedAt()).isNull();
    }

    @Test
    @DisplayName("restoring a rejected listing keeps the final verdict")
    void restoreRejectedListingStaysRejected() throws Exception {
        User o = owner("9876300100");
        Property p = approvedListing(o, "Rejected restore");
        p.setStatus(PropertyStatus.REJECTED);
        p.archive("owner took it down");
        properties.saveAndFlush(p);

        mvc.perform(patch("/properties/" + p.getId() + "/restore")
                        .header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("rejected"));

        Property saved = properties.findById(p.getId()).orElseThrow();
        assertThat(saved.isArchived()).isFalse();
        assertThat(saved.getStatus()).isEqualTo(PropertyStatus.REJECTED);
    }

    @Test
    @DisplayName("editing a needs-info listing resubmits the review and clears old checklist ticks")
    void needsInfoListingEditResubmits() throws Exception {
        User o = owner("9876300199");
        User ops = staff("9876300200");
        Property p = pendingListing(o, "Needs info resubmit");

        openCaseAndTickPhotoLine(p, o, ops);
        mvc.perform(post(verificationPath(p, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"decision\":\"needs_info\",\"reasonCode\":\"photos_not_real\","
                        + "\"note\":\"Use current photos.\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("needs_info"))
                .andExpect(jsonPath("$.progress.flags").value(org.hamcrest.Matchers.hasItem("needs_info")));

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"locality\":\"Viman Nagar\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("pending"));

        mvc.perform(get(verificationPath(p, "")).header(HttpHeaders.AUTHORIZATION, bearer(ops)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("in_review"))
                .andExpect(jsonPath("$.progress.step").value("in_review"))
                .andExpect(jsonPath("$.progress.flags").value(org.hamcrest.Matchers.not(org.hamcrest.Matchers.hasItem("needs_info"))))
                .andExpect(jsonPath("$.checklist[?(@.item == 'Photos are real and match the listing')].pass")
                        .value(false));
    }

    @Test
    @DisplayName("an off-search owner edit clears old checklist ticks")
    void offSearchEditUnticksChecklist() throws Exception {
        User o = owner("9876300201");
        User ops = staff("9876300202");
        Property p = approvedListing(o, "Off search checklist reset");

        openCaseAndTickPhotoLine(p, o, ops);
        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"locality\":\"Viman Nagar\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("pending"));

        mvc.perform(get(verificationPath(p, "")).header(HttpHeaders.AUTHORIZATION, bearer(ops)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("in_review"))
                .andExpect(jsonPath("$.checklist[?(@.item == 'Photos are real and match the listing')].pass")
                        .value(false));
    }

    @Test
    @DisplayName("a stays-live re-check keeps the approval's ticks, so 'looks fine' clears it")
    void liveRecheckKeepsTicksAndPasses() throws Exception {
        User o = owner("9876300221");
        User ops = staff("9876300222");
        Property p = approvedListing(o, "Live recheck keeps ticks");

        openCaseAndTickPhotoLine(p, o, ops);
        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"price\":26000}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"))
                .andExpect(jsonPath("$.recheckPending").value(true));

        mvc.perform(patch("/properties/" + p.getId() + "/status")
                        .header(HttpHeaders.AUTHORIZATION, bearer(ops))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\",\"expectedStatus\":\"approved\"}"))
                .andExpect(status().isOk());
        assertThat(properties.findById(p.getId()).orElseThrow().isRecheckPending()).isFalse();
    }

    @Test
    @DisplayName("a needs-info owner edit resubmits even when the listing is already pending")
    void needsInfoOwnerEditResubmits() throws Exception {
        User o = owner("9876300205");
        User ops = staff("9876300206");
        Property p = pendingListing(o, "Needs info edit reset");

        openCaseAndTickPhotoLine(p, o, ops);
        mvc.perform(post(verificationPath(p, "/decision")).header(HttpHeaders.AUTHORIZATION, bearer(ops))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"needs_info\",\"reasonCode\":\"photos_not_real\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("needs_info"));

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"price\":26000}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("pending"));

        mvc.perform(get(verificationPath(p, "")).header(HttpHeaders.AUTHORIZATION, bearer(ops)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("in_review"))
                .andExpect(jsonPath("$.progress.step").value("in_review"))
                .andExpect(jsonPath("$.progress.flags").value(org.hamcrest.Matchers.not(org.hamcrest.Matchers.hasItem("needs_info"))))
                .andExpect(jsonPath("$.checklist[?(@.item == 'Photos are real and match the listing')].pass")
                        .value(false));
    }

    @Test
    @DisplayName("a PATCH to ready-to-move sale clears the stale available date")
    void readyToMoveSalePatchClearsAvailableDate() throws Exception {
        User o = owner("9876300002");
        Property p = approvedSaleListing(o);
        p.setPossession("under-construction");
        p.setFormDetails(Map.of("availableFrom", "2027-01-20", "ownership", "Freehold"));
        properties.saveAndFlush(p);

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"possession\":\"ready-to-move\"}"))
                .andExpect(status().isOk());
        storedListing(o, p.getId())
                .andExpect(jsonPath("$.availableDate").doesNotExist())
                .andExpect(jsonPath("$.formDetails.availableFrom").doesNotExist())
                .andExpect(jsonPath("$.formDetails.ownership").value("Freehold"));
    }

    @Test
    @DisplayName("bhk, type, locality and deal take the listing off search — they change what it is")
    void identityEditsRevert() throws Exception {
        assertRevertsToPending("{\"bhk\":3}");
        assertRevertsToPending("{\"propertyType\":\"villa\"}");
        assertRevertsToPending("{\"locality\":\"Baner\"}");
        assertRevertsToPending("{\"deal\":\"buy\",\"price\":100000}");
    }

    @Test
    @DisplayName("price, furnishing and possession stay live and queue a re-check instead")
    void attributeEditsStayLive() throws Exception {
        assertStaysLiveAndQueuesRecheck("{\"price\":31000}", "price");
        assertStaysLiveAndQueuesRecheck("{\"furnishing\":\"furnished\"}", "furnishing");
        assertStaysLiveAndQueuesRecheck("{\"possession\":\"ready-to-move\"}", "possession");
    }

    @Test
    @DisplayName("a partial PATCH cannot put changed values outside listing sanity limits")
    void partialPatchRejectsChangedSanityLimitViolations() throws Exception {
        User saleOwner = owner("9876541111");
        Property sale = approvedSaleListing(saleOwner);
        mvc.perform(patch("/me/listings/" + sale.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(saleOwner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"price\":85000}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[0].field").value("price"));

        User rentOwner = owner("9876541112");
        Property rent = approvedListing(rentOwner);
        mvc.perform(patch("/me/listings/" + rent.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(rentOwner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deposit\":600001}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[0].field").value("deposit"));

        User areaOwner = owner("9876541113");
        Property area = approvedSaleListing(areaOwner);
        mvc.perform(patch("/me/listings/" + area.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(areaOwner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"carpetArea\":99}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[0].field").value("carpetArea"));

        User dealOwner = owner("9876541114");
        Property deal = approvedListing(dealOwner);
        mvc.perform(patch("/me/listings/" + deal.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(dealOwner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deal\":\"buy\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[0].field").value("price"));

        User typeOwner = owner("9876541115");
        Property type = new Property(typeOwner, "Small godown", "rent", "warehouse",
                25_000L, "Kothrud", "Pune");
        type.setStatus(PropertyStatus.APPROVED);
        type.setLocalitySlug("kothrud");
        type.setCarpetArea(new BigDecimal("50"));
        properties.saveAndFlush(type);
        mvc.perform(patch("/me/listings/" + type.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(typeOwner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyType\":\"Flat / Apartment\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[0].field").value("carpetArea"));

        User reraOwner = owner("9876541118");
        Property rera = approvedSalePlot(reraOwner, "P52100012345", "yes");
        mvc.perform(patch("/me/listings/" + rera.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(reraOwner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reraId\":\"not-a-rera-id\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[0].field").value("reraId"));

        User plottedOwner = owner("9876541119");
        Property plotted = approvedSalePlot(plottedOwner, null, "no");
        mvc.perform(patch("/me/listings/" + plotted.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(plottedOwner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"formDetails\":{\"plottedProject\":\"yes\"}}"))
                .andExpect(status().isOk());
        storedListing(plottedOwner, plotted.getId())
                .andExpect(jsonPath("$.formDetails.plottedProject").value("yes"));
    }

    @Test
    @DisplayName("an address edit stays live and queues a re-check, naming the field")
    void anAddressEditStaysLiveAndQueuesARecheck() throws Exception {
        assertStaysLiveAndQueuesRecheck("{\"address\":\"Flat 902, C Wing, Rohan Nilay\"}", "address");
    }

    @Test
    @DisplayName("photos, description and amenities stay live and queue a re-check")
    void evidenceEditsStayLiveAndQueueARecheck() throws Exception {
        User o = owner("9876300003");
        Property p = approvedListing(o);
        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"images\":[\"" + upload(o) + "\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"))
                .andExpect(jsonPath("$.recheckPending").value(true))
                .andExpect(jsonPath("$.recheckReason").value("images"));
        assertStaysLiveAndQueuesRecheck("{\"description\":\"Newly renovated, south facing.\"}", "description");
        assertStaysLiveAndQueuesRecheck("{\"amenities\":[\"Gym\",\"Lift\"]}", "amenities");
        assertStaysLiveAndQueuesRecheck("{\"video\":\"dQw4w9WgXcQ\"}", "video");
    }

    @Test
    @DisplayName("society and meter edits stay live, queue a re-check, and revoke the ownership badge")
    void societyAndMeterEditsStayLiveAndRevokeOwnership() throws Exception {
        User societyOwner = owner("9876541121");
        Property societyListing = approvedListing(societyOwner);
        societyListing.verifyOwnership(java.time.Instant.now(), null);
        properties.saveAndFlush(societyListing);
        UUID societyId = society("new-recheck-society");

        mvc.perform(patch("/me/listings/" + societyListing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(societyOwner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"societyId\":\"" + societyId + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"))
                .andExpect(jsonPath("$.recheckPending").value(true))
                .andExpect(jsonPath("$.recheckReason").value("societyId"));
        storedListing(societyOwner, societyListing.getId()).andExpect(jsonPath("$.ownershipVerified").value(false));

        User meterOwner = owner("9876541122");
        Property meterListing = approvedListing(meterOwner);
        meterListing.setElectricityMeterNo("170012345678");
        meterListing.verifyOwnership(java.time.Instant.now(), null);
        properties.saveAndFlush(meterListing);

        mvc.perform(patch("/me/listings/" + meterListing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(meterOwner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"electricityMeterNo\":\"170087654321\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"))
                .andExpect(jsonPath("$.recheckPending").value(true))
                .andExpect(jsonPath("$.recheckReason").value("electricityMeterNo"));
        storedListing(meterOwner, meterListing.getId()).andExpect(jsonPath("$.ownershipVerified").value(false));
    }

    @Test
    @DisplayName("address edits revoke ownership while floor and pincode stay ordinary")
    void addressRevokesOwnershipButFloorAndPincodeDoNotRecheck() throws Exception {
        User o = owner("9876541123");
        Property p = approvedListing(o);
        p.verifyOwnership(java.time.Instant.now(), null);
        properties.saveAndFlush(p);

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"address\":\"Flat 902, C Wing\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recheckPending").value(true))
                .andExpect(jsonPath("$.recheckReason").value("address"));
        storedListing(o, p.getId()).andExpect(jsonPath("$.ownershipVerified").value(false));

        User ordinaryOwner = owner("9876541124");
        Property ordinary = approvedListing(ordinaryOwner);
        mvc.perform(patch("/me/listings/" + ordinary.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(ordinaryOwner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"floor\":7,\"pincode\":\"411045\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"))
                .andExpect(jsonPath("$.recheckPending").value(false));
    }

    @Test
    @DisplayName("carpet area re-check starts at twenty percent and map moves at five hundred metres")
    void thresholdedEditsQueueOnlyAfterTheMaterialMove() throws Exception {
        User carpetOwner = owner("9876541125");
        Property carpet = approvedSaleListing(carpetOwner);
        mvc.perform(patch("/me/listings/" + carpet.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(carpetOwner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"carpetArea\":1199}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recheckPending").value(false));

        User materialCarpetOwner = owner("9876541127");
        Property materialCarpet = approvedSaleListing(materialCarpetOwner);
        mvc.perform(patch("/me/listings/" + materialCarpet.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(materialCarpetOwner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"carpetArea\":1200}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recheckPending").value(true))
                .andExpect(jsonPath("$.recheckReason").value("carpetArea"));

        User mapOwner = owner("9876541126");
        Property map = approvedListing(mapOwner);
        map.setLat(18.5204);
        map.setLng(73.8567);
        properties.saveAndFlush(map);
        mvc.perform(patch("/me/listings/" + map.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(mapOwner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"lat\":18.5210,\"lng\":73.8567}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recheckPending").value(false));

        mvc.perform(patch("/me/listings/" + map.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(mapOwner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"lat\":18.5260,\"lng\":73.8567}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recheckPending").value(true))
                .andExpect(jsonPath("$.recheckReason").value("location"));
    }

    @Test
    @DisplayName("RERA and plotted-project evidence changes stay live and queue a re-check")
    void reraEvidenceEditsStayLiveAndQueueARecheck() throws Exception {
        User reraOwner = owner("9876541116");
        Property rera = approvedSalePlot(reraOwner, "P52100012345", "yes");
        mvc.perform(patch("/me/listings/" + rera.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(reraOwner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reraId\":\"P52100012346\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"))
                .andExpect(jsonPath("$.recheckPending").value(true))
                .andExpect(jsonPath("$.recheckReason").value("reraId"));

        User plottedOwner = owner("9876541117");
        Property plotted = approvedSalePlot(plottedOwner, "P52100012345", "no");
        mvc.perform(patch("/me/listings/" + plotted.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(plottedOwner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"formDetails\":{\"plottedProject\":\"yes\"}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"))
                .andExpect(jsonPath("$.recheckPending").value(true))
                .andExpect(jsonPath("$.recheckReason").value("plottedProject"));
    }

    @Test
    @DisplayName("legacy plotted-project RERA gaps do not block unrelated edits")
    void legacyPlottedProjectReraGapAllowsUnrelatedEdits() throws Exception {
        User o = owner("9876541120");
        Property p = approvedSalePlot(o, null, "yes");

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"negotiable\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"))
                .andExpect(jsonPath("$.recheckPending").value(false));
    }

    /** {@code status} staying approved is the mechanism; {@code GET /properties} hard-floors to approved and
     *  un-archived, so this is the promise. */
    @Test
    @DisplayName("a price edit leaves the listing findable in public search, re-check and all")
    void aPriceEditKeepsTheListingInSearch() throws Exception {
        User o = owner("9876533333");
        Property p = approvedListing(o, "Zephyrine Riverside Loft");

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"price\":31000}"))
                .andExpect(status().isOk());

        mvc.perform(get("/properties").param("q", "Zephyrine Riverside Loft"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.id=='" + p.getId() + "')]").exists())
                .andExpect(jsonPath("$.content[?(@.id=='" + p.getId() + "')].price")
                        .value(org.hamcrest.Matchers.contains(31000)));

        assertThat(properties.findById(p.getId()).orElseThrow().isRecheckPending())
                .as("the edit must still be queued for a moderator — staying live is not the same "
                        + "as going unreviewed")
                .isTrue();
    }

    /** A full re-moderation already looks at the whole listing, so queueing the price change too would show
     *  the same edit twice. */
    @Test
    @DisplayName("an edit that trips both halves reverts, and does not also queue a re-check")
    void remoderationSupersedesRecheck() throws Exception {
        User o = owner("9876544444");
        Property p = approvedListing(o);

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"price\":31000,\"bhk\":3}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("pending"))
                .andExpect(jsonPath("$.recheckPending").value(false));
    }

    /** Otherwise the queue only grows and "live but flagged" becomes a flag nobody reads. */
    @Test
    @DisplayName("a moderator setting a status clears the pending re-check")
    void moderatorActionClearsTheRecheck() throws Exception {
        User o = owner("9876555555");
        User staff = new User("9000000001", "staff");
        staff.setName("Ops");
        staff.setMobileVerified(true);
        users.saveAndFlush(staff);
        Property p = approvedListing(o);

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"price\":31000}"))
                .andExpect(jsonPath("$.recheckPending").value(true));

        openCaseAndTickPhotoLine(p, o, staff);
        mvc.perform(patch("/properties/" + p.getId() + "/status")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\",\"reason\":\"price checked\"}"))
                .andExpect(status().isOk());

        assertThat(properties.findById(p.getId()).orElseThrow().isRecheckPending())
                .as("the moderator has looked; the work item is done")
                .isFalse();
    }

    /** Without this, "re-review everything" passes every case above while making a deposit correction cost a
     *  moderator's time. */
    @Test
    @DisplayName("a non-searchable edit still leaves an approved listing approved and unqueued")
    void nonFoundationEditsDoNotRevert() throws Exception {
        User o = owner("9876511111");
        Property p = approvedListing(o);

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deposit\":50000,\"negotiable\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"))
                .andExpect(jsonPath("$.recheckPending").value(false));
    }

    @Test
    @DisplayName("re-sending an unchanged foundation value is not an edit, on either side")
    void unchangedValuesAreNotEdits() throws Exception {
        User o = owner("9876522222");
        Property p = approvedListing(o);

        mvc.perform(patch("/me/listings/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"bhk\":2,\"furnishing\":\"unfurnished\","
                                + "\"possession\":\"under-construction\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("approved"))
                .andExpect(jsonPath("$.recheckPending").value(false));
    }
}
