package com.draazy.api.catalog;

import com.draazy.api.support.AbstractApiTest;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.billing.plan.TestPlanGrants;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyPossession;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.JwtService;
import com.draazy.api.security.Roles;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

// Server-side `/properties` invariants: approval floor, owner scope,
// foundation-edit reverts and wire shapes.
class PropertiesEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    TestPlanGrants grants;
    @Autowired
    EntityManager em;

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Asha Patil");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property save(User owner, String title, String deal, String type, BigDecimal bhk,
            long price, String locality, String status, boolean archived) {
        Property p = new Property(owner, title, deal, type, price, locality, "Pune");
        p.setBhk(bhk);
        p.setStatus(status);
        p.setPriceUnit("rent".equals(deal) ? "per-month" : "total");
        p.setArea(new BigDecimal("1000"));
        if (archived) {
            p.archive("test");
        }
        return properties.saveAndFlush(p);
    }

    @Test
    void searchReturnsOnlyApprovedNonArchived_inPageEnvelope() throws Exception {
        User o = owner("9810000001");
        save(o, "Approved A", "rent", "apartment", new BigDecimal("2"), 25000, "Kothrud", "approved", false);
        save(o, "Approved B", "buy", "apartment", new BigDecimal("3"), 9000000, "Baner", "approved", false);
        save(o, "Pending C", "rent", "apartment", new BigDecimal("2"), 20000, "Kothrud", "pending", false);
        save(o, "Archived D", "rent", "apartment", new BigDecimal("2"), 20000, "Kothrud", "approved", true);

        mvc.perform(get("/properties"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(20))
                .andExpect(jsonPath("$.content.length()").value(2))
                .andExpect(jsonPath("$.content[0].status").value("approved"));
    }

    @Test
    void searchFacetsFilterByDealBhkPriceAndQ() throws Exception {
        User o = owner("9810000002");
        save(o, "2BHK Kothrud", "rent", "apartment", new BigDecimal("2"), 25000, "Kothrud", "approved", false);
        save(o, "3BHK Baner", "buy", "villa", new BigDecimal("3"), 9000000, "Baner", "approved", false);

        mvc.perform(get("/properties").param("deal", "rent"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("2BHK Kothrud"));
        mvc.perform(get("/properties").param("bhk", "3"))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("3BHK Baner"));
        mvc.perform(get("/properties").param("minPrice", "100000"))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("3BHK Baner"));
        mvc.perform(get("/properties").param("type", "villa"))
                .andExpect(jsonPath("$.totalElements").value(1));
        mvc.perform(get("/properties").param("q", "baner"))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("3BHK Baner"));
    }

    @Test
    void typesFacetMatchesTheChipTaxonomy_notTheStoredLabel() throws Exception {
        User o = owner("9810000012");

        // The chip taxonomy differs from the free-text {@code property_type} label stored on the row.
        save(o, "Studio unit", "rent", "Studio", new BigDecimal("1"), 18000, "Kothrud", "approved", false);
        save(o, "Penthouse top", "buy", "Penthouse", new BigDecimal("4"), 30000000, "Baner", "approved", false);
        save(o, "Plain apartment", "buy", "apartment", new BigDecimal("2"), 7000000, "Baner", "approved", false);
        save(o, "Row house end", "buy", "Row House", new BigDecimal("3"), 12000000, "Baner", "approved", false);
        save(o, "Corner shop", "rent", "Shop / Showroom", null, 60000, "Baner", "approved", false);
        save(o, "Green acres", "buy", "Farm Land", null, 4000000, "Baner", "approved", false);
        save(o, "Houseboat", "buy", "Houseboat", null, 5000000, "Baner", "approved", false);

        // The Flat chip covers flat-or-studio-or-penthouse and the alias table treats apartment as
        // a flat, so equality against the stored label would match only one of the four.
        mvc.perform(get("/properties").param("types", "flat"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(3));
        mvc.perform(get("/properties").param("types", "house"))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("Row house end"));
        mvc.perform(get("/properties").param("types", "commercial"))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("Corner shop"));
        mvc.perform(get("/properties").param("types", "farmland"))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("Green acres"));

        mvc.perform(get("/properties").param("types", "flat,farmland"))
                .andExpect(jsonPath("$.totalElements").value(4));

        // Facet takes chip keys, not labels — "studio" is a label so it must match nothing, or a
        // test against a column holding the raw label would still pass.
        mvc.perform(get("/properties").param("types", "studio"))
                .andExpect(jsonPath("$.totalElements").value(0));

        // A label the taxonomy has never been taught resolves to a null key, so it answers no chip
        // rather than being misfiled under one. It is still in the unfiltered catalogue.
        mvc.perform(get("/properties").param("types", "flat,house,villa,commercial,farmland,plot"))
                .andExpect(jsonPath("$.totalElements").value(6));
        mvc.perform(get("/properties"))
                .andExpect(jsonPath("$.totalElements").value(7));
    }

    @Test
    void shareChipMatchesShares_andWholeUnitChipsExcludeThem() throws Exception {
        User o = owner("9810000016");

        // Both are stored with a property_type of "Flat", which is how they are really posted: a
        // flatmate room is a room inside a flat. Only the first is a whole unit.
        save(o, "Whole flat", "rent", "Flat", new BigDecimal("2"), 30000, "Baner", "approved", false);

        Property mate = save(o, "Room in a flat", "rent", "Flat", null, 12000, "Baner", "approved", false);
        mate.setRoom("single");
        properties.saveAndFlush(mate);

        mvc.perform(get("/properties").param("types", "flat"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("Whole flat"));
        mvc.perform(get("/properties").param("types", "flatmates"))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("Room in a flat"));

        mvc.perform(get("/properties").param("types", "flat,flatmates"))
                .andExpect(jsonPath("$.totalElements").value(2));
    }

    @Test
    void commercialSubtypeNarrowsWithinCommercial() throws Exception {
        User o = owner("9810000015");
        save(o, "Corner shop", "rent", "Shop / Showroom", null, 60000, "Baner", "approved", false);
        save(o, "Mall unit", "rent", "Retail / Mall Unit", null, 90000, "Baner", "approved", false);
        save(o, "Big godown", "rent", "Warehouse / Godown", null, 70000, "Baner", "approved", false);
        save(o, "Desk space", "rent", "Co-working Space", null, 15000, "Baner", "approved", false);
        save(o, "A flat", "rent", "Flat", new BigDecimal("2"), 20000, "Baner", "approved", false);

        // The top-level chip cannot express this: all four commercial labels share one type key.
        mvc.perform(get("/properties").param("types", "commercial"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(4));

        mvc.perform(get("/properties").param("commercialUses", "warehouse"))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("Big godown"));
        mvc.perform(get("/properties").param("commercialUses", "shop,retail"))
                .andExpect(jsonPath("$.totalElements").value(2));

        mvc.perform(get("/properties").param("commercialUses", "coworking"))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("Desk space"));

        mvc.perform(get("/properties")
                        .param("commercialUses", "office,coworking,shop,retail,warehouse,industrial"))
                .andExpect(jsonPath("$.totalElements").value(4));
    }

    @Test
    void verifiedElementsCountsTheWholeMatch_notThePage() throws Exception {
        User o = owner("9810000013");
        for (int i = 0; i < 5; i++) {
            Property p = save(o, "Verified " + i, "rent", "Flat", new BigDecimal("2"), 20000,
                    "Kothrud", "approved", false);
            p.setOwnerVerified(true);
            properties.saveAndFlush(p);
        }
        save(o, "Plain one", "rent", "Flat", new BigDecimal("2"), 20000, "Kothrud", "approved", false);

        // One row per page: if the count were derived from `content` it could only ever be 0 or 1.
        mvc.perform(get("/properties").param("size", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.totalElements").value(6))
                .andExpect(jsonPath("$.verifiedElements").value(5));

        mvc.perform(get("/properties").param("q", "Plain"))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.verifiedElements").value(0));
    }

    @Test
    void ownershipVerificationThatHasLapsedNeitherCountsNorMatchesItsFilter() throws Exception {
        User o = owner("9810000014");
        Property live = save(o, "Still valid", "buy", "Flat", new BigDecimal("2"), 8000000,
                "Baner", "approved", false);
        live.verifyOwnership(Instant.now().minus(Duration.ofDays(200)),
                Instant.now().plus(Duration.ofDays(30)));
        properties.saveAndFlush(live);

        Property lapsed = save(o, "Expired paperwork", "buy", "Flat", new BigDecimal("2"), 8000000,
                "Baner", "approved", false);
        lapsed.verifyOwnership(Instant.now().minus(Duration.ofDays(400)),
                Instant.now().minus(Duration.ofDays(1)));
        properties.saveAndFlush(lapsed);

        // The card for the lapsed listing shows no ownership badge, because the response field is
        // computed against the clock. The filter and the count must agree with the card.
        mvc.perform(get("/properties").param("ownershipVerified", "true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("Still valid"));
        mvc.perform(get("/properties"))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.verifiedElements").value(1));

        // Ordering must agree with the badge: relevance ranking off the raw column would keep
        // promoting a lapsed listing whose card shows no badge.
        mvc.perform(get("/properties").param("rank", "relevance"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].title").value("Still valid"));
    }

    @Test
    void searchFilterByLocalitySlug() throws Exception {

        jdbc.update("INSERT INTO localities (slug, name) VALUES ('koregaon-park', 'Koregaon Park') "
                + "ON CONFLICT (slug) DO NOTHING");
        User o = owner("9810000009");
        Property kp = save(o, "KP Flat", "rent", "apartment", new BigDecimal("2"), 40000,
                "Koregaon Park", "approved", false);
        kp.setLocalitySlug("koregaon-park");
        properties.saveAndFlush(kp);
        save(o, "Other", "rent", "apartment", new BigDecimal("2"), 25000, "Kothrud", "approved", false);

        mvc.perform(get("/properties").param("locality", "koregaon-park"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("KP Flat"));
    }

    @Test
    void searchFilterByPossession_andNeverMatchesUnstated() throws Exception {
        User o = owner("9810000031");
        Property ready = save(o, "Ready Flat", "buy", "apartment", new BigDecimal("2"), 8000000,
                "Baner", "approved", false);
        ready.setPossession(PropertyPossession.READY_TO_MOVE);
        properties.saveAndFlush(ready);
        Property under = save(o, "Under Flat", "buy", "apartment", new BigDecimal("2"), 7000000,
                "Baner", "approved", false);
        under.setPossession(PropertyPossession.UNDER_CONSTRUCTION);
        properties.saveAndFlush(under);

        // Left unstated on purpose — this is the case the facet must NOT quietly include.
        save(o, "Unstated Plot", "buy", "plot", null, 5000000, "Baner", "approved", false);

        mvc.perform(get("/properties").param("possession", PropertyPossession.READY_TO_MOVE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("Ready Flat"))
                .andExpect(jsonPath("$.content[0].possession").value("ready-to-move"));

        mvc.perform(get("/properties").param("possession", PropertyPossession.UNDER_CONSTRUCTION))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("Under Flat"));

        // All three are searchable without the facet — proving the filter narrows rather than the
        // rows simply being invisible, which is the failure mode this whole change exists to fix.
        mvc.perform(get("/properties"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(3));
    }

    @Test
    void createListingRejectsAnOutOfVocabularyPossession() throws Exception {
        User o = owner("9810000032");
        String body = """
                {"title":"P","deal":"buy","propertyType":"apartment","price":5000000,
                 "locality":"Baner","city":"Pune","possession":"Ready to move"}
                """;
        mvc.perform(post("/me/listings").header("Authorization", bearer(o))
                        .contentType(MediaType.APPLICATION_JSON).content(withPhoto(body, o)))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void createListingAcceptsAValidPossession_andItIsSearchable() throws Exception {
        User o = owner("9810000033");
        String body = """
                {"title":"New Launch Tower","deal":"buy","propertyType":"apartment","price":9000000,
                 "locality":"Baner","city":"Pune","possession":"new-launch"}
                """;
        mvc.perform(post("/me/listings").header("Authorization", bearer(o))
                        .contentType(MediaType.APPLICATION_JSON).content(withPhoto(body, o)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.possession").value("new-launch"));

        properties.findAll().forEach(p -> {
            p.setStatus("approved");
            properties.saveAndFlush(p);
        });

        mvc.perform(get("/properties").param("possession", PropertyPossession.NEW_LAUNCH))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("New Launch Tower"));
    }

    @Test
    void searchStatusParamCannotWidenPastApproved() throws Exception {
        User o = owner("9810000003");
        save(o, "Pending only", "rent", "apartment", new BigDecimal("2"), 20000, "Kothrud", "pending", false);

        mvc.perform(get("/properties").param("status", "pending"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    void searchSummaryUsesContractFieldNames_noOwnerContact() throws Exception {
        User o = owner("9810000004");
        Property p = save(o, "Card", "rent", "apartment", new BigDecimal("2"), 25000, "Kothrud", "approved", false);
        p.setCoverImage("https://img/x.jpg");
        properties.saveAndFlush(p);

        mvc.perform(get("/properties"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].propertyType").value("apartment"))
                .andExpect(jsonPath("$.content[0].bhk").value(2))
                .andExpect(jsonPath("$.content[0].priceUnit").value("per-month"))
                .andExpect(jsonPath("$.content[0].coverImage").value("https://img/x.jpg"))

                // owner contact must never appear in the card projection
                .andExpect(jsonPath("$.content[0].owner").doesNotExist())
                .andExpect(jsonPath("$.content[0].mobile").doesNotExist());
    }

    @Test
    void publicSearchClampsAHostilePageSize() throws Exception {
        User o = owner("9810000019");
        save(o, "Listed", "rent", "apartment", new BigDecimal("2"), 25000, "Kothrud", "approved", false);

        mvc.perform(get("/properties?size=5000"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(100));
    }

    @Test
    void featuredReturnsFeaturedFirst() throws Exception {
        User o = owner("9810000005");
        User paying = owner("9810000025");
        grants.grant(paying.getId(), TestPlanGrants.OWNER_PLUS);
        save(o, "Plain", "rent", "apartment", new BigDecimal("2"), 25000, "Kothrud", "approved", false);
        save(paying, "Featured", "rent", "apartment", new BigDecimal("2"), 25000, "Baner", "approved", false);

        em.clear();

        mvc.perform(get("/properties/featured"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].title").value("Featured"))
                .andExpect(jsonPath("$[0].featured").value(true))
                .andExpect(jsonPath("$[1].featured").value(false));
    }

    @Test
    void featuredLapsesWithTheOwnerPlan() throws Exception {
        User paying = owner("9810000026");
        grants.grant(paying.getId(), TestPlanGrants.OWNER_PLUS);
        save(paying, "Was featured", "rent", "apartment", new BigDecimal("2"), 25000, "Baner", "approved", false);
        jdbc.update("update subscriptions set renews_at = now() - interval '1 day' where user_id = ?", paying.getId());
        em.clear();

        mvc.perform(get("/properties/featured"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].title").value("Was featured"))
                .andExpect(jsonPath("$[0].featured").value(false));
    }

    @Test
    void getPropertyMasksOwnerMobile_bySlugAndId() throws Exception {
        User o = owner("9812345210");
        Property p = save(o, "Detail", "rent", "apartment", new BigDecimal("2"), 25000, "Kothrud", "approved", false);
        p.setSlug("detail-kothrud-ab12");
        p.setDescription("Nice place");
        properties.saveAndFlush(p);

        mvc.perform(get("/properties/" + p.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.description").value("Nice place"))
                .andExpect(jsonPath("$.owner.id").value(o.getId().toString()))
                .andExpect(jsonPath("$.owner.mobile").value("98XXXXX210"));

        mvc.perform(get("/properties/detail-kothrud-ab12"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("detail-kothrud-ab12"))
                .andExpect(jsonPath("$.owner.mobile").value("98XXXXX210"));
    }

    @Test
    void getPropertyNotPublicOrMissingReturns404() throws Exception {
        User o = owner("9810000006");
        Property pending = save(o, "Hidden", "rent", "apartment", new BigDecimal("2"), 25000, "Kothrud", "pending", false);

        mvc.perform(get("/properties/" + pending.getId()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("not_found"));
        mvc.perform(get("/properties/no-such-slug"))
                .andExpect(status().isNotFound());
    }

    @Test
    void myListingsAreOwnerScoped_noCrossOwnerLeak() throws Exception {
        User a = owner("9810000010");
        User b = owner("9810000011");
        save(a, "A1", "rent", "apartment", new BigDecimal("2"), 25000, "Kothrud", "approved", false);
        save(a, "A2 pending", "rent", "apartment", new BigDecimal("2"), 25000, "Kothrud", "pending", false);
        save(b, "B1", "rent", "apartment", new BigDecimal("2"), 25000, "Baner", "approved", false);

        mvc.perform(get("/me/listings").header(HttpHeaders.AUTHORIZATION, bearer(a)))
                .andExpect(status().isOk())

                .andExpect(jsonPath("$.totalElements").value(2));
    }

    @Test
    void myListingsRequiresAuth() throws Exception {
        mvc.perform(get("/me/listings"))
                .andExpect(status().isUnauthorized());
    }

    // The page-size clamp is global, so each endpoint must prove it is still covered.
    @Test
    void myListingsClampsAHostilePageSize() throws Exception {
        User o = owner("9810000018");
        save(o, "Mine", "rent", "apartment", new BigDecimal("2"), 25000, "Kothrud", "approved", false);

        mvc.perform(get("/me/listings?size=5000").header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(100));
    }

    @Test
    void createListingReturns201_pending_serverSetOwner() throws Exception {
        User o = owner("9810000012");
        String body = "{\"title\":\"New Flat\",\"deal\":\"rent\",\"propertyType\":\"apartment\","
                + "\"price\":30000,\"locality\":\"Kothrud\",\"city\":\"Pune\",\"bhk\":2}";

        mvc.perform(post("/me/listings").header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON).content(withPhoto(body, o)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("pending"))
                .andExpect(jsonPath("$.priceUnit").value("per-month"))
                .andExpect(jsonPath("$.owner.id").value(o.getId().toString()));
    }

    @Test
    void createListingResolvesLocalitySlug_andBecomesFindableByTheLocalityFacet() throws Exception {
        jdbc.update("INSERT INTO localities (slug, name) VALUES ('kothrud', 'Kothrud') "
                + "ON CONFLICT (slug) DO NOTHING");
        User o = owner("9810000021");

        String body = "{\"title\":\"Owner Typed\",\"deal\":\"rent\",\"propertyType\":\"apartment\","
                + "\"price\":31000,\"locality\":\"kothrud depot\",\"city\":\"Pune\",\"bhk\":2}";

        mvc.perform(post("/me/listings").header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON).content(withPhoto(body, o)))
                .andExpect(status().isCreated())

                .andExpect(jsonPath("$.locality").value("kothrud depot"))
                .andExpect(jsonPath("$.localitySlug").value("kothrud"));

        // Approve it, then prove the facet actually finds it — the slug is only worth setting if it
        // makes the listing reachable.
        Property saved = properties.findAll().stream()
                .filter(p -> "Owner Typed".equals(p.getTitle())).findFirst().orElseThrow();
        saved.setStatus("approved");
        properties.saveAndFlush(saved);

        mvc.perform(get("/properties").param("locality", "kothrud"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("Owner Typed"))
                .andExpect(jsonPath("$.content[0].localitySlug").value("kothrud"));
    }

    @Test
    void createListingWithUnknownLocalitySucceedsWithoutASlug() throws Exception {
        User o = owner("9810000022");
        String body = "{\"title\":\"Unknown Area\",\"deal\":\"rent\",\"propertyType\":\"apartment\","
                + "\"price\":31000,\"locality\":\"Completely Made Up Area\",\"city\":\"Pune\",\"bhk\":2}";

        mvc.perform(post("/me/listings").header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON).content(withPhoto(body, o)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.locality").value("Completely Made Up Area"))
                .andExpect(jsonPath("$.localitySlug").doesNotExist());
    }

    /** Editing the display locality must re-bind the key, or the listing stays in the old market. */
    @Test
    void updatingLocalityRebindsTheSlug() throws Exception {
        jdbc.update("INSERT INTO localities (slug, name) VALUES ('baner', 'Baner') "
                + "ON CONFLICT (slug) DO NOTHING");
        User o = owner("9810000023");
        Property p = save(o, "Moving", "rent", "apartment", new BigDecimal("2"), 25000,
                "Kothrud", "approved", false);

        mvc.perform(patch("/me/listings/" + p.getId()).header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"locality\":\"Baner\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.localitySlug").value("baner"))

                // locality is a foundation field, so the edit also costs re-moderation
                .andExpect(jsonPath("$.status").value("pending"));
    }

    // Coordinates are non-foundation; re-resolving them would silently move
    // an approved listing into another market's search.
    @Test
    void updatingOnlyCoordinatesDoesNotRebindTheSlug() throws Exception {
        jdbc.update("INSERT INTO localities (slug, name, lat, lng) "
                + "VALUES ('kothrud', 'Kothrud', 18.507, 73.807) ON CONFLICT (slug) DO NOTHING");
        jdbc.update("INSERT INTO localities (slug, name, lat, lng) "
                + "VALUES ('hinjawadi', 'Hinjawadi', 18.591, 73.738) ON CONFLICT (slug) DO NOTHING");
        User o = owner("9810000024");
        Property p = save(o, "Stays Put", "rent", "apartment", new BigDecimal("2"), 25000,
                "Kothrud", "approved", false);
        p.setLocalitySlug("kothrud");
        properties.saveAndFlush(p);

        mvc.perform(patch("/me/listings/" + p.getId()).header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"lat\":18.591,\"lng\":73.738}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.localitySlug").value("kothrud"))
                .andExpect(jsonPath("$.status").value("approved"));
    }

    @Test
    void createListingMissingRequiredFieldReturns422() throws Exception {
        User o = owner("9810000013");
        String body = "{\"deal\":\"rent\",\"propertyType\":\"apartment\",\"price\":30000,"
                + "\"locality\":\"Kothrud\",\"city\":\"Pune\"}";

        mvc.perform(post("/me/listings").header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON).content(withPhoto(body, o)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error").value("validation_failed"))
                .andExpect(jsonPath("$.fields[0].field").value("title"));
    }

    private String withPhoto(String body, User owner) {
        int close = body.lastIndexOf('}');
        return body.substring(0, close) + "," + listingImages(owner) + body.substring(close);
    }

    @Test
    void getMyListingNotOwnedReturns404() throws Exception {
        User a = owner("9810000014");
        User b = owner("9810000015");
        Property aProp = save(a, "A only", "rent", "apartment", new BigDecimal("2"), 25000, "Kothrud", "approved", false);

        mvc.perform(get("/me/listings/" + aProp.getId()).header(HttpHeaders.AUTHORIZATION, bearer(b)))
                .andExpect(status().isNotFound());
    }

    // BHK changes what the listing fundamentally is, so a stale index entry (a 2BHK appearing
    // under 3BHK) would be a wrong answer — the listing comes off search until re-moderation.
    @Test
    void updateIdentityFieldRevertsStatusToPending() throws Exception {
        User o = owner("9810000016");
        Property p = save(o, "Live", "rent", "apartment", new BigDecimal("2"), 25000, "Kothrud", "approved", false);

        mvc.perform(patch("/me/listings/" + p.getId()).header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"bhk\":3}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bhk").value(3))
                .andExpect(jsonPath("$.status").value("pending"))
                .andExpect(jsonPath("$.recheckPending").value(false));
    }

    @Test
    void updatePriceStaysApprovedAndQueuesARecheck() throws Exception {
        User o = owner("9810000029");
        Property p = save(o, "Live", "rent", "apartment", new BigDecimal("2"), 25000, "Kothrud", "approved", false);

        mvc.perform(patch("/me/listings/" + p.getId()).header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"price\":28000}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.price").value(28000))
                .andExpect(jsonPath("$.status").value("approved"))
                .andExpect(jsonPath("$.recheckPending").value(true))
                .andExpect(jsonPath("$.recheckReason").value("price"));
    }

    @Test
    void updateNonFoundationFieldKeepsStatus() throws Exception {
        User o = owner("9810000017");
        Property p = save(o, "Live", "rent", "apartment", new BigDecimal("2"), 25000, "Kothrud", "approved", false);

        mvc.perform(patch("/me/listings/" + p.getId()).header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"description\":\"Updated copy\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.description").value("Updated copy"))
                .andExpect(jsonPath("$.status").value("approved"));
    }

    // PATCH semantics: null on a foundation field means "leave unchanged" — must not clear the
    // value nor trigger re-moderation, or every partial update revert-storms back to pending.
    @Test
    void updateWithNullFoundationFieldLeavesValueAndStatusUnchanged() throws Exception {
        User o = owner("9810000024");
        Property p = save(o, "Live", "rent", "apartment", new BigDecimal("3"), 25000, "Kothrud", "approved", false);

        mvc.perform(patch("/me/listings/" + p.getId()).header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"bhk\":null,\"description\":\"Just a copy tweak\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bhk").value(3))
                .andExpect(jsonPath("$.status").value("approved"));
    }

    @Test
    void archiveHidesFromPublic_thenRestoreResetsPending() throws Exception {
        User o = owner("9810000018");
        Property p = save(o, "ToArchive", "rent", "apartment", new BigDecimal("2"), 25000, "Kothrud", "approved", false);

        mvc.perform(patch("/properties/" + p.getId() + "/archive")
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"sold offline\"}"))
                .andExpect(status().isOk());

        mvc.perform(get("/properties"))
                .andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/properties/" + p.getId()))
                .andExpect(status().isNotFound());

        mvc.perform(patch("/properties/" + p.getId() + "/restore")
                        .header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("pending"));
    }

    @Test
    void archiveByNonOwnerNonStaffReturns404() throws Exception {
        User a = owner("9810000019");
        User b = owner("9810000020");
        Property p = save(a, "A only", "rent", "apartment", new BigDecimal("2"), 25000, "Kothrud", "approved", false);

        mvc.perform(patch("/properties/" + p.getId() + "/archive")
                        .header(HttpHeaders.AUTHORIZATION, bearer(b)))
                .andExpect(status().isNotFound());
    }

    @Test
    void archiveAndRestoreByBackOfficeNeedListingModeration() throws Exception {
        User owner = owner("9810000025");
        Property p = save(owner, "Moderated", "rent", "apartment", new BigDecimal("2"), 25000,
                "Kothrud", "approved", false);
        User denied = staff("9810000026", "[]");
        User moderator = staff("9810000027", "[\"listingModeration\"]");

        mvc.perform(patch("/properties/" + p.getId() + "/archive")
                        .header(HttpHeaders.AUTHORIZATION, bearer(denied)))
                .andExpect(status().isForbidden());

        mvc.perform(patch("/properties/" + p.getId() + "/archive")
                        .header(HttpHeaders.AUTHORIZATION, bearer(moderator)))
                .andExpect(status().isOk());

        mvc.perform(patch("/properties/" + p.getId() + "/restore")
                        .header(HttpHeaders.AUTHORIZATION, bearer(denied)))
                .andExpect(status().isForbidden());

        mvc.perform(patch("/properties/" + p.getId() + "/restore")
                        .header(HttpHeaders.AUTHORIZATION, bearer(moderator)))
                .andExpect(status().isOk());
    }

    private User staff(String mobile, String functionsJson) {
        User u = new User(mobile, Roles.Wire.STAFF);
        u.setName("Listing Moderator");
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        jdbc.update("INSERT INTO back_office_permissions (user_id, permissions) "
                + "VALUES (?::uuid, ?::jsonb)", saved.getId().toString(), functionsJson);
        return saved;
    }
}
