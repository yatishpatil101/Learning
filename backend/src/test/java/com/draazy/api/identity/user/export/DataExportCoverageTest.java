package com.draazy.api.identity.user.export;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.identity.user.erasure.ErasureRetention;
import com.draazy.api.support.AbstractApiTest;
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

// Returns the subject's data and nobody else's. Absence assertions search the raw response body
// so a leak arriving through an unexpected column or nested document cannot slip past.
@DisplayName("Data export (/me/data-export)")
class DataExportCoverageTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    // Values chosen so a substring match cannot occur by chance — a match is a leak, not a coincidence.
    private static final String OTHER_MOBILE = "9700000042";
    private static final String OTHER_NAME = "Zebulon Quartzfeather";
    private static final String OTHER_EMAIL = "zebulon.quartzfeather@example.invalid";
    private static final String OTHER_PAN = "QRTZF9999Z";
    private static final String OTHER_AADHAAR = "XXXX XXXX 9999";

    private static final String SUBJECT_MOBILE = "9800000041";
    private static final String SUBJECT_NAME = "Priyamvada Ranganathan";

    // Structural

    // Every counterparty leak of contact details or verification state would arrive through their
    // users row or a denormalised copy of it; users may be named exactly once — by the subject's own row.
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

        // Converse: the one permitted use must be keyed on the subject, or the rule above is
        // satisfied by a dataset called `users` returning everybody.
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

    // Data the erasure sweep cannot reach is still data the subject is entitled to see. Derived
    // rather than transcribed so the gap list and this test cannot silently drift apart.
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

    // Queries are strings, so a schema drift is a runtime failure on the one endpoint whose whole
    // purpose is completeness. Running against a subject with no data still executes every query.
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

    // Behavioural — presence

    // Asserted across several domains because a misplaced predicate (owner_id where requester_id
    // was meant) returns an empty dataset that looks like an honest "you have none of these".
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

    // Behavioural — absence (the half that matters)

    // Raw id is asserted absent alongside contact details: a uuid column reads as plumbing but is a
    // stable global handle on a person — two exports carrying it could be joined.
    @Test
    @DisplayName("the counterparty's mobile, email, name, KYC and raw id are absent")
    void theCounterpartyNeverAppears() throws Exception {
        User subject = user(SUBJECT_MOBILE, SUBJECT_NAME);
        User other = counterparty();
        seed(subject, other);

        String body = export(subject);

        // Sanity: without this, every absence assertion below would pass trivially on an empty
        // document — the classic way a leak test proves nothing.
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
                .withFailMessage("The counterparty's masked Aadhaar / ID last-4 appears in the subject's export.")
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

    // One stable reference per person per document lets the subject tell their own messages from
    // the counterparty's and lets shared records be tied together, without leaking anything outside it.
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

    // Fixture

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

        // Identity papers and verification state: the subject has no business seeing these however
        // many flats they rented from this person.
        jdbc.update("""
                insert into owner_kyc (user_id, pan_masked, aadhaar_masked, status)
                values (?, ?, ?, 'verified')
                """, saved.getId(), OTHER_PAN, OTHER_AADHAAR);
        jdbc.update("""
                insert into identity_verifications
                       (user_id, status, doc_type, doc_last4, holder_name, holder_dob, identity_hash,
                        consent_at, submitted_at, attempt_count, attempt_window_start, decided_at)
                values (?, 'verified', 'aadhaar', ?, 'Other Holder', date '1980-01-01', ?,
                        now(), now(), 1, now(), now())
                """, saved.getId(), OTHER_AADHAAR, "hmac-of-an-aadhaar");
        return saved;
    }

    // Both directions are seeded: the "received" side of every paired dataset selects the
    // counterparty's id, so it is the side where a leak lives.
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

        // Order the pair in Postgres, not Java: `uuid <` is unsigned and UUID.compareTo is signed,
        // so they disagree on half of all ids — and sorting here exercises both sides of the CASE.
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

        // Reviews use `owner` for "review is about a person"; reports spells the same idea `user`.
        // Both are seeded because the two datasets redact on different literals to do the same job.
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

    // Helpers

    // Tables a query reads, from its `from` and `join` clauses. Crude on purpose — a real SQL
    // parser would be a dependency and its own source of bugs, and the queries are in one house style.
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
