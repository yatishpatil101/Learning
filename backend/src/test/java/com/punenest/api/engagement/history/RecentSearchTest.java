package com.punenest.api.engagement.history;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * The signed-in "resume your search" rail — {@code GET}/{@code PUT} {@code /me/recent-searches}
 * (V121).
 *
 * <p>This replaced a {@code localStorage} bucket keyed by mobile number, so the invariants worth
 * asserting are the ones a browser could not hold: that the trail follows the account across
 * devices, that it is de-duplicated by URL rather than by the label the old client used, that the
 * cap really evicts, that the timestamp is the server's, and that a caller can only ever see their
 * own.
 *
 * <p>The URL rules get the most attention here, because the stored value comes back as a link the
 * account's own UI invites the user to click — a permissive rule would make this table a stored
 * redirect.
 */
@DisplayName("Recent searches — the signed-in resume-your-search rail")
class RecentSearchTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    private static final String PATH = Routes.Engagement.RECENT_SEARCHES;

    private User seeker(String mobile) {
        User u = new User(mobile, "buyer");
        u.setName("Search Person");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private static String body(String label, String url) {
        return "{\"label\":\"" + label + "\",\"url\":\"" + url + "\"}";
    }

    private void record(User u, String label, String url) throws Exception {
        mvc.perform(put(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(label, url)))
                .andExpect(status().isOk());
    }

    // ---------------- auth and isolation ----------------

    @Test
    @DisplayName("anonymous callers get no rail at all — their history stays in the browser")
    void anonymous_isRejected() throws Exception {
        mvc.perform(get(PATH)).andExpect(status().isUnauthorized());
        mvc.perform(put(PATH)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("Rent in Baner", "/listings?loc=baner")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("one account never sees another's searches")
    void isolation_isPerAccount() throws Exception {
        User mine = seeker("9871005001");
        User theirs = seeker("9871005002");
        record(mine, "Rent in Baner", "/listings?deal=rent&loc=baner");

        // Positive anchor first: the row does exist and is readable by the account that wrote it,
        // so the empty rail below is isolation and not a write that failed.
        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(mine)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].url").value("/listings?deal=rent&loc=baner"));

        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(theirs)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    @DisplayName("a fresh account starts empty")
    void freshAccount_hasNoHistory() throws Exception {
        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(seeker("9871005003"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    // ---------------- URL validation ----------------

    @Test
    @DisplayName("only relative URLs on our own search pages are accepted")
    void url_mustBeARelativeSearchUrl() throws Exception {
        User u = seeker("9871005010");
        String[] rejected = {
            "https://evil.test/steal",          // absolute, off-site
            "http://localhost:5173/listings",   // absolute, even to ourselves
            "//evil.test/listings",             // protocol-relative: starts with '/', still off-site
            "/\\evil.test/listings",            // backslash smuggling past a naive relative check
            "javascript:alert(1)",              // not a URL path at all
            "/dashboard",                       // relative and ours, but not a search page
            "/me/profile",                      // ditto, and somewhere we would rather not link
            "listings?deal=rent",               // no leading slash: resolves against the current page
            "/listings?q=<script>",             // characters that are not valid in a URL
        };
        for (String bad : rejected) {
            mvc.perform(put(PATH)
                            .header(HttpHeaders.AUTHORIZATION, bearer(u))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"label\":\"probe\",\"url\":\"" + bad.replace("\\", "\\\\") + "\"}"))
                    .andExpect(status().isUnprocessableEntity());
        }

        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$.length()").value(0));

        // Positive anchor: both allowed pages do go through, so the rejections above are about the
        // URLs and not about the endpoint refusing everything.
        record(u, "Rent in Baner", "/listings?deal=rent&loc=baner");
        record(u, "Flatmates in Kothrud", "/flatmates?view=move-in&loc=kothrud");
        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    @DisplayName("an over-long label or URL is refused at the boundary, not truncated")
    void overlongInput_isRejected() throws Exception {
        User u = seeker("9871005011");

        mvc.perform(put(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("x".repeat(201), "/listings?deal=rent")))
                .andExpect(status().isUnprocessableEntity());

        mvc.perform(put(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("long url", "/listings?q=" + "x".repeat(600))))
                .andExpect(status().isUnprocessableEntity());

        mvc.perform(put(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("", "/listings?deal=rent")))
                .andExpect(status().isUnprocessableEntity());

        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$.length()").value(0));
    }

    // ---------------- de-duplication ----------------

    @Test
    @DisplayName("the same URL is one entry however its label is written")
    void dedupe_isByUrlNotLabel() throws Exception {
        User u = seeker("9871005020");
        record(u, "Rent in Baner", "/listings?deal=rent&loc=baner");
        record(u, "किराया · बाणेर", "/listings?deal=rent&loc=baner");

        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$.length()").value(1))
                // The newer rendering wins: copy and locale change, and the latest is the truer one.
                .andExpect(jsonPath("$[0].label").value("किराया · बाणेर"));
    }

    @Test
    @DisplayName("two different searches that render the same label stay two entries")
    void dedupe_doesNotCollapseOnASharedLabel() throws Exception {
        User u = seeker("9871005021");
        // The old client keyed on the label, so the second of these silently replaced the first.
        record(u, "2 BHK", "/listings?deal=rent&bhk=2");
        record(u, "2 BHK", "/listings?deal=buy&bhk=2");

        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    @DisplayName("parameter order and path case do not make a second entry")
    void dedupe_normalizesTheUrl() throws Exception {
        User u = seeker("9871005022");
        record(u, "Rent in Baner", "/listings?deal=rent&loc=baner");
        record(u, "Rent in Baner", "/listings?loc=baner&deal=rent");
        record(u, "Rent in Baner", "/Listings?deal=rent&loc=baner");

        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].url").value("/listings?deal=rent&loc=baner"));
    }

    // ---------------- ordering, touch and the cap ----------------

    @Test
    @DisplayName("re-running an old search moves it back to the top")
    void touch_movesAnEntryToTheTop() throws Exception {
        User u = seeker("9871005030");
        record(u, "First", "/listings?deal=rent&loc=a");
        record(u, "Second", "/listings?deal=rent&loc=b");

        // Positive anchor: before the touch the order really is Second, First -- so the flip below
        // is the touch and not the natural order.
        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$[0].label").value("Second"))
                .andExpect(jsonPath("$[1].label").value("First"));

        // Same label, same URL: nothing about the row changes except when it happened. This is the
        // case that would silently no-op if the timestamp lived on `updated_at`.
        record(u, "First", "/listings?deal=rent&loc=a");

        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].label").value("First"))
                .andExpect(jsonPath("$[1].label").value("Second"));
    }

    @Test
    @DisplayName("the seventh search leaves exactly the newest six, and the oldest is gone")
    void cap_evictsTheOldest() throws Exception {
        User u = seeker("9871005031");
        for (int n = 1; n <= 6; n++) {
            record(u, "Search " + n, "/listings?deal=rent&loc=l" + n);
        }

        // Positive anchor: the oldest is present at six, so its absence at seven is the eviction.
        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$.length()").value(6))
                .andExpect(jsonPath("$[5].label").value("Search 1"));

        record(u, "Search 7", "/listings?deal=rent&loc=l7");

        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$.length()").value(6))
                .andExpect(jsonPath("$[0].label").value("Search 7"))
                .andExpect(jsonPath("$[5].label").value("Search 2"))
                .andExpect(jsonPath("$[*].label").value(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.hasItem("Search 1"))));
    }

    @Test
    @DisplayName("a touch does not evict — the cap counts rows, not writes")
    void cap_isNotSpentByRepeatingASearch() throws Exception {
        User u = seeker("9871005032");
        for (int n = 1; n <= 6; n++) {
            record(u, "Search " + n, "/listings?deal=rent&loc=l" + n);
        }
        for (int n = 0; n < 5; n++) {
            record(u, "Search 6", "/listings?deal=rent&loc=l6");
        }

        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$.length()").value(6))
                .andExpect(jsonPath("$[5].label").value("Search 1"));
    }

    // ---------------- the timestamp ----------------

    @Test
    @DisplayName("the timestamp is the server's — a client cannot pin an entry to the top")
    void timestamp_isServerGenerated() throws Exception {
        User u = seeker("9871005040");

        // A far-future `at` in the body is not part of the contract; if it were honoured this entry
        // would outrank every real search the user ever makes.
        mvc.perform(put(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"label\":\"Sticky\",\"url\":\"/listings?deal=rent&loc=a\","
                                + "\"at\":\"2099-01-01T00:00:00Z\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].at").exists())
                .andExpect(jsonPath("$[0].at").value(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.startsWith("2099"))));

        record(u, "Later", "/listings?deal=rent&loc=b");
        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$[0].label").value("Later"));
    }

    @Test
    @DisplayName("the write returns the caller's whole rail, so a client never models the eviction")
    void write_returnsTheRail() throws Exception {
        User u = seeker("9871005041");
        record(u, "First", "/listings?deal=rent&loc=a");

        mvc.perform(put(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("Second", "/listings?deal=rent&loc=b")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].label").value("Second"));
    }
}
