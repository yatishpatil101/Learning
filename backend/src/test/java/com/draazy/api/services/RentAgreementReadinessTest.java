package com.draazy.api.services;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.allOf;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.PlatformTime;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

@DisplayName("A rent agreement is not paid for until the Sub-Registrar could register it")
class RentAgreementReadinessTest extends ServiceFixtures {

    private static final String OWNER_AADHAAR = "211122223335";
    private static final String CO_OWNER_AADHAAR = "555566667771";
    private static final String TENANT_AADHAAR = "444455556666";
    private static final String WITNESS_1_AADHAAR = "666677778888";
    private static final String WITNESS_2_AADHAAR = "234567890124";
    private static final List<String> PERSON_PAPERS = List.of("pan", "aadhaar", "photo");

    @AfterEach
    void clearAuditRows() {
        jdbc.update("delete from audit_log where action in "
                + "('service-request.declaration-accepted', 'service-request.identities-recorded')");
    }

    @Nested
    @DisplayName("the checkout gate")
    class Gate {

        @Test
        @DisplayName("names what is missing, then opens once every party, paper and witness is on file")
        void opensOnlyWhenComplete() throws Exception {
            User owner = customer("9820000701");
            String id = create(owner, state("owner", "", "9820000701", "9820000702"), 201);

            checkout(owner, id, 409)
                    .andExpect(jsonPath("$.message", allOf(
                            containsString("Licensor 1 — PAN card"),
                            containsString("and "))));

            identities(owner, id, parties(owner(0, OWNER_AADHAAR), tenant(TENANT_AADHAAR),
                    witnesses()), 204);
            papers(owner, id, "licensor-0-", PERSON_PAPERS);
            upload(owner, id, "ownership-proof");
            checkout(owner, id, 409)
                    .andExpect(jsonPath("$.message", allOf(
                            containsString("Tenant 1 — PAN card"),
                            containsString("Tenant 1 — Passport photo"),
                            not(containsString("Licensor")))));

            papers(owner, id, "tenant-0-", PERSON_PAPERS);
            checkout(owner, id, 200).andExpect(jsonPath("$.paymentSessionId").isNotEmpty());
        }

        @Test
        @DisplayName("police proof checklist items block checkout until filed")
        void policeProofsBlockCheckout() throws Exception {
            User owner = customer("9820000715");
            String tenantJson = "{\"name\":\"Ria Sharma\",\"age\":\"29\",\"addr\":\"FC Road, Pune\","
                    + "\"mobile\":\"9820000716\",\"occupation\":\"salaried\",\"police\":{"
                    + "\"addressProofType\":\"passport\",\"previousSameAsPermanent\":false,"
                    + "\"previous\":{\"address\":\"Old home\",\"pincode\":\"411030\",\"village\":\"Sadashiv Peth\","
                    + "\"policeStation\":\"Vishrambaug\"},\"previousAddressProofType\":\"passport\","
                    + "\"workplaceAddress\":\"Draazy Labs, Baner\",\"workIdProofType\":\"Employee ID\"}}";
            String id = create(owner, "{\"owner\":{\"oName\":\"Asha Patil\",\"oAge\":\"52\","
                    + "\"oAddr\":\"MG Road, Pune\",\"oMobile\":\"9820000715\",\"capacity\":\"owner\"},"
                    + "\"tenants\":[" + tenantJson + "]," + PROP + "," + WITNESSES + "," + TERMS + "}", 201);

            identities(owner, id, parties(owner(0, OWNER_AADHAAR), tenant(TENANT_AADHAAR), witnesses()), 204);
            papers(owner, id, "licensor-0-", PERSON_PAPERS);
            upload(owner, id, "ownership-proof");
            papers(owner, id, "tenant-0-", PERSON_PAPERS);

            checkout(owner, id, 409).andExpect(jsonPath("$.message", allOf(
                    containsString("Tenant 1 — Address proof"),
                    containsString("Tenant 1 — Previous address proof"),
                    containsString("Tenant 1 — Work proof"))));

            upload(owner, id, "tenant-0-addressproof");
            upload(owner, id, "tenant-0-prevaddressproof");
            upload(owner, id, "tenant-0-income");
            checkout(owner, id, 200);
        }

        @Test
        @DisplayName("a request filed before the gram-panchayat question passes on its stamped registration area")
        void legacyRequestWithStampedAreaPassesCheckout() throws Exception {
            User owner = customer("9820000746");
            String id = create(owner, state("owner", "", "9820000746", "9820000747"), 201);
            identities(owner, id, parties(owner(0, OWNER_AADHAAR), tenant(TENANT_AADHAAR), witnesses()), 204);
            papers(owner, id, "licensor-0-", PERSON_PAPERS);
            upload(owner, id, "ownership-proof");
            papers(owner, id, "tenant-0-", PERSON_PAPERS);
            jdbc.update("update service_requests set details = jsonb_set(details, '{_state,prop}', "
                    + "(details->'_state'->'prop') - 'gramPanchayat') where id = ?::uuid", id);
            em.clear();

            checkout(owner, id, 200);
        }

        @Test
        @DisplayName("with neither a stamped area nor the answer, checkout names the gram-panchayat question")
        void noAreaAndNoAnswerBlocksCheckout() throws Exception {
            User owner = customer("9820000748");
            String id = create(owner, state("owner", "", "9820000748", "9820000749"), 201);
            identities(owner, id, parties(owner(0, OWNER_AADHAAR), tenant(TENANT_AADHAAR), witnesses()), 204);
            papers(owner, id, "licensor-0-", PERSON_PAPERS);
            upload(owner, id, "ownership-proof");
            papers(owner, id, "tenant-0-", PERSON_PAPERS);
            jdbc.update("update service_requests set details = "
                    + "jsonb_set(details, '{_state,prop}', (details->'_state'->'prop') - 'gramPanchayat') "
                    + "#- '{regArea}' #- '{_state,regArea}' where id = ?::uuid", id);
            em.clear();

            checkout(owner, id, 409)
                    .andExpect(jsonPath("$.message", containsString("Gram panchayat (Yes or No)")));
        }

        @Test
        @DisplayName("nobody pays without accepting the current declaration, and the acceptance is kept")
        void declarationIsRecorded() throws Exception {
            User owner = customer("9820000744");
            String id = create(owner, state("owner", "", "9820000744", "9820000745"), 201);
            identities(owner, id, parties(owner(0, OWNER_AADHAAR), tenant(TENANT_AADHAAR),
                    witnesses()), 204);
            papers(owner, id, "licensor-0-", PERSON_PAPERS);
            upload(owner, id, "ownership-proof");
            papers(owner, id, "tenant-0-", PERSON_PAPERS);

            checkout(owner, id, null, 409)
                    .andExpect(jsonPath("$.message", containsString("Accept the declaration")));
            checkout(owner, id, "{\"declaration\":\"ra-decl-2020-01\"}", 409);
            checkout(owner, id, 200);

            var rows = jdbc.queryForList("select actor, metadata->>'version' as version,"
                    + " metadata->>'textSha256' as hash from audit_log"
                    + " where action = 'service-request.declaration-accepted' and entity_id = ?", id);
            assertThat(rows).hasSize(1);
            assertThat(rows.get(0)).containsEntry("actor", owner.getId().toString())
                    .containsEntry("version", "ra-decl-2026-09");
            assertThat((String) rows.get(0).get("hash")).hasSize(64);
        }

        @Test
        @DisplayName("a checkout closed without paying is resumed on the same order, not a second one")
        void aClosedCheckoutResumes() throws Exception {
            User owner = customer("9820000730");
            String id = create(owner, state("owner", "", "9820000730", "9820000731"), 201);
            identities(owner, id, parties(owner(0, OWNER_AADHAAR), tenant(TENANT_AADHAAR),
                    witnesses()), 204);
            papers(owner, id, "licensor-0-", PERSON_PAPERS);
            upload(owner, id, "ownership-proof");
            papers(owner, id, "tenant-0-", PERSON_PAPERS);

            String first = field(checkout(owner, id, 200).andReturn().getResponse().getContentAsString(),
                    "paymentSessionId");
            String order = requestRepo.findById(UUID.fromString(id)).orElseThrow().getPaymentRef();

            String second = field(checkout(owner, id, 200).andReturn().getResponse().getContentAsString(),
                    "paymentSessionId");
            assertThat(second).isNotBlank().isNotEqualTo(first);
            assertThat(
                    requestRepo.findById(UUID.fromString(id)).orElseThrow().getPaymentRef())
                    .as("the webhook still finds the one order").isEqualTo(order);
        }

        @Test
        @DisplayName("inviting a co-fill side discards identity scans the requester uploaded for that side")
        void invitePurgesPreUploadedCounterpartyScans() throws Exception {
            User owner = customer("9820000720");
            User tenant = customer("9820000721");
            String id = create(owner, state("owner", "", "9820000720", "9820000721"), 201);

            papers(owner, id, "tenant-0-", PERSON_PAPERS);
            String party = mvc.perform(post(Routes.ServiceRequests.PARTIES, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"role\":\"tenant\",\"mobile\":\"" + tenant.getMobile() + "\"}"))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            mvc.perform(post(Routes.ServiceRequests.INVITE_DECISION, field(party, "id"))
                            .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"decision\":\"accept\"}"))
                    .andExpect(status().isOk());

            read(owner, id).andExpect(jsonPath("$.documents[?(@.category=='tenant-0-aadhaar')]", hasSize(0)));
            upload(owner, id, "tenant-0-aadhaar", 403);
        }

        @Test
        @DisplayName("a co-owner and a power-of-attorney holder each owe their own papers")
        void everyLicensorExecutes() throws Exception {
            User owner = customer("9820000703");
            String coOwners = "[{\"name\":\"Vikram Patil\",\"age\":\"48\",\"addr\":\"Aundh, Pune\",\"mobile\":\"9820000705\","
                    + "\"capacity\":\"co-owner\"}]";
            String id = create(owner, state("poa", coOwners, "9820000703", "9820000704"), 201);

            identities(owner, id, parties(owner(0, OWNER_AADHAAR), tenant(TENANT_AADHAAR),
                    witnesses()), 204);
            papers(owner, id, "licensor-0-", PERSON_PAPERS);
            upload(owner, id, "ownership-proof");
            papers(owner, id, "tenant-0-", PERSON_PAPERS);

            checkout(owner, id, 409)
                    .andExpect(jsonPath("$.message", allOf(
                            containsString("Licensor 1 — Registered power of attorney"),
                            containsString("Licensor 2 — PAN card"))));

            upload(owner, id, "licensor-0-poa");
            identities(owner, id, parties(owner(0, OWNER_AADHAAR), owner(1, CO_OWNER_AADHAAR),
                    tenant(TENANT_AADHAAR), witnesses()), 204);
            papers(owner, id, "licensor-1-", PERSON_PAPERS);
            checkout(owner, id, 200);
        }

        @Test
        @DisplayName("NRI and foreign licensees use the SRO route without Aadhaar")
        void offlineLicenseeSkipsAadhaarIdentity() throws Exception {
            User owner = customer("9820000766");
            String foreignTenant = "{\"name\":\"Ria Sharma\",\"age\":\"29\",\"addr\":\"FC Road, Pune\","
                    + "\"mobile\":\"9820000767\",\"residency\":\"foreign\",\"passport\":\"Z1234567\","
                    + "\"visaOci\":\"OCI-123\"}";
            String id = create(owner, "{\"owner\":{\"oName\":\"Asha Patil\",\"oAge\":\"52\","
                    + "\"oAddr\":\"MG Road, Pune\",\"oMobile\":\"9820000766\",\"capacity\":\"owner\"},"
                    + "\"tenants\":[" + foreignTenant + "]," + PROP + "," + WITNESSES + "," + TERMS + "}", 201);

            identities(owner, id, parties(owner(0, OWNER_AADHAAR), witnesses()), 204);
            papers(owner, id, "licensor-0-", PERSON_PAPERS);
            upload(owner, id, "ownership-proof");
            upload(owner, id, "tenant-0-pan");
            upload(owner, id, "tenant-0-passport");
            upload(owner, id, "tenant-0-visa");
            upload(owner, id, "tenant-0-photo");

            checkout(owner, id, 200);
        }

        @Test
        @DisplayName("entity parties are sent to the legal desk quote flow")
        void entityPartiesAreNotSelfServe() throws Exception {
            User owner = customer("9820000768");
            String id = create(owner, state("owner", "", "9820000768", "9820000769")
                    .replace("\"owner\":{\"oName\"", "\"owner\":{\"type\":\"entity\",\"oName\""), 201);
            identities(owner, id, parties(owner(0, OWNER_AADHAAR), tenant(TENANT_AADHAAR),
                    witnesses()), 204);
            papers(owner, id, "licensor-0-", PERSON_PAPERS);
            upload(owner, id, "ownership-proof");
            papers(owner, id, "tenant-0-", PERSON_PAPERS);

            checkout(owner, id, 409).andExpect(jsonPath("$.message",
                    containsString("legal desk quote flow")));
        }

        @Test
            @DisplayName("missing identity rows are named after the papers are complete")
            void identitiesAreCheckedAfterPapers() throws Exception {
            User owner = customer("9820000706");
            String id = create(owner, state("owner", "", "9820000706", "9820000707"), 201);

                papers(owner, id, "licensor-0-", PERSON_PAPERS);
                upload(owner, id, "ownership-proof");
                papers(owner, id, "tenant-0-", PERSON_PAPERS);

                checkout(owner, id, 409)
                        .andExpect(jsonPath("$.message", allOf(
                                containsString("Licensor 1"),
                                containsString("Tenant 1"),
                                containsString("Witness 1"))));
        }

        @Test
        @DisplayName("a deed with no rent, flat or named parties is not paid for, even with every paper on file")
        void particularsAreCheckedLast() throws Exception {
            User owner = customer("9820000742");
            String id = create(owner, "{\"owner\":{\"oMobile\":\"9820000742\"},"
                    + "\"tenants\":[{\"mobile\":\"9820000743\"}]," + WITNESSES + "}", 201);
            identities(owner, id, parties(owner(0, OWNER_AADHAAR), tenant(TENANT_AADHAAR),
                    witnesses()), 204);
            papers(owner, id, "licensor-0-", PERSON_PAPERS);
            upload(owner, id, "ownership-proof");
            papers(owner, id, "tenant-0-", PERSON_PAPERS);

            checkout(owner, id, 409)
                    .andExpect(jsonPath("$.message", allOf(
                            containsString("Complete the agreement before checkout"),
                            containsString("Monthly rent"),
                            containsString("Flat number"),
                            not(containsString("Witness 1 name")))));
        }
    }

    @Nested
    @DisplayName("the terms are checked when the request is filed")
    class Rules {

        @Test
        @DisplayName("a term, lock-in, due day, increment, start date, visit preference or party the deed cannot carry is a 422")
        void crossFieldRules() throws Exception {
            User owner = customer("9820000708");
            String start = LocalDate.now(PlatformTime.IST).plusDays(7).toString();
            String mobiles = "\"owner\":{\"oMobile\":\"9820000708\"},\"tenants\":[{\"mobile\":\"9820000709\"}]";

            for (String terms : List.of(
                    "{\"months\":\"61\"}",
                    "{\"months\":\"11\",\"lockin\":\"12\"}",
                    "{\"months\":\"11\",\"notice\":\"12\"}",
                    "{\"months\":\"11\",\"dueDay\":\"32\"}",
                    "{\"months\":\"11\",\"increment\":\"101\"}",
                    "{\"months\":\"11\",\"startDate\":\"" + LocalDate.now(PlatformTime.IST).minusDays(31) + "\"}",
                    "{\"months\":\"11\",\"startDate\":\"" + LocalDate.now(PlatformTime.IST).plusDays(181) + "\"}",
                    "{\"months\":\"11\",\"startDate\":\"next week\"}",
                    "{\"months\":\"11\",\"language\":\"Hindi\"}",
                    "{\"months\":\"11\",\"visitAt\":\"office\"}",
                    "{\"months\":\"11\",\"visitSlot\":\"night\"}",
                    "{\"months\":\"11\",\"visitDate\":\"" + LocalDate.now(PlatformTime.IST) + "\"}",
                    "{\"months\":\"11\",\"visitDate\":\"" + LocalDate.now(PlatformTime.IST).plusDays(91) + "\"}",
                    "{\"months\":\"11\",\"visitDate\":\"soon\"}")) {
                create(owner, "{" + mobiles + ",\"terms\":" + terms + "}", 422);
            }
            create(owner, "{" + mobiles + ",\"terms\":{\"months\":\"11\",\"language\":\"Marathi\",\"visitAt\":\"licensee\","
                    + "\"visitSlot\":\"evening\",\"visitDate\":\"" + LocalDate.now(PlatformTime.IST).plusDays(1) + "\"}}", 201);
            create(owner, "{\"owner\":{\"oMobile\":\"9820000708\"},\"tenants\":[{\"mobile\":\"98200 00708\"}],"
                    + "\"terms\":{\"months\":\"11\",\"startDate\":\"" + start + "\"}}", 422);
            create(owner, "{" + mobiles + ",\"wit\":{\"w1Mobile\":\"9820000709\"}}", 422);
            create(owner, "{\"owner\":{\"oMobile\":\"9820000708\",\"capacity\":\"tenant\"}}", 422);
        }

        @Test
        @DisplayName("the invited tenant's half is held to the same rules")
        void coFillHalfIsChecked() throws Exception {
            User owner = customer("9820000710");
            User tenant = customer("9820000711");
            String id = coFill(owner, tenant);

            partyDetails(tenant, id, "{\"_state\":{\"owner\":{\"oMobile\":\"9820000710\"},"
                    + "\"tenants\":[{\"name\":\"Ria\",\"mobile\":\"9820000710\"}]}}", 422);
        }
    }

    @Nested
    @DisplayName("co-fill")
    class CoFill {

        @Test
        @DisplayName("each side writes only its own identities and papers, and only until checkout opens or a purge asks again")
        void eachSideWritesItsOwnHalf() throws Exception {
            User owner = customer("9820000712");
            User tenant = customer("9820000713");
            String id = coFill(owner, tenant, "," + PROP + "," + WITNESSES + ",\"terms\":{\"rent\":\"30000\","
                    + "\"deposit\":\"0\",\"months\":\"11\",\"startDate\":\""
                    + LocalDate.now(PlatformTime.IST).plusDays(7) + "\"}");
            partyDetails(tenant, id, "{\"_state\":{\"owner\":{\"oMobile\":\"9820000712\"},"
                    + "\"tenants\":[{\"name\":\"Ria\",\"age\":\"29\",\"addr\":\"FC Road, Pune\",\"mobile\":\"9820000713\"}]}}", 200);

            identities(tenant, id, parties(owner(0, OWNER_AADHAAR)), 403);
            identities(tenant, id, parties(tenant(TENANT_AADHAAR)), 204);
            identities(owner, id, parties(tenant(TENANT_AADHAAR)), 409);
            identities(owner, id, parties(owner(0, OWNER_AADHAAR), witnesses()), 204);
            upload(tenant, id, "licensor-0-aadhaar", 403);
            upload(tenant, id, " Licensor-0-PAN", 403);
            upload(tenant, id, "ownership-proof", 403);
            upload(owner, id, "tenant-0-aadhaar", 403);
            papers(owner, id, "licensor-0-", PERSON_PAPERS);
            upload(owner, id, "ownership-proof");
            papers(tenant, id, "tenant-0-", PERSON_PAPERS);

            checkout(owner, id, 200).andExpect(jsonPath("$.paymentSessionId").isNotEmpty());
            identities(tenant, id, parties(tenant(TENANT_AADHAAR)), 409);

            em.flush();
            em.clear();
            jdbc.update("update service_request_identities set pan = null, aadhaar = null, purged_at = now()"
                    + " where service_request_id = ?", UUID.fromString(id));
            jdbc.update("insert into service_request_timeline (request_id, event) values (?, 'identities.purged')",
                    UUID.fromString(id));
            identities(tenant, id, parties(owner(0, OWNER_AADHAAR)), 403);
            identities(tenant, id, parties(tenant(TENANT_AADHAAR)), 204);
            identities(tenant, id, parties(tenant(TENANT_AADHAAR)), 409);
        }

        @Test
        @DisplayName("the invited side writes only its own half; the licensor, flat, terms and witnesses stay the requester's")
        void invitedSideWritesOnlyItsOwnHalf() throws Exception {
            User owner = customer("9820000742");
            User tenant = customer("9820000743");
            String id = coFill(owner, tenant, "," + PROP + "," + WITNESSES + "," + TERMS);

            partyDetails(tenant, id, "{\"ownerName\":\"Mallory\",\"_state\":{\"owner\":{\"oName\":\"Mallory\"},"
                    + "\"prop\":{\"flatNo\":\"Z-9\"},\"wit\":{\"w1Name\":\"Eve\"},\"terms\":{\"lockin\":\"1\"},"
                    + "\"tenants\":[" + tenantRow("Ria Sharma", tenant.getMobile()) + "]}}", 200);
            partyDetails(tenant, id, "{\"_state\":{\"tenants\":[]}}", 422);

            Map<String, Object> state = jdbc.queryForMap("select details->'_state'->'owner'->>'oName' as owner,"
                    + " details->'_state'->'prop'->>'flatNo' as flat, details->'_state'->'wit'->>'w1Name' as witness,"
                    + " details->'_state'->'terms'->>'lockin' as lockin, details->>'ownerName' as summary,"
                    + " details->'_state'->'tenants'->0->>'name' as tenant from service_requests where id = ?",
                    UUID.fromString(id));
            assertThat(state).containsEntry("owner", "Asha Patil").containsEntry("flat", "B-1204")
                    .containsEntry("witness", "Suresh Patil").containsEntry("tenant", "Ria Sharma");
            assertThat(state.get("lockin")).isNull();
            assertThat(state.get("summary")).isNotEqualTo("Mallory");
        }

        @Test
        @DisplayName("the invited side cannot move the terms the amount was priced on")
        void invitedSideCannotReprice() throws Exception {
            User owner = customer("9820000740");
            User tenant = customer("9820000741");
            String id = coFill(owner, tenant,
                    "," + PROP + ",\"terms\":{\"rent\":\"20000\",\"deposit\":\"100000\",\"months\":\"22\",\"increment\":\"5\"}");
            String tenantHalf = "\"tenants\":[{\"name\":\"Ria\",\"mobile\":\"9820000741\"}]";

            partyDetails(tenant, id, "{\"_state\":{" + tenantHalf
                    + ",\"terms\":{\"increment\":\"0\"}}}", 409);
            partyDetails(tenant, id, "{\"_state\":{" + tenantHalf
                    + ",\"terms\":{\"incrementEvery\":\"12\"}}}", 409);
            partyDetails(tenant, id, "{\"_state\":{" + tenantHalf
                    + ",\"terms\":{\"rent\":\"20000\",\"incrementEvery\":\"11\"}}}", 200);
        }

        @Test
        @DisplayName("each side opens only its own PAN, Aadhaar and photo scans; ownership proof and ops read both")
        void identityScansStayOnTheirSide() throws Exception {
            User owner = customer("9820000715");
            User tenant = customer("9820000716");
            String id = coFill(owner, tenant);
            upload(owner, id, "licensor-0-pan");
            upload(owner, id, "ownership-proof");
            upload(tenant, id, "tenant-0-aadhaar");

            read(owner, id)
                    .andExpect(jsonPath(url("licensor-0-pan")).value(contains(notNullValue())))
                    .andExpect(jsonPath(url("tenant-0-aadhaar")).value(contains(nullValue())))
                    .andExpect(jsonPath("$.documents[?(@.category=='tenant-0-aadhaar')].fileName")
                            .value(contains(nullValue())));
            read(tenant, id)
                    .andExpect(jsonPath(url("tenant-0-aadhaar")).value(contains(notNullValue())))
                    .andExpect(jsonPath(url("licensor-0-pan")).value(contains(nullValue())))
                    .andExpect(jsonPath(url("ownership-proof")).value(contains(notNullValue())));
            read(admin("9820000717"), id)
                    .andExpect(jsonPath(url("licensor-0-pan")).value(contains(notNullValue())))
                    .andExpect(jsonPath(url("tenant-0-aadhaar")).value(contains(notNullValue())));

            User desk = admin("9820000720");
            mint(owner, id, "licensor-0-pan", desk, 200);
            mint(owner, id, "tenant-0-aadhaar", desk, 404);
            mint(tenant, id, "tenant-0-aadhaar", desk, 200);
            mint(tenant, id, "licensor-0-pan", desk, 404);
            mint(tenant, id, "ownership-proof", desk, 200);
            mint(desk, id, "tenant-0-aadhaar", desk, 200);
        }

        @Test
        @DisplayName("a staff account that is itself a side reads the other side's scans as a customer would")
        void staffPartyGetsNoOpsView() throws Exception {
            User owner = customer("9820000718");
            User staffTenant = admin("9820000719");
            String id = coFill(owner, staffTenant);
            upload(owner, id, "licensor-0-pan");

            read(staffTenant, id).andExpect(jsonPath(url("licensor-0-pan")).value(contains(nullValue())));
        }
    }

    @Test
    @DisplayName("a party's papers upload before any listing exists")
    void papersNeedNoListing() throws Exception {
        User owner = customer("9820000714");
        String id = create(owner, "{\"owner\":{\"oMobile\":\"9820000714\"}}", 201);

        upload(owner, id, "licensor-0-pan");
        mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.propertyId").doesNotExist())
                .andExpect(jsonPath("$.documents[0].category").value("licensor-0-pan"));
    }

    private static final String PROP = "\"prop\":{\"gramPanchayat\":false,\"propType\":\"Flat / Apartment\",\"flatNo\":\"B-1204\","
            + "\"society\":\"Skyline Heights\",\"locality\":\"Baner\",\"pincode\":\"411045\",\"area\":\"850\"}";
    private static final String WITNESSES = "\"wit\":{\"w1Name\":\"Suresh Patil\",\"w1Age\":\"41\","
            + "\"w1Addr\":\"Karve Road, Pune\",\"w2Name\":\"Meera Joshi\",\"w2Age\":\"36\",\"w2Addr\":\"JM Road, Pune\"}";
    private static final String TERMS = "\"terms\":{\"rent\":\"30000\",\"deposit\":\"0\",\"months\":\"11\","
            + "\"startDate\":\"" + LocalDate.now(PlatformTime.IST).plusDays(7) + "\"}";

    private static String tenantRow(String name, String mobile) {
        return "{\"name\":\"" + name + "\",\"age\":\"29\",\"addr\":\"FC Road, Pune\",\"mobile\":\"" + mobile + "\"}";
    }

    private static String state(String capacity, String coOwners, String ownerMobile, String tenantMobile) {
        String start = LocalDate.now(PlatformTime.IST).plusDays(7).toString();
        String poa = "poa".equals(capacity)
                ? ",\"poaPrincipal\":\"Asha Patil\",\"poaRegNo\":\"123\",\"poaSro\":\"Haveli 5\","
                        + "\"poaDate\":\"" + LocalDate.now(PlatformTime.IST).minusDays(1) + "\""
                : "";
        return "{\"owner\":{\"oName\":\"Asha Patil\",\"oAge\":\"52\",\"oAddr\":\"MG Road, Pune\",\"oMobile\":\"" + ownerMobile
                + "\",\"capacity\":\"" + capacity + "\"" + poa + "},"
                + (coOwners.isEmpty() ? "" : "\"coOwners\":" + coOwners + ",")
                + "\"tenants\":[{\"name\":\"Ria Sharma\",\"age\":\"29\",\"addr\":\"FC Road, Pune\",\"mobile\":\"" + tenantMobile
                + "\"}]," + PROP + "," + WITNESSES + ","
                + "\"terms\":{\"months\":\"11\",\"rent\":\"30000\",\"deposit\":\"0\",\"lockin\":\"3\","
                + "\"notice\":\"1\",\"dueDay\":\"5\",\"increment\":\"5\",\"startDate\":\"" + start + "\"}}";
    }

    private static String owner(int index, String aadhaar) {
        return party("owner", index, aadhaar, index == 0 ? "ABCDE1234F" : null);
    }

    private static String tenant(String aadhaar) {
        return party("tenant", 0, aadhaar, "FGHIJ5678K");
    }

    private static String witnesses() {
        return party("witness", 0, WITNESS_1_AADHAAR, null) + "," + party("witness", 1, WITNESS_2_AADHAAR, null);
    }

    private static String party(String role, int index, String aadhaar, String pan) {
        return "{\"partyRole\":\"" + role + "\",\"partyIndex\":" + index + ",\"partyName\":\"" + role + index
                + "\",\"aadhaar\":\"" + aadhaar + "\"" + (pan == null ? "" : ",\"pan\":\"" + pan + "\"") + "}";
    }

    private static String parties(String... rows) {
        return "{\"parties\":[" + String.join(",", rows) + "]}";
    }

    private String create(User caller, String state, int expected) throws Exception {
        var result = mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"rent-agreement\",\"details\":{\"_state\":" + state + "}}"))
                .andExpect(status().is(expected));
        if (expected != 201) {
            return null;
        }
        result.andExpect(jsonPath("$.status").value("awaiting-payment"))
                .andExpect(jsonPath("$.paymentSessionId").doesNotExist());
        return field(result.andReturn().getResponse().getContentAsString(), "id");
    }

    private String coFill(User owner, User tenant) throws Exception {
        return coFill(owner, tenant, "");
    }

    private String coFill(User owner, User tenant, String moreState) throws Exception {
        String created = mvc.perform(post(Routes.ServiceRequests.CO_FILL_CREATE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"request\":{\"type\":\"rent-agreement\",\"details\":{\"_state\":"
                                + "{\"owner\":{\"oName\":\"Asha Patil\",\"oAge\":\"52\",\"oAddr\":\"MG Road, Pune\",\"oMobile\":\""
                                + owner.getMobile() + "\"}" + moreState + "}}},"
                                + "\"role\":\"tenant\",\"mobile\":\"" + tenant.getMobile() + "\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = field(created, "id");
        String invites = mvc.perform(get(Routes.ServiceRequests.MY_INVITES)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        mvc.perform(post(Routes.ServiceRequests.INVITE_DECISION, field(invites, "id"))
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"accept\"}"))
                .andExpect(status().isOk());
        return id;
    }

    private void partyDetails(User caller, String id, String details, int expected) throws Exception {
        mvc.perform(put(Routes.ServiceRequests.PARTY_DETAILS, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"details\":" + details + "}"))
                .andExpect(status().is(expected));
    }

    private void identities(User caller, String id, String body, int expected) throws Exception {
        mvc.perform(put(Routes.ServiceRequests.IDENTITIES, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().is(expected));
    }

    private void papers(User caller, String id, String prefix, List<String> slugs) throws Exception {
        for (String slug : slugs) {
            upload(caller, id, prefix + slug);
        }
    }



    private ResultActions read(User caller, String id) throws Exception {
        return mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().isOk());
    }

    private void mint(User caller, String id, String category, User reader, int expected) throws Exception {
        String body = read(reader, id).andReturn().getResponse().getContentAsString();
        String docId = com.jayway.jsonpath.JsonPath.<java.util.List<String>>read(body,
                "$.documents[?(@.category=='" + category + "')].id").get(0);
        mvc.perform(get(Routes.ServiceRequests.DOC_URL, id, docId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().is(expected));
    }

    private static String url(String category) {
        return "$.documents[?(@.category=='" + category + "')].fileName";
    }

    private ResultActions checkout(User caller, String id, int expected)
            throws Exception {
        return checkout(caller, id, "{\"declaration\":\"ra-decl-2026-09\"}", expected);
    }

    private ResultActions checkout(User caller, String id, String body, int expected)
            throws Exception {
        var call = post(Routes.ServiceRequests.CHECKOUT, id)
                .header(HttpHeaders.AUTHORIZATION, bearer(caller));
        if (body != null) {
            call.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mvc.perform(call).andExpect(status().is(expected));
    }
}
