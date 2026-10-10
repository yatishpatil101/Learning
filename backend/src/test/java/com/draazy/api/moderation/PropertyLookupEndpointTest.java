package com.draazy.api.moderation;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

@DisplayName("the command palette's property lookup")
class PropertyLookupEndpointTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    private User person(String mobile, String role, String name) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    @Test
    @DisplayName("a hit carries six fields and the owner's name, not the owner's contact details")
    void hitIsSlim() throws Exception {
        User owner = person("9855200001", Roles.Wire.OWNER, "Lookup Owner");
        Property p = new Property(owner, "Zanzibar lookup fixture", "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setStatus("pending");
        properties.saveAndFlush(p);

        mvc.perform(get(Routes.Moderation.ADMIN_PROPERTIES_LOOKUP).param("q", "Zanzibar")
                        .header(HttpHeaders.AUTHORIZATION, bearer(person("9855200002", Roles.Wire.ADMIN, "Reader"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("Zanzibar lookup fixture"))
                .andExpect(jsonPath("$.content[0].owner").value("Lookup Owner"))
                .andExpect(jsonPath("$.content[0].status").value("pending"))
                .andExpect(jsonPath("$.content[0].id").exists())
                .andExpect(jsonPath("$.content[0].price").doesNotExist())
                .andExpect(jsonPath("$.content[0].adminPipeline").doesNotExist());
    }

    @Test
    @DisplayName("only the property desk may read it")
    void guarded() throws Exception {
        mvc.perform(get(Routes.Moderation.ADMIN_PROPERTIES_LOOKUP).param("q", "x")
                        .header(HttpHeaders.AUTHORIZATION, bearer(person("9855200003", Roles.Wire.BUYER, "Buyer"))))
                .andExpect(status().isForbidden());
        mvc.perform(get(Routes.Moderation.ADMIN_PROPERTIES_LOOKUP).param("q", "x"))
                .andExpect(status().isUnauthorized());
    }
}