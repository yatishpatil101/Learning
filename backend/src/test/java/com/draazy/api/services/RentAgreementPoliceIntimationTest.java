package com.draazy.api.services;

import static org.hamcrest.Matchers.hasItem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.security.Teams;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

@DisplayName("Rent agreement police intimation — post-registration owner confirmation")
class RentAgreementPoliceIntimationTest extends ServiceFixtures {

    private String completed(User owner, User staff) throws Exception {
        String id = raise(owner, "rent-agreement", listing(owner));
        setStatus(staff, id, "assigned", 200);
        shareDraft(staff, id, 200);
        openDraft(owner, id, 204);
        decide(owner, id, "approve", 200);
        finalDoc(staff, id, 201);
        return id;
    }

    private ResultActions confirm(User caller, String id, String body) throws Exception {
        var call = post(Routes.ServiceRequests.POLICE_INTIMATION, id)
                .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                .contentType(MediaType.APPLICATION_JSON);
        if (body != null) {
            call.content(body);
        }
        return mvc.perform(call);
    }

    @Test
    @DisplayName("a completed rental reads pending until the holder records the owner's confirmation")
    void holderConfirmsAndCustomerReadsDone() throws Exception {
        User owner = customer("9820009101");
        User maker = staff("9820009102", Teams.RENTAL);
        String id = completed(owner, maker);

        mvc.perform(get(Routes.ServiceRequests.BY_ID, id).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.policeIntimation.confirmed").value(false));

        confirm(maker, id, "{\"reference\":\"PCMC-ACK-42\",\"submittedOn\":\"2026-01-16\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.policeIntimation.confirmed").value(true))
                .andExpect(jsonPath("$.policeIntimation.reference").value("PCMC-ACK-42"))
                .andExpect(jsonPath("$.policeIntimation.submittedOn").value("2026-01-16"))
                .andExpect(jsonPath("$.timeline[*].event", hasItem("police-intimation.confirmed")));

        mvc.perform(get(Routes.ServiceRequests.BY_ID, id).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.policeIntimation.confirmed").value(true))
                .andExpect(jsonPath("$.policeIntimation.reference").value("PCMC-ACK-42"));
    }

    @Test
    @DisplayName("the holder can re-record a later acknowledgement")
    void rerecordsConfirmation() throws Exception {
        User owner = customer("9820009111");
        User maker = staff("9820009112", Teams.RENTAL);
        String id = completed(owner, maker);

        confirm(maker, id, "{\"reference\":\"PUNE-OLD\"}").andExpect(status().isOk());
        confirm(maker, id, "{\"reference\":\"PUNE-NEW\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.policeIntimation.reference").value("PUNE-NEW"));
    }

    @Test
    @DisplayName("customers, other desks, non-holders and unfinished requests are refused")
    void refusals() throws Exception {
        User owner = customer("9820009121");
        User holder = staff("9820009122", Teams.RENTAL);
        User colleague = staff("9820009123", Teams.RENTAL);
        User legal = staff("9820009124", Teams.LEGAL);
        String id = completed(owner, holder);

        confirm(owner, id, "{}").andExpect(status().isForbidden());
        confirm(colleague, id, "{}").andExpect(status().isConflict());
        confirm(legal, id, "{}").andExpect(status().isForbidden());
        confirm(holder, id, "{\"submittedOn\":\"2999-01-01\"}")
                .andExpect(status().isUnprocessableEntity());

        String unfinished = raise(owner, "rent-agreement", listing(owner));
        setStatus(holder, unfinished, "assigned", 200);
        confirm(holder, unfinished, "{}").andExpect(status().isConflict());
    }
}
