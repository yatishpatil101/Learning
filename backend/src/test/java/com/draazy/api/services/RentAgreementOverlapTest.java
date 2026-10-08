package com.draazy.api.services;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.security.Teams;
import com.draazy.api.services.request.ServiceRequestStatus;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

// Overlaps flag double-letting and owner conflicts for the desk without blocking early renewals.
@DisplayName("Rent agreement overlaps — other deeds on the same flat, same months")
class RentAgreementOverlapTest extends ServiceFixtures {

    private String raise(User caller, Property property, String licensor, String flatNo, String society,
            String startDate, boolean paid) throws Exception {
        String propertyId = property == null ? "" : "\"propertyId\":\"" + property.getId() + "\",";
        String json = mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"rent-agreement\"," + propertyId
                                + "\"details\":{\"rent\":25000,\"deposit\":100000,\"months\":11,"
                                + "\"startDate\":\"" + startDate + "\",\"_state\":{"
                                + "\"owner\":{\"oName\":\"" + licensor + "\"},"
                                + "\"prop\":{\"gramPanchayat\":false,\"flatNo\":\"" + flatNo + "\",\"society\":\"" + society
                                + "\",\"pincode\":\"411045\"}}}}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = field(json, "id");
        if (paid) {
            requestRepo.findById(UUID.fromString(id))
                    .filter(r -> r.getStatus() == ServiceRequestStatus.AWAITING_PAYMENT)
                    .ifPresent(r -> serviceRequests.applyWebhookOutcome(paymentRef(id), true, 0));
        }
        return id;
    }

    private org.springframework.test.web.servlet.ResultActions overlaps(User caller, String id) throws Exception {
        return mvc.perform(get(Routes.ServiceRequests.OVERLAPS, id)
                .header(HttpHeaders.AUTHORIZATION, bearer(caller)));
    }

    @Test
    @DisplayName("the same listing over the same months is flagged, with a different licensor called out")
    void sameListingOverlapIsFlagged() throws Exception {
        User owner = customer("9820005001");
        User desk = staff("9820005002", Teams.RENTAL);
        Property flat = listing(owner);

        String earlier = raise(owner, flat, "Asha Deshpande", "402", "Green Park", "2026-04-01", true);
        String cancelled = raise(owner, flat, "Asha Deshpande", "402", "Green Park", "2026-05-01", true);
        setStatus(desk, cancelled, "assigned", 200);
        setStatus(desk, cancelled, "cancelled", 200);
        raise(customer("9820005004"), flat, "Asha Deshpande", "402", "Green Park", "2026-05-01", false);
        raise(owner, flat, "Asha Deshpande", "402", "Green Park", "2027-09-01", true);
        String current = raise(customer("9820005003"), flat, "Rohan Patil", "402", "Green Park", "2026-10-01", true);

        overlaps(desk, current)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].requestId").value(earlier))
                .andExpect(jsonPath("$[0].match").value("listing"))
                .andExpect(jsonPath("$[0].status").value("new"))
                .andExpect(jsonPath("$[0].startDate").value("2026-04-01"))
                .andExpect(jsonPath("$[0].endDate").value("2027-03-01"))
                .andExpect(jsonPath("$[0].licensor").value("Asha Deshpande"))
                .andExpect(jsonPath("$[0].licensorDiffers").value(true));
    }

    @Test
    @DisplayName("an unlisted flat matches on flat number, society and pincode, however they were typed")
    void unlistedFlatMatchesOnAddress() throws Exception {
        User desk = staff("9820005012", Teams.RENTAL);
        String first = raise(customer("9820005011"), null, "Asha  Deshpande", "Flat 402", "Green Park, Baner",
                "2026-04-01", true);
        raise(customer("9820005013"), null, "Asha Deshpande", "403", "Green Park, Baner", "2026-04-01", true);
        String second = raise(customer("9820005014"), null, "asha deshpande.", "flat-402", "GREEN PARK BANER",
                "2026-06-01", true);

        overlaps(desk, second)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].requestId").value(first))
                .andExpect(jsonPath("$[0].match").value("address"))
                .andExpect(jsonPath("$[0].licensorDiffers").value(false));
    }

    @Test
    @DisplayName("an unknown term cannot be ruled out, so it is shown with its dates missing")
    void unknownTermIsShown() throws Exception {
        User owner = customer("9820005021");
        User desk = staff("9820005022", Teams.RENTAL);
        Property flat = listing(owner);
        String undated = raise(owner, flat, "Asha Deshpande", "402", "Green Park", "", true);
        String current = raise(owner, flat, "Asha Deshpande", "402", "Green Park", "2026-04-01", true);

        overlaps(desk, current)
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].requestId").value(undated))
                .andExpect(jsonPath("$[0].startDate").isEmpty());
    }

    @Test
    @DisplayName("only the desk reads it")
    void onlyTheDeskReadsIt() throws Exception {
        User owner = customer("9820005031");
        String id = raise(owner, null, "Asha Deshpande", "402", "Green Park", "2026-04-01", true);

        overlaps(owner, id).andExpect(status().isForbidden());
        overlaps(staff("9820005032", Teams.RENTAL), id).andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));
    }
}
