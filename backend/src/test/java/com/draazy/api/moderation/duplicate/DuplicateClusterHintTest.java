package com.draazy.api.moderation.duplicate;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

@DisplayName("Moderation — duplicate cluster hints")
class DuplicateClusterHintTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    private User user(String mobile, String role) {
        User user = new User(mobile, role);
        user.setName(mobile);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    private Property listing(User owner, UUID societyId, BigDecimal area, String meter) {
        Property property = new Property(owner, "2BHK", "rent", "apartment", 30000L, "Baner", "Pune");
        property.setBhk(new BigDecimal("2"));
        property.setSocietyId(societyId);
        property.setCarpetArea(area);
        property.setElectricityMeterKey(meter);
        property.setStatus(PropertyStatus.PENDING);
        return properties.saveAndFlush(property);
    }

    @Test
    @DisplayName("same society, BHK and carpet area band is a soft staff-only hint on an existing cluster")
    void sameSocietyBhkAreaHint() throws Exception {
        User one = user("9833330101", "owner");
        User two = user("9833330102", "owner");
        User staff = user("9833330103", "staff");
        UUID society = UUID.randomUUID();
        jdbc.update("insert into societies (id, created_at, updated_at, slug, name, registration, conveyance, amenities) "
                        + "values (?, now(), now(), ?, ?, false, false, '[]'::jsonb)",
                society, "cluster-hint-society", "Cluster Hint Society");
        listing(one, society, new BigDecimal("800"), "meter-hint");
        listing(two, society, new BigDecimal("860"), "meter-hint");

        mvc.perform(get("/admin/properties/duplicates")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clusters[0].hints[0].code").value("same_society_bhk_area"))
                .andExpect(jsonPath("$.clusters[0].hints[0].severity").value("soft"));
    }
}
