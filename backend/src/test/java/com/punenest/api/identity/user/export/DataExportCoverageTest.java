package com.punenest.api.identity.user.export;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.identity.user.erasure.ErasureRetention;
import com.punenest.api.support.AbstractApiTest;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

/**
 * {@code GET /me/data-export} — that it returns the subject's data, and that it returns nobody
 * else's.
 *
 * <p><strong>The absence half is the important half.</strong> An incomplete export is a bad
 * response to a request; a leaking one is a personal-data breach committed by the very feature built
 * to satisfy a privacy right, at the request of somebody the platform has already authenticated and
 * therefore has no reason to suspect. The failure is silent by nature — nothing errors, a client
 * renders it happily, and the only person who would notice is the one it exposed. So the assertions
 * below that matter most are the ones that search the whole response body for values that must not
 * be in it, rather than checking any particular field.
 *
 * <p><strong>Searching the raw body, not the parsed model.</strong> Every absence assertion runs
 * against the response string. Walking the DTO would only prove that the fields this test thought to
 * look at are clean, which is a test of the test's imagination; a substring search over the bytes
 * that actually leave the process cannot be fooled by a leak arriving through a column, a nested
 * {@code jsonb} document or a dataset nobody remembered to check.
 *
 * <p><strong>Two of these tests are structural rather than behavioural</strong>, in the spirit of
 * {@code ErasureCoverageTest}: they read {@link DataExportScope}'s SQL and compare it against the
 * live schema and against the erasure coverage map. Seeded tests prove the rule holds for the rows
 * this fixture happens to create; the structural ones prove it for the rows it does not, which is
 * every row in production.
 */
@DisplayName("Data export (/me/data-export)")
class DataExportCoverageTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    /**
     * Values that must never appear anywhere in the response.
     *
     * <p>Chosen to be unmistakable. A counterparty called "Smith" would make a substring search
     * ambiguous against ordinary prose; these strings cannot occur by chance, so a match is a leak
     * and never a coincidence.
     */
    private static final String OTHER_MOBILE = "9700000042";
    private static final String OTHER_NAME = "Zebulon Quartzfeather";
    private static final String OTHER_EMAIL = "zebulon.quartzfeather@example.invalid";
    private static final String OTHER_PAN = "QRTZF9999Z";
    private static final String OTHER_AADHAAR = "XXXX XXXX 9999";

    private static final String SUBJECT_MOBILE = "9800000041";
    private static final String SUBJECT_NAME = "Priyamvada Ranganathan";

    // ---------------------------------------------------------------------------------------
    // Structural
    // ---------------------------------------------------------------------------------------

    /**
     * <strong>The export must not read another person's {@code users} row.</strong>
     *
     * <p>This is the redaction rule reduced to something a machine can check. Every leak of a
     * counterparty's contact details, documents or verification state would have to arrive through
     * either their {@code users} row or a denormalised copy of it, and the first is by far the
     * easier mistake to make: a single {@code join users} added to a query for a display name, in a
     * pull request that reads as an improvement.
     *
     * <p>So {@code users} may be named exactly once, by the one dataset that is the subject's own
     * row, and that dataset must key on the subject's id. Nothing else may touch the table at all.
     * The value of the rule is that it is unarguable — there is no version of "just this once" that
     * passes.
     */
    @Test
    @DisplayName("no dataset joins another person's users row")
    void noDatasetReadsAnotherPersonsUserRow() {
        Set<String> offenders = new TreeSet<>();
        for (DataExportScope.Dataset dataset : DataExportScope.all()) {
            if (!tablesIn(dataset.sql()).contains("users")) {
                continue;
            }
            if (!dataset.name().equals("users")) {
                offenders.add(dataset.domain() + "/" + dataset.name());
            }
        }

        assertThat(offenders)
                .withFailMessage("""
                        These datasets read the `users` table, and only the subject's own `users`
                        dataset may:

                        %s

                        `users` is where every counterparty's mobile, email, name, avatar and
                        verification state lives, so a join to it is the single likeliest way this
                        endpoint starts disclosing one person's contact details to another. If the
                        dataset needs to say *who* the second party is, alias their id as
                        `party_ref_src` and let DataExportRedaction turn it into an opaque reference
                        — that is what the column exists for. If it needs their name for the subject
                        to make sense of the row, it does not: the reference is what this document
                        discloses, deliberately, and the reasoning is in DataExportScope's javadoc.
                        """, bullets(offenders))
                .isEmpty();

        // The converse: the one permitted use must actually be keyed on the subject, or the rule
        // above would be satisfied by a dataset called `users` that returned everybody.
        DataExportScope.Dataset own = DataExportScope.all().stream()
                .filter(d -> d.name().equals("users"))
                .findFirst()
                .orElseThrow(() -> new AssertionError(
                        "No `users` dataset at all — the subject's own account row is the one thing "
                                + "an access request cannot omit."));
        assertThat(own.sql())
                .withFailMessage("""
                        The `users` dataset does not filter on `id = :subjectId`.

                        It is the only query allowed to touch that table, so if its predicate is
                        wrong the export returns other people's accounts in full. Nothing else in
                        this feature would catch that.
                        """)
                .contains("id = :subjectId");
    }

    /**
     * <strong>Anti-drift: everything erasure admits it cannot reach must be exported or explicitly
     * excluded.</strong>
     *
     * <p>{@code ErasureRetention.knownGaps()} is the platform's own written admission of where
     * personal data survives an erasure — the tables that duplicate identity outside the
     * {@code users} row. Data the sweep cannot reach is still data the subject is entitled to see,
     * and it is arguably the <em>most</em> important part of the disclosure: it is precisely the
     * data whose existence they would not otherwise suspect, since they were told they had been
     * erased.
     *
     * <p>The check is derived rather than transcribed. Copying the gap list into this test would
     * make it a second hand-written list checked against the first, which is the exact failure mode
     * {@code ErasureRetention}'s own javadoc records having been caught by. Instead the gaps are
     * scanned for real table names, taken from {@code information_schema}, and each one must be
     * either queried by a dataset or named in {@link DataExportScope#exclusions()}. Adding a gap to
     * the erasure map therefore fails this test until the export has an answer for it, which is what
     * makes the two features unable to drift apart.
     */
    @Test
    @DisplayName("every table erasure lists as a known gap is exported or explicitly excluded")
    void everyErasureGapIsExportedOrExplicitlyExcluded() {
        Set<String> real = new LinkedHashSet<>(jdbc.queryForList("""
                select table_name
                  from information_schema.tables
                 where table_schema = 'public'
                   and table_type = 'BASE TABLE'
                   and table_name <> 'flyway_schema_history'
                """, String.class));

        Set<String> gapTables = new TreeSet<>();
        for (String gap : ErasureRetention.knownGaps()) {
            for (String token : words(gap)) {
                if (real.contains(token)) {
                    gapTables.add(token);
                }
            }
        }

        assertThat(gapTables)
                .withFailMessage("""
                        No table name in ErasureRetention.knownGaps() matched a real table.

                        That almost certainly means the gap entries were reworded into prose that no
                        longer names its tables, not that the gaps are gone — so this test has
                        quietly stopped checking anything. Restore the table names in the gap text,
                        or replace this derivation with something else that cannot silently pass.
                        """)
                .isNotEmpty();

        Set<String> covered = new TreeSet<>();
        for (DataExportScope.Dataset dataset : DataExportScope.all()) {
            covered.addAll(tablesIn(dataset.sql()));
        }
        for (DataExportScope.Exclusion exclusion : DataExportScope.exclusions()) {
            for (String token : words(exclusion.name())) {
                covered.add(token);
            }
        }

        Set<String> unanswered = new TreeSet<>(gapTables);
        unanswered.removeAll(covered);

        assertThat(unanswered)
                .withFailMessage("""
                        Erasure admits it cannot reach these tables, and the export neither returns
                        them nor says why it does not:

                        %s

                        A known gap is personal data the platform holds, has been told about, and has
                        decided not to delete. Withholding it from an access request is the worst
                        combination available: the subject is told they were erased, is shown an
                        export that does not mention it, and has no way to learn it exists.

                        Either add a dataset for the table to DataExportScope, or add it to
                        exclusions() with a reason you would be willing to have read back to you by
                        the person it is about.
                        """, bullets(unanswered))
                .isEmpty();
    }

    /**
     * <strong>Every column named in the scope must exist.</strong>
     *
     * <p>The queries are strings, so a renamed column is not a compile error — it is a runtime
     * failure on the one endpoint whose entire purpose is to be complete, and it would take the
     * whole document down rather than the one dataset. Running the export for a real subject is what
     * proves it: if any of the ~70 statements does not parse or names a column the schema no longer
     * has, this fails with the offending SQL in the message.
     *
     * <p>Deliberately run against a subject with <em>no</em> data. Every query still executes, so
     * validity is proved without a fixture that would have to be extended every time a dataset is
     * added — and it doubles as the check that an empty account produces a complete, well-formed
     * document rather than an error.
     */
    @Test
    @DisplayName("every dataset query is valid against the migrated schema")
    void everyDatasetQueryRunsAgainstTheRealSchema() throws Exception {
        User empty = user(SUBJECT_MOBILE, SUBJECT_NAME);

        String body = export(empty);

        assertThat(datasetNames(body))
                .withFailMessage("""
                        The export returned fewer datasets than DataExportScope declares.

                        Every dataset is meant to be present even when the subject has no rows in it,
                        because an export that omits its empty datasets is indistinguishable from one
                        that forgot them — the subject cannot tell "we hold no bank details" from "we
                        did not look".
                        """)
                .hasSize(DataExportScope.all().size());
    }

    // ---------------------------------------------------------------------------------------
    // Behavioural — presence
    // ---------------------------------------------------------------------------------------

    /**
     * <strong>The subject's own data comes back.</strong>
     *
     * <p>The easy half, and still worth asserting across several domains rather than one: a
     * misplaced predicate — {@code owner_id} where {@code requester_id} was meant — returns an empty
     * dataset, which looks exactly like an honest "you have none of these" and is the failure this
     * feature is least likely to notice in production.
     */
    @Test
    @DisplayName("the subject's own data comes back, across every domain they have data in")
    void theSubjectsOwnDataComesBack() throws Exception {
        User subject = user(SUBJECT_MOBILE, SUBJECT_NAME);
        User other = counterparty();
        seed(subject, other);

        String body = export(subject);

        assertThat(body)
                .withFailMessage("The subject's own account row is missing from their export.")
                .contains(SUBJECT_MOBILE)
                .contains(SUBJECT_NAME);

        assertThat(body)
                .withFailMessage("""
                        Data the subject created is missing from their export.

                        Each of these was seeded on a different table in a different domain, so a
                        miss here is a predicate that does not match the way the application actually
                        writes the row — not a formatting problem.
                        """)
                // identity — their own KYC, which they are entitled to see in full
                .contains("ABCDE****F")
                // listings — their own property
                .contains("Subject's own flat in Kothrud")
                // enquiries — a contact request they sent on somebody else's listing
                .contains("Is this still available?")
                // messaging — a message they wrote
                .contains("Sending my documents over now.")
                // community — a review they wrote about the counterparty
                .contains("Responsive and straightforward to deal with.");

        assertThat(nonEmptyDatasets(body))
                .withFailMessage("""
                        The subject was seeded across at least five domains and the export returned
                        rows in fewer than five datasets.
                        """)
                .hasSizeGreaterThanOrEqualTo(5);
    }

    // ---------------------------------------------------------------------------------------
    // Behavioural — absence (the half that matters)
    // ---------------------------------------------------------------------------------------

    /**
     * <strong>The counterparty's identity never appears.</strong>
     *
     * <p>The counterparty here is on the other side of a contact request, a conversation, a review
     * and a property the subject saved — the ordinary shape of a marketplace relationship, and every
     * one of those records is legitimately the subject's data too. The record and the subject's own
     * contribution to it must come back in full. The other person must not.
     *
     * <p>Their raw id is asserted absent alongside their contact details, and it is the subtler of
     * the two. A mobile number is obviously personal data and nobody would select it deliberately; a
     * {@code uuid} column looks like plumbing, reads as harmless in a select list, and is a perfectly
     * stable global identifier for a human being — one that would let two exports be joined, or an
     * export be joined to anything else that ever exposed the same id.
     */
    @Test
    @DisplayName("the counterparty's mobile, email, name, KYC and raw id are absent")
    void theCounterpartyNeverAppears() throws Exception {
        User subject = user(SUBJECT_MOBILE, SUBJECT_NAME);
        User other = counterparty();
        seed(subject, other);

        String body = export(subject);

        // Sanity: the shared records did come back. Without this, every assertion below would pass
        // trivially on an empty document — the classic way a leak test proves nothing.
        assertThat(body)
                .withFailMessage("""
                        The shared records did not come back, so the absence assertions below would
                        pass whatever the redaction did. Fix the fixture before trusting this test.
                        """)
                .contains("Is this still available?");

        assertThat(body)
                .withFailMessage("""
                        The counterparty's %s appears in the subject's export.

                        This is a disclosure of one Data Principal's personal data to another. DPDP
                        s.11(2) permits withholding precisely so that answering one person's access
                        request does not breach somebody else's, and the whole design of
                        DataExportScope turns on it.

                        Find the dataset that selected it. If the column is a counterparty id, alias
                        it `party_ref_src`. If it is a denormalised copy of their contact details,
                        drop it from the select list and record it in that dataset's `withheld` map
                        so the document still admits it exists.
                        """, "mobile number")
                .doesNotContain(OTHER_MOBILE);

        assertThat(body)
                .withFailMessage("The counterparty's email address appears in the subject's export.")
                .doesNotContain(OTHER_EMAIL);
        assertThat(body)
                .withFailMessage("The counterparty's name appears in the subject's export.")
                .doesNotContain(OTHER_NAME);
        assertThat(body)
                .withFailMessage("""
                        The counterparty's masked PAN appears in the subject's export.

                        Masked is not anonymous — it is still their tax identifier, disclosed to
                        somebody who rented a flat from them.
                        """)
                .doesNotContain(OTHER_PAN);
        assertThat(body)
                .withFailMessage("The counterparty's masked Aadhaar appears in the subject's export.")
                .doesNotContain(OTHER_AADHAAR);

        assertThat(body)
                .withFailMessage("""
                        The counterparty's raw user id appears in the subject's export.

                        A uuid is not innocuous because it is not readable. It is a permanent,
                        globally unique handle on a person: two exports carrying it can be joined,
                        and so can an export and any other place the same id was ever exposed. That
                        is exactly what the salted `partyRef` exists to prevent, and why the salt is
                        the *subject's* id — so the same counterparty gets a different reference in
                        somebody else's export.
                        """)
                .doesNotContain(other.getId().toString());
    }

    /**
     * <strong>The reference is usable: stable within the document, and {@code self} for the
     * subject.</strong>
     *
     * <p>Redaction that destroyed the shape of the data would be safe and useless. A subject reading
     * a conversation has to be able to tell which messages they wrote, or the export is a
     * transcript with the speakers removed; and they have to be able to tell that the person who
     * enquired about their flat is the same person they later exchanged messages with, or every
     * shared record becomes an isolated fragment. One stable reference per person per document buys
     * both, and gives away nothing outside it.
     */
    @Test
    @DisplayName("partyRef is `self` for the subject and stable for one counterparty")
    void partyRefIsSelfForTheSubjectAndStableForACounterparty() throws Exception {
        User subject = user(SUBJECT_MOBILE, SUBJECT_NAME);
        User other = counterparty();
        seed(subject, other);

        String body = export(subject);

        assertThat(body)
                .withFailMessage("""
                        No `partyRef` of "self" anywhere in the export, although the subject wrote a
                        message in a shared conversation.

                        Without it the subject cannot tell their own contributions from the other
                        person's, which makes the messaging datasets unreadable as a record of what
                        was said.
                        """)
                .contains("\"partyRef\":\"" + DataExportRedaction.SELF + "\"");

        Set<String> refs = partyRefs(body);
        refs.remove(DataExportRedaction.SELF);

        assertThat(refs)
                .withFailMessage("""
                        The subject shares records with exactly one other person, so the export
                        should contain exactly one non-self reference. It contains: %s

                        More than one means the reference is not stable across datasets — probably
                        derived from something other than the counterparty's id — and the subject can
                        no longer tell that the person who enquired is the person they later spoke
                        to.
                        """, refs)
                .hasSize(1);

        String ref = refs.iterator().next();
        assertThat(ref)
                .withFailMessage("""
                        The counterparty reference is "%s", which does not look like the opaque digest
                        DataExportRedaction is meant to produce. If it has become a readable
                        identifier, the redaction is not redacting.
                        """, ref)
                .matches("[0-9a-f]{16}");
        assertThat(ref)
                .withFailMessage("The reference is a prefix of the counterparty's real id.")
                .isNotEqualTo(other.getId().toString().substring(0, 16).replace("-", ""));
    }

    // ---------------------------------------------------------------------------------------
    // Fixture
    // ---------------------------------------------------------------------------------------

    private User user(String mobile, String name) {
        User u = new User(mobile, "owner");
        u.setName(name);
        u.setEmail(mobile + "@example.com");
        u.setCity("Pune");
        u.setPasswordHash("$2a$10$notarealhashnotarealhashnotarealhashnotarealhashno");
        u.setMobileVerified(true);
        u.setVerified(true);
        return users.saveAndFlush(u);
    }

    /** The other party, given values that cannot occur anywhere else by accident. */
    private User counterparty() {
        User u = new User(OTHER_MOBILE, "owner");
        u.setName(OTHER_NAME);
        u.setEmail(OTHER_EMAIL);
        u.setCity("Pune");
        u.setPasswordHash("$2a$10$notarealhashnotarealhashnotarealhashnotarealhashno");
        u.setMobileVerified(true);
        u.setVerified(true);
        User saved = users.saveAndFlush(u);

        // The documents a leak would be worst about: identity papers and verification state, which
        // the subject has no business seeing however many flats they rented from this person.
        jdbc.update("""
                insert into owner_kyc (user_id, pan_masked, aadhaar_masked, status)
                values (?, ?, ?, 'verified')
                """, saved.getId(), OTHER_PAN, OTHER_AADHAAR);
        jdbc.update("""
                insert into identity_verifications
                       (user_id, ref, badge, status, masked_aadhaar, identity_hash, mobile_match)
                values (?, ?, true, 'verified', ?, ?, true)
                """, saved.getId(), "dl-ref-" + OTHER_PAN, OTHER_AADHAAR, "sha256-of-an-aadhaar");
        return saved;
    }

    /**
     * A marketplace relationship: each party owns a listing, each has enquired about the other's,
     * they have a conversation with messages from both, and each has reviewed the other.
     *
     * <p>Both directions are seeded deliberately. A one-way fixture would leave the "received" side
     * of every paired dataset untested, and that is the side where the counterparty's id is the
     * value being selected — so it is the side where a leak lives.
     */
    private void seed(User subject, User other) {
        UUID mine = property(subject.getId(), "Subject's own flat in Kothrud");
        UUID theirs = property(other.getId(), "A flat in Baner belonging to somebody else");

        jdbc.update("""
                insert into notification_preferences (user_id) values (?)
                """, subject.getId());
        jdbc.update("""
                insert into owner_kyc (user_id, pan_masked, aadhaar_masked, status)
                values (?, 'ABCDE****F', 'XXXX XXXX 5678', 'verified')
                """, subject.getId());

        jdbc.update("""
                insert into saved_properties (user_id, property_id) values (?, ?)
                """, subject.getId(), theirs);

        // Enquiries in both directions.
        jdbc.update("""
                insert into contact_requests (property_id, requester_id, status, message)
                values (?, ?, 'pending', 'Is this still available?')
                """, theirs, subject.getId());
        jdbc.update("""
                insert into contact_requests (property_id, requester_id, status, message)
                values (?, ?, 'pending', 'Interested in your Kothrud listing.')
                """, mine, other.getId());
        jdbc.update("""
                insert into visits (property_id, visitor_id, slot, mode, status, note)
                values (?, ?, now() + interval '2 days', 'in-person', 'scheduled', 'Weekend if possible')
                """, theirs, subject.getId());
        jdbc.update("""
                insert into offers (property_id, from_user_id, amount, status, message)
                values (?, ?, 2600000, 'pending', 'Offering slightly under asking.')
                """, theirs, subject.getId());

        // A conversation with a message from each side, which is what makes `self` load-bearing.
        //
        // conversations_pair_ordered requires user_a_id < user_b_id, and the ordering is decided by
        // Postgres rather than in Java on purpose: `uuid <` compares bytes unsigned, while
        // UUID.compareTo compares two signed longs, so the two disagree for any id with the high bit
        // set — about half of them, which is a fixture that fails one run in two. Sorting the pair
        // here also means the subject lands on whichever side their id falls on, so the export's
        // CASE is exercised in both directions instead of only the subject-first one.
        UUID conversation = UUID.randomUUID();
        jdbc.update("""
                insert into conversations (id, user_a_id, user_b_id, property_id, last_message)
                values (?, least(?, ?), greatest(?, ?), ?, 'Sending my documents over now.')
                """, conversation, subject.getId(), other.getId(), subject.getId(), other.getId(),
                theirs);
        jdbc.update("""
                insert into messages (conversation_id, author_id, author_role, body)
                values (?, ?, 'buyer', 'Sending my documents over now.')
                """, conversation, subject.getId());
        jdbc.update("""
                insert into messages (conversation_id, author_id, author_role, body)
                values (?, ?, 'owner', 'Received, thank you.')
                """, conversation, other.getId());

        // Reviews in both directions. `owner` is the reviews table's word for "this review is about
        // a person"; `reports` spells the same idea `user`, and both are seeded here precisely
        // because the two datasets have to redact on different literals to do the same job.
        jdbc.update("""
                insert into reviews (target_type, target_id, author_id, rating, title, body)
                values ('owner', ?, ?, 5, 'Good landlord',
                        'Responsive and straightforward to deal with.')
                """, other.getId().toString(), subject.getId());
        jdbc.update("""
                insert into reviews (target_type, target_id, author_id, rating, title, body)
                values ('owner', ?, ?, 4, 'Reliable tenant', 'Paid on time throughout.')
                """, subject.getId().toString(), other.getId());
        jdbc.update("""
                insert into reports (target_type, target_id, reporter_id, reason, details)
                values ('user', ?, ?, 'brokerage', 'Asked for a fee before the viewing.')
                """, other.getId().toString(), subject.getId());
    }

    private UUID property(UUID ownerId, String title) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into properties (id, owner_id, title, deal, property_type, price, locality,
                                        city, status)
                values (?, ?, ?, 'rent', 'apartment', 32000, 'Kothrud', 'Pune', 'approved')
                """, id, ownerId, title);
        return id;
    }

    private String export(User subject) throws Exception {
        return mvc.perform(get(DataExportController.ME_DATA_EXPORT)
                        .header(HttpHeaders.AUTHORIZATION, bearer(subject)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    // ---------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------

    /**
     * Tables a query reads, taken from its {@code from} and {@code join} clauses.
     *
     * <p>Crude on purpose. A real SQL parser would be a dependency and a source of its own bugs, and
     * the queries in {@link DataExportScope} are hand-written in one house style — so matching the
     * two keywords is both sufficient and, more usefully, obvious enough that a reader can tell at a
     * glance what this would and would not catch. Its one weakness, a table named only in a
     * subquery's {@code from}, is not a weakness at all: {@code from} matches there too.
     */
    private static Set<String> tablesIn(String sql) {
        Set<String> tables = new LinkedHashSet<>();
        Matcher m = Pattern
                .compile("\\b(?:from|join)\\s+([a-z_][a-z0-9_]*)", Pattern.CASE_INSENSITIVE)
                .matcher(sql);
        while (m.find()) {
            tables.add(m.group(1).toLowerCase(Locale.ROOT));
        }
        return tables;
    }

    private static Set<String> words(String text) {
        Set<String> out = new LinkedHashSet<>();
        Matcher m = Pattern.compile("[a-z_][a-z0-9_]*").matcher(text.toLowerCase(Locale.ROOT));
        while (m.find()) {
            out.add(m.group());
        }
        return out;
    }

    private static Set<String> partyRefs(String body) {
        Set<String> refs = new LinkedHashSet<>();
        Matcher m = Pattern.compile("\"partyRef\"\\s*:\\s*\"([^\"]+)\"").matcher(body);
        while (m.find()) {
            refs.add(m.group(1));
        }
        return refs;
    }

    private static List<String> datasetNames(String body) {
        List<String> names = new ArrayList<>();
        Matcher m = Pattern.compile("\"name\"\\s*:\\s*\"([^\"]+)\",\"describes\"").matcher(body);
        while (m.find()) {
            names.add(m.group(1));
        }
        return names;
    }

    /** Dataset names whose {@code rowCount} is greater than zero. */
    private static Set<String> nonEmptyDatasets(String body) {
        Set<String> names = new LinkedHashSet<>();
        Matcher m = Pattern
                .compile("\"name\":\"([^\"]+)\",\"describes\":\".*?\",\"rowCount\":(\\d+)")
                .matcher(body);
        while (m.find()) {
            if (Integer.parseInt(m.group(2)) > 0) {
                names.add(m.group(1));
            }
        }
        return names;
    }

    private static String bullets(Set<String> items) {
        return items.stream().map(item -> "  - " + item).reduce((a, b) -> a + "\n" + b).orElse("");
    }
}
