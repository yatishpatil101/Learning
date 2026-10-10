package com.draazy.api.support;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.JwtService;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;

/** Every request really commits, unlike AbstractApiTest's single transaction where an entity detached in
 * production stays managed and a dependent write is dropped; each test owns and purges its fixtures. */
@SpringBootTest
@AutoConfigureMockMvc
public abstract class AbstractCommittedApiTest {

    private static final String LOCALITY_PREFIX = "committed-smoke-";

    @Autowired
    protected MockMvc mvc;

    @Autowired
    protected JwtService jwtService;

    @Autowired
    protected JdbcTemplate jdbc;

    @Autowired
    protected UserRepository users;

    @Autowired
    private TransactionTemplate tx;

    private final List<UUID> userIds = new ArrayList<>();

    @BeforeEach
    @AfterEach
    void purge() {
        tx.executeWithoutResult(status -> {
            jdbc.execute("set local session_replication_role = replica");
            List<UUID> mine = new ArrayList<>(userIds);
            mine.addAll(jdbc.queryForList("select id from users where mobile like ?", UUID.class,
                    mobilePrefix() + "%"));
            List<UUID> listings = mine.isEmpty() ? List.of() : jdbc.queryForList(
                    "select id from properties where owner_id in (" + literals(mine) + ")", UUID.class);
            deleteWithDependents("properties", listings);
            deleteWithDependents("users", mine);
            jdbc.update("delete from localities where place_id like ?", "fixture-" + LOCALITY_PREFIX + "%");
        });
        userIds.clear();
    }

    /** Every account a test creates starts with this, so a crashed run is swept by the next. */
    protected abstract String mobilePrefix();

    protected User user(String suffix, String role) {
        User u = new User(mobilePrefix() + suffix, role);
        u.setName("Committed " + suffix);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        userIds.add(saved.getId());
        return saved;
    }

    protected String bearer(User u) {
        return "Bearer " + jwtService.issueAccessToken(u);
    }

    /** A live, picked locality of this name for the test; removed with the rest of its fixtures. */
    protected String liveLocality(String name) {
        String slug = LOCALITY_PREFIX + name.toLowerCase().replaceAll("[^a-z0-9]+", "-");
        jdbc.update("""
                insert into localities (slug, name, city, lat, lng, place_id, active)
                values (?, ?, 'Pune', 18.52, 73.85, ?, true)
                on conflict (slug) do nothing
                """, slug, name, "fixture-" + slug);
        return name;
    }

    private void deleteWithDependents(String table, List<UUID> ids) {
        if (ids.isEmpty()) {
            return;
        }
        String in = literals(ids);
        List<Map<String, Object>> referrers = jdbc.queryForList("""
                select c.conrelid::regclass::text as child, a.attname as col
                  from pg_constraint c
                  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
                 where c.contype = 'f' and c.confrelid = ?::regclass and cardinality(c.conkey) = 1
                """, table);
        for (Map<String, Object> ref : referrers) {
            jdbc.update("delete from " + ref.get("child") + " where " + ref.get("col") + " in (" + in + ")");
        }
        jdbc.update("delete from " + table + " where id in (" + in + ")");
    }

    // Ids come from our own rows, so inlining them is safe and avoids a typed array parameter.
    private static String literals(List<UUID> ids) {
        return ids.stream().map(id -> "'" + id + "'::uuid").collect(Collectors.joining(","));
    }
}
