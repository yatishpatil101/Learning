package com.draazy.api.support;

import com.draazy.api.identity.user.User;
import com.draazy.api.security.BackOfficeFunctions;
import com.draazy.api.security.JwtService;
import com.draazy.api.security.Roles;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

// Spring test annotations must live on the class hierarchy; fields cannot inject the context.
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
public abstract class AbstractApiTest {

    @Autowired
    protected MockMvc mvc;

    @Autowired
    protected JwtService jwtService;

    @Autowired
    protected JdbcTemplate jdbc;

    protected String bearer(User u) {
        grantLegacyStaffFunctions(u);
        return "Bearer " + jwtService.issueAccessToken(u);
    }

    /**
     * A staff account with no stored functions is dashboard-only (fail-closed). Tests written before
     * functions expect the old staff baseline, so they get what V90 gave existing staff: every
     * non-desk function plus their own desk. Tests of the fail-closed path mint tokens directly.
     */
    private void grantLegacyStaffFunctions(User u) {
        if (!Roles.Wire.STAFF.equals(u.getRole()) || u.getId() == null) {
            return;
        }
        List<String> functions = new ArrayList<>(BackOfficeFunctions.CATALOGUE.stream()
                .filter(f -> f.desk() == null).map(BackOfficeFunctions.Function::name).toList());
        if (u.getTeam() != null) {
            functions.add(BackOfficeFunctions.desk(u.getTeam()));
        }
        jdbc.update("INSERT INTO back_office_permissions (user_id, permissions) VALUES (?, ?::jsonb) "
                + "ON CONFLICT DO NOTHING", u.getId(),
                "[\"" + String.join("\",\"", functions) + "\"]");
    }

    protected String listingPhoto(User owner) {
        return "/api/dev/storage/public/photos/" + owner.getId() + "/" + UUID.randomUUID();
    }

    protected String listingImages(User owner) {
        return "\"images\":[\"" + listingPhoto(owner) + "\"]";
    }
}
