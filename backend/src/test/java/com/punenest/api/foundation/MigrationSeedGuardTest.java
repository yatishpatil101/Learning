package com.punenest.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Reference data belongs in a repeatable migration, and only a test can hold that line.
 *
 * <p><strong>The bug this exists to prevent, which already happened once.</strong> {@code V78}
 * created the {@code message_template} table and seeded its ten rows in the same file. That is the
 * obvious thing to do and it is wrong here, for a reason that is invisible from inside the
 * migration:
 *
 * <ul>
 *   <li>{@code e2e/scripts/reset-e2e-db.sql} truncates every table it discovers in {@code public},
 *       deliberately excluding only {@code flyway_schema_history};
 *   <li>{@code e2e/global-setup.live.js} then replays exactly the three {@code R__} seeds;
 *   <li>a {@code V__} migration is not among them — <em>and</em> because the history table survives
 *       the truncation, Flyway still believes it is applied and will not re-run it on the next
 *       backend start either.
 * </ul>
 *
 * <p>So the ten templates were destroyed by the first live run on any machine and never came back.
 * {@code GET /admin/message-templates} answered {@code []} for months. Nothing failed: the console
 * of the day never called that endpoint, so the first person to notice was the one who wrote a test
 * for a feature everybody assumed worked. It could not have been demoed by hand either.
 *
 * <p><strong>Why the rule is enforced as an allowlist rather than a ban.</strong> Not every insert
 * in a versioned migration is a mistake. A one-time backfill — rewriting rows that already exist,
 * as part of a schema change — is exactly what a versioned migration is for, and it is correct for
 * it never to run again. What is wrong is <em>reference data</em>: rows the application expects to
 * find on every environment, forever. The two are indistinguishable by SQL shape and easy to tell
 * apart in a sentence, so each is written down here with its reason. Adding a migration that
 * inserts is not forbidden; it is required to be a decision.
 *
 * <p><strong>Why this is not a Spring test.</strong> It reads files. Standing up a context to do
 * that would make it slower than the thing it guards and would tie it to a database being
 * available, which is the opposite of what a guard against a data-loss trap should depend on.
 */
@DisplayName("Migrations — reference data never ships in a versioned file")
class MigrationSeedGuardTest {

    /** Resolved from the module directory, which is Surefire's working directory. */
    private static final Path MIGRATIONS = Path.of("src/main/resources/db/migration");

    /** Where reference data is allowed to live, and the file the repair below is measured against. */
    private static final Path REFERENCE_SEED = MIGRATIONS.resolve("R__DML_seed_reference_data.sql");

    /**
     * Versioned migrations whose inserts are a one-time backfill.
     *
     * <p>A backfill rewrites rows that already exist, as part of a schema change. It is correct for
     * it never to run again, and correct for the live reset to drop the result — the demo seed
     * builds its own. This is what a versioned migration is <em>for</em>.
     *
     * <p>Keyed by version prefix rather than by full filename so that renaming a migration's
     * description — which Flyway permits, and which changes its checksum rather than its identity —
     * does not silently drop it out of the list and turn this test green for the wrong reason.
     */
    private static final Map<String, String> BACKFILLS = Map.of();

    /**
     * Tables whose rows a versioned migration once seeded, and which the repeatable seed now owns
     * alone.
     *
     * <p>Keyed by table rather than by version because there is no longer a version to point at.
     * The 2026-09-01 consolidation replaced the {@code V1..V128} chain with fourteen pure-DDL files;
     * the migrations that carried these inserts are gone, and with them every trace of the repair
     * except this list. That is precisely why the list has to stay: the repeatable seed is now the
     * <em>only</em> thing standing between these tables and the empty state, and the original bug's
     * defining property is that nothing fails when it happens.
     *
     * <p>{@link #reHomedTablesAreStillSeeded()} checks each one, so deleting the replacement rows
     * fails this suite rather than silently restoring the bug.
     */
    private static final Map<String, String> RE_HOMED_INTO_REFERENCE_SEED = Map.of(
            "message_template",
            "V78 created this table and seeded its ten WhatsApp templates in the same file, so the live "
                    + "reset destroyed them on every machine and GET /admin/message-templates answered [] "
                    + "for months. The rows now live in R__DML_seed_reference_data.sql with "
                    + "ON CONFLICT (id) DO UPDATE.");

    private static final Pattern INSERT = Pattern.compile("insert\\s+into\\s+([\\w.\"]+)", Pattern.CASE_INSENSITIVE);

    /** Matches {@code V05__DDL_leads_conversations.sql} and captures {@code V05}. */
    private static final Pattern VERSION = Pattern.compile("^(V\\d+)__");

    @Test
    @DisplayName("a versioned migration that seeds reference data is a silent data-loss bug")
    void versionedMigrationsDoNotSeedReferenceData() {
        Map<String, List<String>> offenders = new TreeMap<>();

        for (Path migration : versionedMigrations()) {
            if (BACKFILLS.containsKey(version(migration))) {
                continue;
            }
            List<String> tables = insertedTables(read(migration));
            if (!tables.isEmpty()) {
                offenders.put(migration.getFileName().toString(), tables);
            }
        }

        assertThat(offenders)
                .as(
                        """
                        These versioned migrations insert rows. The live reset truncates every table and \
                        replays only the R__ seeds, and flyway_schema_history survives it -- so a V__ \
                        migration's rows are deleted by the first live run and never restored, on any \
                        machine, silently.

                        If these rows are reference data (the application expects them to exist on every \
                        environment): they belong in R__DML_seed_reference_data.sql with ON CONFLICT (id) DO \
                        UPDATE, and the table belongs in RE_HOMED_INTO_REFERENCE_SEED. Do not edit the \
                        versioned migration if it has been applied anywhere -- that changes its checksum \
                        and fails Flyway validation on the next start; write the seed and leave the \
                        migration alone.

                        If they are a one-time backfill: add the version to BACKFILLS with a sentence \
                        saying why losing them to the reset costs nothing.""")
                .isEmpty();
    }

    /**
     * A table listed as re-homed must still be seeded.
     *
     * <p>The comment on {@link #RE_HOMED_INTO_REFERENCE_SEED} claims the rows moved to the
     * repeatable seed. Without this, deleting them from that seed would restore the original bug in
     * full while the list went on asserting the opposite — and the original bug's defining property
     * is that nothing fails when it happens.
     */
    @Test
    @DisplayName("a table listed as re-homed still has its rows in the repeatable seed")
    void reHomedTablesAreStillSeeded() {
        List<String> seeded = insertedTables(read(REFERENCE_SEED));

        for (Map.Entry<String, String> entry : RE_HOMED_INTO_REFERENCE_SEED.entrySet()) {
            assertThat(seeded)
                    .as(
                            "%s is listed as re-homed, but nothing in R__DML_seed_reference_data.sql inserts "
                                    + "into it. The live reset truncates every table and replays only the R__ "
                                    + "seeds, so it is empty on every machine that has run the live suite once.%n%s",
                            entry.getKey(), entry.getValue())
                    .contains(entry.getKey());
        }
    }

    /**
     * The backfill list may not outlive the files it excuses.
     *
     * <p>A stale entry is worse than no entry: it reads as a considered exception while excusing
     * nothing, and the next person to reuse that version prefix inherits a blanket pass they never
     * asked for. This is not hypothetical — it is what caught the consolidation, which deleted both
     * listed migrations and left two entries pardoning files that no longer existed.
     *
     * <p>{@code BACKFILLS} is <strong>empty</strong> as of that consolidation, and this test is
     * therefore vacuous right now — {@code containsAll(emptySet)} passes unconditionally. That is
     * deliberate and it re-arms the moment an entry is added, so it is kept rather than deleted.
     * The assertion below states the empty case explicitly so a green tick is not mistaken for a
     * check that ran: if someone adds a backfill exemption, the second assertion starts doing work.
     */
    @Test
    @DisplayName("every listed version still exists and still inserts")
    void theListsDoNotRot() {
        Set<String> present = versionedMigrations().stream()
                .filter(m -> !insertedTables(read(m)).isEmpty())
                .map(MigrationSeedGuardTest::version)
                .collect(java.util.stream.Collectors.toSet());

        assertThat(present)
                .as("a listed migration was deleted or no longer inserts -- drop it from BACKFILLS")
                .containsAll(BACKFILLS.keySet());

        // The consolidated chain is pure DDL, so no versioned migration should insert at all. This
        // is the stronger statement the empty BACKFILLS map implies; asserting it directly means
        // this test has something to say even while the exemption list is empty.
        assertThat(present)
                .as("the consolidated chain is DDL-only -- a versioned migration that inserts rows "
                        + "either belongs in an R__DML_ seed or needs a BACKFILLS entry explaining itself")
                .isEmpty();
    }

    private static List<Path> versionedMigrations() {
        try (Stream<Path> files = Files.list(MIGRATIONS)) {
            return files.filter(p -> p.getFileName().toString().matches("^V\\d+__.*\\.sql$"))
                    .sorted()
                    .toList();
        } catch (IOException e) {
            throw new UncheckedIOException(
                    "Could not read " + MIGRATIONS.toAbsolutePath() + " -- has the migration folder moved?", e);
        }
    }

    private static String version(Path migration) {
        Matcher m = VERSION.matcher(migration.getFileName().toString());
        return m.find() ? m.group(1) : migration.getFileName().toString();
    }

    private static List<String> insertedTables(String sql) {
        Matcher m = INSERT.matcher(stripComments(sql));
        return m.results().map(r -> r.group(1)).distinct().toList();
    }

    /**
     * Remove {@code --} line comments and {@code /* *}{@code /} blocks before looking for inserts.
     *
     * <p>Otherwise a migration that <em>explains</em> in prose why it does not insert would be
     * reported as inserting — and the first thing anyone does after reading this test's failure
     * message is write exactly that comment.
     */
    private static String stripComments(String sql) {
        return sql.replaceAll("(?s)/\\*.*?\\*/", " ").replaceAll("--[^\\n]*", " ");
    }

    private static String read(Path migration) {
        try {
            return Files.readString(migration);
        } catch (IOException e) {
            throw new UncheckedIOException("Could not read " + migration, e);
        }
    }
}
