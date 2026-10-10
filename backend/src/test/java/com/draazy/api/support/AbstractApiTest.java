package com.draazy.api.support;

import com.draazy.api.identity.user.User;
import com.draazy.api.security.BackOfficeFunctions;
import com.draazy.api.security.JwtService;
import com.draazy.api.security.Roles;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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

    private static final List<String> COMMON_LOCALITIES = commonLocalities();

    private static List<String> commonLocalities() {
        List<String> names = new ArrayList<>(List.of("Baner", "Kothrud", "Aundh", "Kharadi", "Viman Nagar",
                "Wakad", "Hinjewadi", "Undri", "Magarpatta", "Kalyani Nagar", "DetailTown", "LimitTown", "BudgetFacetTown", "BudgetPostTown",
                "DoubleRoomTown", "ExpiryTown", "GenderFacetTown", "RentFacetTown", "VerdictTown"));
        for (char c = 'A'; c <= 'Z'; c++) {
            for (String prefix : List.of("EditTown", "GateTown", "ExpiryTown", "VerdictTown")) {
                names.add(prefix + c);
            }
        }
        return List.copyOf(names);
    }

    @BeforeEach
    void commonLocalitiesAreLive() {
        liveLocality(COMMON_LOCALITIES.toArray(String[]::new));
    }

    /** Makes each name a live, picked locality for this test (rolled back with it); revives a retired seeded row. */
    protected void liveLocality(String... names) {
        jdbc.update("""
                insert into localities (slug, name, city, lat, lng, place_id, active, archived_at)
                select slug, n, 'Pune', 18.52, 73.85, 'fixture-' || slug, true, null
                from (select n, trim(both '-' from regexp_replace(lower(n), '[^a-z0-9]+', '-', 'g')) as slug
                      from unnest(?::text[]) as n) names
                on conflict (slug) do update set archived_at = null, active = true
                """, (Object) names);
    }

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

    private static final java.util.regex.Pattern SOCIETY_TEXT =
            java.util.regex.Pattern.compile("\"society\"\\s*:\\s*\"([^\"]+)\"");

    /** A community society with this name, created on first use; returns its id. */
    protected UUID societyNamed(String name) {
        String slug = name.toLowerCase().replaceAll("[^a-z0-9]+", "-");
        jdbc.update("INSERT INTO societies (slug, name, source, place_id) VALUES (?, ?, 'community', ?) "
                + "ON CONFLICT (slug) DO NOTHING", slug, name, "test-" + slug);
        return jdbc.queryForObject("SELECT id FROM societies WHERE slug = ?", UUID.class, slug);
    }

    /** Rewrites a legacy typed {@code "society":"X"} body field into the {@code societyId} the API now takes. */
    protected String withSocietyIds(String json) {
        return SOCIETY_TEXT.matcher(json).replaceAll(m ->
                "\"societyId\":\"" + societyNamed(m.group(1)) + "\"");
    }

    protected String listingPhoto(User owner) {
        return "/api/dev/storage/public/photos/" + owner.getId() + "/" + UUID.randomUUID();
    }

    protected String listingImages(User owner) {
        return "\"images\":[\"" + listingPhoto(owner) + "\"]";
    }

    /** The owner's full record. Create, edit and take-down answer only the identity and verdict. */
    protected ResultActions storedListing(User owner, Object id) throws Exception {
        return mvc.perform(get("/me/listings/" + id).header("Authorization", bearer(owner)))
                .andExpect(status().isOk());
    }
}
