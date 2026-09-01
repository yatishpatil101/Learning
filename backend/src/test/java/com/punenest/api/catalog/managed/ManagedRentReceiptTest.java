package com.punenest.api.catalog.managed;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * Manual rent receipts on an owner's managed property — {@code GET}/{@code POST}
 * {@code /me/managed-properties/{id}/rent-receipts} (V120).
 *
 * <p>These replace a {@code localStorage} ledger, so the invariants under test are the ones the
 * browser could never enforce: that the receipt is a <em>snapshot the server composed</em> rather
 * than figures the client sent, that a month can be receipted exactly once, that a foreign id is
 * indistinguishable from an unknown one, and that deleting the property takes its receipts with it.
 *
 * <p>Deliberately unrelated to {@code /me/rent-payments}: those are the tenant's gateway payments
 * whose paid state is webhook-controlled. Nothing here may mark one of those paid, and nothing here
 * reads them.
 */
@DisplayName("Managed property — manual rent receipts")
class ManagedRentReceiptTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    ManagedPropertyRepository managed;

    /* Months are computed, never written down. A receipt may only be recorded for a month that has
     * already happened and is within five years, so a literal `2026-03` would quietly become
     * un-receiptable in 2031 and this suite would fail for a reason that has nothing to do with the
     * code. Three recent months, newest first: MONTH_1 > MONTH_2 > MONTH_3. */
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final String MONTH_1 = YearMonth.now(IST).minusMonths(1).toString();
    private static final String MONTH_2 = YearMonth.now(IST).minusMonths(2).toString();
    private static final String MONTH_3 = YearMonth.now(IST).minusMonths(3).toString();

    private User owner(String mobile, String name) {
        User u = new User(mobile, "owner");
        u.setName(name);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private String register(User o, String body) throws Exception {
        String json = mvc.perform(post(Routes.MeManagedProperties.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json.replaceAll("^.*?\"id\":\"([^\"]+)\".*$", "$1");
    }

    private void patchProperty(User o, String id, String body) throws Exception {
        mvc.perform(patch(Routes.MeManagedProperties.BASE + "/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    /** A property in the one state that can produce a receipt: rented, priced, with a tenant. */
    private String rentedFlat(User o) throws Exception {
        String id = register(o, "{\"deal\":\"rent\",\"propertyType\":\"Flat\",\"bhk\":2,"
                + "\"price\":26000,\"locality\":\"Baner\",\"society\":\"Vista Heights\"}");
        patchProperty(o, id, "{\"rented\":true,\"tenantName\":\"Rohit Kulkarni\",\"monthlyRent\":26000}");
        return id;
    }

    private static String receipts(String id) {
        return Routes.MeManagedProperties.BASE + "/" + id + "/rent-receipts";
    }

    private String recordMonth(User o, String id, String month) throws Exception {
        return mvc.perform(post(receipts(id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rentMonth\":\"" + month + "\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
    }

    // ---------------- the snapshot ----------------

    @Test
    @DisplayName("the server composes amount, tenant, landlord and address — the client sends only a month")
    void create_snapshotsFromTheOwnedProperty() throws Exception {
        User o = owner("9861004001", "Asha Patil");
        String id = rentedFlat(o);

        mvc.perform(post(receipts(id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        // Figures in the body are not part of the contract; if any of them were
                        // honoured an owner could mint a receipt for a rent that was never agreed.
                        .content("{\"rentMonth\":\"" + MONTH_2 + "\",\"amount\":1,"
                                + "\"tenantName\":\"Someone Else\",\"landlordName\":\"Not Asha\","
                                + "\"propertyAddress\":\"Elsewhere\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.rentMonth").value(MONTH_2))
                .andExpect(jsonPath("$.amount").value(26000))
                .andExpect(jsonPath("$.tenantName").value("Rohit Kulkarni"))
                .andExpect(jsonPath("$.landlordName").value("Asha Patil"))
                .andExpect(jsonPath("$.propertyAddress").value("Vista Heights, Baner, Pune"))
                .andExpect(jsonPath("$.id").exists())
                .andExpect(jsonPath("$.createdAt").exists());
    }

    @Test
    @DisplayName("the snapshot survives the property changing underneath it")
    void snapshot_isImmutableOnceWritten() throws Exception {
        User o = owner("9861004002", "Asha Patil");
        String id = rentedFlat(o);
        recordMonth(o, id, MONTH_2);

        // The tenant moves out, a new one moves in at a higher rent. The recorded month still says
        // what that month actually was -- that is the entire point of a receipt.
        patchProperty(o, id, "{\"tenantName\":\"Neha Shah\",\"monthlyRent\":31000}");

        mvc.perform(get(receipts(id)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].tenantName").value("Rohit Kulkarni"))
                .andExpect(jsonPath("$[0].amount").value(26000));

        // Positive anchor: the property really did change, so the assertion above is about the
        // receipt's immutability and not about a patch that silently did nothing.
        mvc.perform(get(Routes.MeManagedProperties.BASE + "/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(jsonPath("$.tenantName").value("Neha Shah"))
                .andExpect(jsonPath("$.monthlyRent").value(31000));
    }

    @Test
    @DisplayName("the receipt id is durable — the same id comes back on a later read")
    void receiptId_isStableAcrossReads() throws Exception {
        User o = owner("9861004003", "Asha Patil");
        String id = rentedFlat(o);
        String created = recordMonth(o, id, MONTH_2);
        String receiptId = created.replaceAll("^.*?\"id\":\"([^\"]+)\".*$", "$1");

        assertThat(receiptId).isNotBlank();
        mvc.perform(get(receipts(id)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(jsonPath("$[0].id").value(receiptId));
    }

    // ---------------- ownership ----------------

    @Test
    @DisplayName("a foreign id and an unknown id are the same 404, on both read and write")
    void ownership_foreignAndUnknownAreIndistinguishable() throws Exception {
        User o = owner("9861004010", "Asha Patil");
        User stranger = owner("9861004011", "Vikram Rao");
        String id = rentedFlat(o);
        recordMonth(o, id, MONTH_2);
        String unknown = UUID.randomUUID().toString();

        mvc.perform(get(receipts(id)).header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());
        mvc.perform(get(receipts(unknown)).header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());
        mvc.perform(post(receipts(id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rentMonth\":\"" + MONTH_1 + "\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(post(receipts(unknown))
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rentMonth\":\"" + MONTH_1 + "\"}"))
                .andExpect(status().isNotFound());

        // Positive anchor: the property and its receipt exist and are readable -- by their owner.
        // Without this the four 404s above would also pass if nothing had been created at all.
        mvc.perform(get(receipts(id)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    @DisplayName("no token, no receipts")
    void anonymous_isRejected() throws Exception {
        User o = owner("9861004012", "Asha Patil");
        String id = rentedFlat(o);

        mvc.perform(get(receipts(id))).andExpect(status().isUnauthorized());
        mvc.perform(post(receipts(id))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rentMonth\":\"" + MONTH_2 + "\"}"))
                .andExpect(status().isUnauthorized());
    }

    // ---------------- parent state ----------------

    @Test
    @DisplayName("a property that is not rented, has no rent, or has no tenant cannot issue a receipt")
    void create_requiresARentableParent() throws Exception {
        User o = owner("9861004020", "Asha Patil");

        // Rent tracking off: the default state of every newly registered property.
        String notRented = register(o, "{\"deal\":\"rent\",\"propertyType\":\"Flat\",\"bhk\":2,"
                + "\"price\":26000,\"locality\":\"Baner\"}");
        mvc.perform(post(receipts(notRented))
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rentMonth\":\"" + MONTH_2 + "\"}"))
                .andExpect(status().isUnprocessableEntity());

        // Rented, but nobody named to receipt it to.
        String noTenant = register(o, "{\"deal\":\"rent\",\"propertyType\":\"Flat\",\"bhk\":2,"
                + "\"price\":26000,\"locality\":\"Baner\"}");
        patchProperty(o, noTenant, "{\"rented\":true}");
        mvc.perform(post(receipts(noTenant))
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rentMonth\":\"" + MONTH_2 + "\"}"))
                .andExpect(status().isUnprocessableEntity());

        // Rented and tenanted, but no amount -- a receipt for zero rupees is not a receipt.
        String noRent = register(o, "{\"deal\":\"buy\",\"propertyType\":\"Flat\",\"bhk\":2,"
                + "\"price\":9000000,\"locality\":\"Baner\"}");
        patchProperty(o, noRent, "{\"rented\":true,\"tenantName\":\"Rohit Kulkarni\"}");
        mvc.perform(post(receipts(noRent))
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rentMonth\":\"" + MONTH_2 + "\"}"))
                .andExpect(status().isUnprocessableEntity());

        // Positive anchor: the same request succeeds the moment the parent is complete, so the three
        // 422s above are about the parent state and not about the request being malformed.
        patchProperty(o, noRent, "{\"monthlyRent\":26000}");
        mvc.perform(post(receipts(noRent))
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rentMonth\":\"" + MONTH_2 + "\"}"))
                .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("a month outside YYYY-MM is a 422, not a row")
    void create_rejectsAMalformedMonth() throws Exception {
        User o = owner("9861004021", "Asha Patil");
        String id = rentedFlat(o);

        for (String bad : new String[] {"2026-13", "2026-00", "26-03", "2026-3", "March 2026", ""}) {
            mvc.perform(post(receipts(id))
                            .header(HttpHeaders.AUTHORIZATION, bearer(o))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"rentMonth\":\"" + bad + "\"}"))
                    .andExpect(status().isUnprocessableEntity());
        }

        mvc.perform(get(receipts(id)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    @DisplayName("a well-formed month can still be out of range: no future, nothing older than five years")
    void create_rejectsAMonthOutsideTheWindow() throws Exception {
        User o = owner("9861004022", "Asha Patil");
        String id = rentedFlat(o);
        YearMonth now = YearMonth.now(IST);

        // All four parse and all four satisfy the YYYY-MM pattern, so nothing but the window rule
        // stands between them and a permanent, immutable, undeletable receipt.
        String[] outOfRange = {
            now.plusMonths(1).toString(),
            now.plusYears(3).toString(),
            now.minusYears(5).minusMonths(1).toString(),
            "0001-01",
        };
        for (String bad : outOfRange) {
            mvc.perform(post(receipts(id))
                            .header(HttpHeaders.AUTHORIZATION, bearer(o))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"rentMonth\":\"" + bad + "\"}"))
                    .andExpect(status().isUnprocessableEntity());
        }

        // The two edges that are in range, so the four above are refused for being out of range and
        // not because the endpoint refuses everything: the month that just ended, and the oldest
        // month still inside the five-year window.
        recordMonth(o, id, now.minusMonths(1).toString());
        recordMonth(o, id, now.minusYears(5).toString());
        mvc.perform(get(receipts(id)).param("months", "24")
                        .header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(jsonPath("$.length()").value(2));
    }

    // ---------------- one receipt per month ----------------

    @Test
    @DisplayName("the second attempt at the same month is a 409 and leaves the first receipt untouched")
    void create_isOneReceiptPerMonth() throws Exception {
        User o = owner("9861004030", "Asha Patil");
        String id = rentedFlat(o);
        String first = recordMonth(o, id, MONTH_2);
        String firstReceiptId = first.replaceAll("^.*?\"id\":\"([^\"]+)\".*$", "$1");

        mvc.perform(post(receipts(id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rentMonth\":\"" + MONTH_2 + "\"}"))
                .andExpect(status().isConflict());

        mvc.perform(get(receipts(id)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(firstReceiptId));

        // The conflict is about the month, not about the property: a different month still records.
        mvc.perform(post(receipts(id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(o))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rentMonth\":\"" + MONTH_1 + "\"}"))
                .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("the same month on two different properties is two receipts, not a conflict")
    void monthUniqueness_isPerProperty() throws Exception {
        User o = owner("9861004031", "Asha Patil");
        String one = rentedFlat(o);
        String two = rentedFlat(o);

        recordMonth(o, one, MONTH_2);
        recordMonth(o, two, MONTH_2);

        mvc.perform(get(receipts(one)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(jsonPath("$.length()").value(1));
        mvc.perform(get(receipts(two)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(jsonPath("$.length()").value(1));
    }

    // ---------------- the list ----------------

    @Test
    @DisplayName("newest month first, and months is a window not a filter")
    void list_isNewestFirstAndWindowed() throws Exception {
        User o = owner("9861004040", "Asha Patil");
        String id = rentedFlat(o);
        // Recorded out of order on purpose: the sort must be by the month, not by insertion.
        recordMonth(o, id, MONTH_3);
        recordMonth(o, id, MONTH_1);
        recordMonth(o, id, MONTH_2);

        mvc.perform(get(receipts(id)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[0].rentMonth").value(MONTH_1))
                .andExpect(jsonPath("$[2].rentMonth").value(MONTH_3));

        mvc.perform(get(receipts(id)).param("months", "2")
                        .header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].rentMonth").value(MONTH_1));

        // An out-of-range window is clamped, not refused: `months` is a page size, and a 422 there
        // would be a puzzle rather than a correction.
        mvc.perform(get(receipts(id)).param("months", "0")
                        .header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
        mvc.perform(get(receipts(id)).param("months", "9999")
                        .header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3));
    }

    @Test
    @DisplayName("a property with no receipts reads as an empty list, not a 404")
    void list_isEmptyBeforeAnythingIsRecorded() throws Exception {
        User o = owner("9861004041", "Asha Patil");
        String id = rentedFlat(o);

        mvc.perform(get(receipts(id)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    // ---------------- cascade ----------------

    @Test
    @DisplayName("deleting the property deletes its receipts")
    void delete_cascadesToReceipts() throws Exception {
        User o = owner("9861004050", "Asha Patil");
        String id = rentedFlat(o);
        recordMonth(o, id, MONTH_2);

        // Positive anchor: the property is deletable only because the receipt did not pin it, and
        // the receipt existed to be cascaded.
        mvc.perform(get(receipts(id)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(jsonPath("$.length()").value(1));

        mvc.perform(delete(Routes.MeManagedProperties.BASE + "/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isNoContent());

        assertThat(managed.findById(UUID.fromString(id))).isEmpty();
        mvc.perform(get(receipts(id)).header(HttpHeaders.AUTHORIZATION, bearer(o)))
                .andExpect(status().isNotFound());
    }
}
