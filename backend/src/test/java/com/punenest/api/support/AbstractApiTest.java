package com.punenest.api.support;

import com.punenest.api.identity.user.User;
import com.punenest.api.security.JwtService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * The wiring every HTTP-level test in this codebase was repeating (tech debt D34).
 *
 * <p><strong>What it replaces.</strong> A census at the close of the slice programme found 35 test
 * classes autowiring {@code MockMvc}, 34 autowiring {@code JwtService}, 19 autowiring
 * {@code JdbcTemplate} — and <strong>26 declaring a byte-identical {@code bearer(User)}</strong>.
 * All 25 of the classes that carried the standard helper also carried the identical trio of class
 * annotations ({@code @SpringBootTest}, {@code @AutoConfigureMockMvc}, {@code @Transactional}),
 * with nothing else varying but an optional {@code @DisplayName}. That uniformity is what makes a
 * base class the right answer here rather than a leaky abstraction: there was no variation to
 * flatten.
 *
 * <p><strong>Why a base class and not a {@code @TestComponent}.</strong> The three annotations have
 * to sit on the test class itself or on something it inherits from — they cannot be injected. Once
 * a superclass exists to carry them, the shared fields and {@code bearer()} may as well live there
 * too rather than in a second collaborator the subclass would still have to declare.
 *
 * <p><strong>What deliberately did not move.</strong> The per-feature {@code user(...)} and
 * {@code listing(...)} builders. 24 {@code user()} declarations have <em>19 distinct bodies</em>
 * and 16 {@code listing()} declarations have 9, differing in the display name, locality, price and
 * status each test needs. Hoisting those would mean either a parameter list long enough to be
 * unreadable at the call site, or a default that silently changes what a test is actually
 * asserting about. Duplication that encodes a test's own preconditions is not the duplication D34
 * was about.
 *
 * <p><strong>{@code @Transactional} rolls each test back</strong> — with the standing exception
 * that audit writes run {@code REQUIRES_NEW} and therefore commit regardless, so a test that
 * triggers one still has to clean {@code audit_log} itself.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
public abstract class AbstractApiTest {

    @Autowired
    protected MockMvc mvc;

    @Autowired
    protected JwtService jwtService;

    /**
     * Raw SQL, for the cases where reading through the repositories would prove nothing.
     *
     * <p>Injected for every subclass even though roughly half use it. A field costs one reference
     * to an application-scoped singleton; the alternative — a second base class, or making each
     * subclass re-declare it — costs more than it saves.
     */
    @Autowired
    protected JdbcTemplate jdbc;

    /** The {@code Authorization} header value that authenticates as {@code u}. */
    protected String bearer(User u) {
        return "Bearer " + jwtService.issueAccessToken(u);
    }
}
