package com.draazy.api.documents;

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
import com.draazy.api.documents.agreement.RentAgreementRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

class AgreementsAndKycTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    RentAgreementRepository agreements;

    private User user(String mobile) {
        return user(mobile, "owner");
    }

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Asha Patil");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner, String title) {
        Property p = new Property(owner, title, "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        return properties.saveAndFlush(p);
    }

    private UUID unlinked(User owner, Property p) {
        return unlinked(owner, p, "draft");
    }

    private UUID unlinked(User owner, Property p, String status) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into rent_agreements (id, property_id, owner_id, tenant_mobile, rent, status, document_url)
                values (?, ?, ?, '9876543210', 25000, ?, 'https://owner.example/typed.pdf')
                """, id, p.getId(), owner.getId(), status);
        return id;
    }

    @Test
    void createAgreement_isNoLongerAnOwnerSideWrite() throws Exception {
        User owner = user("9820003001");
        Property p = listing(owner, "Agreement flat");

        mvc.perform(post(Routes.MeRentAgreements.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"tenantMobile\":\"9876543210\"}"))
                .andExpect(status().isMethodNotAllowed());
        assertThat(agreements.findAll()).noneMatch(a -> a.getPropertyId().equals(p.getId()));
    }

    @Test
    void myAgreements_hidesAnAgreementTheCallerIsNotAPartyTo() throws Exception {
        User owner = user("9820003006");
        User otherOwner = user("9820003007");
        unlinked(owner, listing(owner, "Mine"));
        unlinked(otherOwner, listing(otherOwner, "Theirs"));

        // The tenant half of the query is an equality on a mobile: this is the assertion that would
        // fail if the null/blank handling ever collapsed into matching every row.
        mvc.perform(get(Routes.MeRentAgreements.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void myAgreements_showsTheTenantAnUnlinkedRowOnlyOnceRegistered_andNeverTheOwnersTypedLink()
            throws Exception {
        User landlord = user("9820003020");
        User tenant = user("9876543210");
        unlinked(landlord, listing(landlord, "Rented out, unconfirmed"));

        mvc.perform(get(Routes.MeRentAgreements.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        unlinked(landlord, listing(landlord, "Rented out, registered"), "registered");
        mvc.perform(get(Routes.MeRentAgreements.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].tenantMobile").value("9876543210"))
                .andExpect(jsonPath("$[0].documentUrl").doesNotExist());
        mvc.perform(get(Routes.MeRentAgreements.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(landlord)))
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].documentUrl").value("https://owner.example/typed.pdf"));
    }

    @Test
    void myAgreements_matchesTheTenantOnTheirOwnNumberOnly() throws Exception {
        User landlord = user("9820003021");
        User bystander = user("9820003022");
        unlinked(landlord, listing(landlord, "Not the bystander's"));

        mvc.perform(get(Routes.MeRentAgreements.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(bystander)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void agreementRoutes_requireAuthentication() throws Exception {
        mvc.perform(get(Routes.MeRentAgreements.BASE)).andExpect(status().isUnauthorized());
    }

    @Test
    void transition_isNotTheOwnersToMake() throws Exception {
        User owner = user("9820003032");
        UUID id = unlinked(owner, listing(owner, "Self-registered flat"));

        mvc.perform(patch(Routes.Moderation.RENT_AGREEMENT_BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"registered\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void transition_ofARowNoPaidRequestProduced_isAnAdminsToRetireAndNobodysToRegister()
            throws Exception {
        User owner = user("9820003033");
        UUID id = unlinked(owner, listing(owner, "Unlinked flat"));
        User desk = user("9877730001", Roles.Wire.STAFF);
        User admin = user("9877730002", Roles.Wire.ADMIN);

        mvc.perform(patch(Routes.Moderation.RENT_AGREEMENT_BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"expired\"}"))
                .andExpect(status().isForbidden());

        mvc.perform(patch(Routes.Moderation.RENT_AGREEMENT_BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"registered\","
                                + "\"documentUrl\":\"https://cdn.draazy.test/ll.pdf\"}"))
                .andExpect(status().isUnprocessableEntity());
        assertThat(agreements.hasRegisteredTenancy(
                agreements.findById(id).orElseThrow().getPropertyId(), "9876543210")).isFalse();

        mvc.perform(patch(Routes.Moderation.RENT_AGREEMENT_BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"expired\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("expired"));
    }

    @Test
    void transition_refusesAStatusThatIsNotOne() throws Exception {
        User owner = user("9820003034");
        UUID id = unlinked(owner, listing(owner, "Made-up status flat"));

        mvc.perform(patch(Routes.Moderation.RENT_AGREEMENT_BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(user("9877730003", Roles.Wire.ADMIN)))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"notarised\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

}
