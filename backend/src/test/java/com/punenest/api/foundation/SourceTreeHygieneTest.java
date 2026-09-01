package com.punenest.api.foundation;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Fails the build when an empty source file appears anywhere in the repository (tech debt D39, D75).
 *
 * <p><strong>Why this exists.</strong> The same set of 24 zero-byte and near-empty {@code .java}
 * files has now materialised twice — {@code com/punenest/api/auth/} (13 main + 2 test),
 * {@code com/punenest/api/user/} (6 main + 1 test) and two at {@code identity/} root — every one of
 * them a stub sitting one package <em>above</em> the real class ({@code identity/auth},
 * {@code identity/user}, {@code identity/verification}), and every one untracked. Two identical
 * occurrences is a generator, not an accident; the likeliest culprit is the IDE's Java language
 * server replaying a stale index after an interrupted package move.
 *
 * <p><strong>Why it is not cosmetic.</strong> One of them, {@code auth/LoginRequest.java},
 * contained the two characters {@code in} and was a hard syntax error: the module would not
 * compile. The failure gives no hint that the file is spurious, so the second occurrence cost the
 * same diagnosis as the first. Deleting them a third time is not a fix — this is the cheap guard
 * that turns a mystifying compile error into a named one with the file list attached.
 *
 * <p><strong>Why it scans the whole repository, from a backend test.</strong> The guard originally
 * covered {@code .java} under {@code backend/src}, because that is where the two known outbreaks
 * happened. That scope was wrong. A later sweep found sixteen more zero-byte files carrying six
 * different extensions — {@code .sql}, {@code .py}, {@code .mjs}, {@code .jsx}, {@code .js},
 * {@code .md} — spread across {@code backend/}, {@code e2e/}, {@code frontend/} and {@code tasks/},
 * all stamped the same day as the second {@code .java} outbreak. The generator was never
 * Java-specific; the guard was (D75).
 *
 * <p>Three of those sixteen had been committed empty and had survived every review since the initial
 * commit, including an empty {@code listings-mobile-only-controls.spec.js} — a Playwright file that
 * contained no tests, reported nothing, and left the suite green while the scenario in its name went
 * unexercised. That is the case worth failing a build over: an empty {@code .jsx} is dead weight, but
 * an empty spec is a test that passes by having nothing to run.
 *
 * <p>Scanning sideways out of the backend module is a boundary this test crosses knowingly. Nothing
 * else in the repository runs on every change, and a guard that only watches the quarter of the tree
 * where the problem was first noticed is how this became a sixteen-file problem in the first place.
 *
 * <p><strong>Why a test and not a build plugin.</strong> The natural home is an enforcer rule bound
 * to {@code validate}, which would run before compilation rather than after it. Neither
 * {@code maven-enforcer-plugin} nor Ant's core jars are present in the offline repository this
 * project builds against, so adding either would break every build to guard against a rare one.
 * The same {@code ponytail} reasoning that kept ArchUnit out of {@link ArchitectureBoundaryTest}
 * applies: the rule is a file walk and does not need a dependency.
 *
 * <p>The consequence of running as a test is that a ghost carrying a syntax error still fails at
 * compile time first. That case is unavoidable without a plugin, and it is the less common one —
 * the bulk of the ghosts are genuinely zero-byte, which compiles cleanly and so would otherwise
 * never be noticed at all.
 */
@DisplayName("Source tree — no empty source files (tech-debt D39, D75)")
class SourceTreeHygieneTest {

    /**
     * The repository root. Surefire runs with the module directory as the working directory, so one
     * level up is {@code Learning/}. Resolved rather than assumed — see {@link #repoRoot()}.
     */
    private static final Path MODULE = Path.of("").toAbsolutePath();

    /**
     * Extensions where a zero-byte file is always a mistake. Deliberately an allowlist: a blocklist
     * would have to anticipate every marker file that is <em>meant</em> to be empty
     * ({@code .gitkeep}, {@code .npmignore}, {@code py.typed}), and would fail the build the first
     * time someone added a legitimate one.
     */
    private static final Set<String> SOURCE_EXTENSIONS = Set.of(
            ".java", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
            ".sql", ".py", ".css", ".scss", ".html", ".json", ".yaml", ".yml", ".md");

    /**
     * Directories never walked into: build output, dependencies, VCS metadata, and the IDE's own
     * scratch space. {@code target-cli} is this project's CLI-Maven output directory.
     *
     * <p>{@code persist} is the frontend's runtime store ({@code frontend/data/persist/}), which is
     * gitignored and written by the running app rather than by a person. It was added when the
     * encoding guard flagged its two JSON files: the walk covers the working tree, not the index, so
     * without this it reports defects in files nobody wrote and nobody can fix. Both existing checks
     * want the same exclusion — an untracked scratch file is not a source file for either purpose.
     */
    private static final Set<String> PRUNED = Set.of(
            "node_modules", "target", "target-cli", "bin", "dist", "build", "coverage",
            ".git", ".idea", ".vscode", ".gradle", ".venv", "__pycache__",
            "test-results", "playwright-report", ".copilot", ".claude", "persist");

    /**
     * Files that must contain mojibake to do their job, so the encoding guard skips them.
     * {@code fix-mojibake.mjs} is the repair tool that names them.
     *
     * <p>{@code e2e/tests/admin/reports.spec.js} used to be listed here for asserting an exported
     * CSV was free of these sequences. It was retired with the rest of that mock spec; its
     * successor, {@code admin/live-reports.spec.js}, makes the same assertion but builds the needles
     * from code points, so it needs no exemption. That is the better shape — an exempt file is one
     * this guard has stopped protecting.
     */
    private static final Set<String> MOJIBAKE_EXEMPT = Set.of(
            "e2e/scripts/fix-mojibake.mjs");

    @Test
    @DisplayName("no empty or declaration-free source file exists anywhere in the repository")
    void noEmptySourceFiles() {
        Path root = repoRoot();
        List<String> empties = sourceFilesUnder(root).stream()
                .filter(SourceTreeHygieneTest::isEmpty)
                .map(p -> root.relativize(p).toString().replace('\\', '/'))
                .sorted()
                .toList();

        assertThat(empties)
                .as("""
                        Empty source files found. If they are untracked, they are not yours: \
                        something regenerated them (see this class's Javadoc — it has happened \
                        twice for .java alone). Delete them, then check whether the real file \
                        still exists one directory deeper before assuming anything is missing. \
                        If they are tracked, the file is a placeholder that was never filled in — \
                        an empty test spec in particular passes by having nothing to run, so \
                        delete it or write it rather than leaving it to imply coverage.""")
                .isEmpty();
    }

    /**
     * Fails the build on mojibake or a UTF-8 BOM in any source file (tech debt D19).
     *
     * <p><strong>Both are fingerprints of the same bad write.</strong> PowerShell's
     * {@code Set-Content} and {@code >} redirection emit a BOM and, on a round-trip through CP1252,
     * turn every non-ASCII character into two or three replacements — an em dash becomes three
     * characters, the rupee sign becomes three. The repository notes have banned those commands on
     * source files for months; the ban is a convention, and this is the enforcement.
     *
     * <p><strong>Why the register understated it.</strong> D19 recorded "residual mojibake in 7 e2e
     * specs (comments/titles only), cosmetic". The sweep that closed it found <strong>22</strong>
     * files across the whole tree, and the "comments only" part was wrong in the way that matters:
     * {@code frontend/src/data/db.json} had 30 broken sequences in <em>values</em> — every
     * commercial listing's {@code priceStr} rendered a mangled rupee sign, and every {@code desc}
     * a mangled dash. That is a price displayed wrongly to a user, not a comment. The OpenAPI
     * contract had 34 more. A defect described as cosmetic goes to the bottom of a backlog and
     * stays there, which is exactly what happened.
     *
     * <p><strong>Detection is by round-trip, not by a pattern list.</strong> A list of known bad
     * sequences can only catch damage somebody already grepped for — the first cut of the repair
     * script used one and missed the box-drawing rule and the right arrow entirely. Instead, each
     * maximal run of non-ASCII characters is re-encoded to CP1252 bytes and decoded as UTF-8: if
     * that yields shorter, valid text, the run was mojibake. Genuine accented text fails the decode
     * (a lone high byte is not valid UTF-8) and is left alone, so this does not fire on real names.
     *
     * <p>{@code fix-mojibake.mjs} is exempt because it names these sequences in order to repair
     * them, so it must contain them to do its job.
     */
    @Test
    @DisplayName("no mojibake or UTF-8 BOM in any source file (tech-debt D19)")
    void noMojibakeOrBom() {
        Path root = repoRoot();
        List<String> damaged = new ArrayList<>();
        for (Path file : sourceFilesUnder(root)) {
            String rel = root.relativize(file).toString().replace('\\', '/');
            if (MOJIBAKE_EXEMPT.contains(rel)) {
                continue;
            }
            String text;
            try {
                text = Files.readString(file, StandardCharsets.UTF_8);
            } catch (java.io.UncheckedIOException | IOException e) {
                continue;
            }
            if (!text.isEmpty() && text.charAt(0) == '\uFEFF') {
                damaged.add(rel + "  (UTF-8 BOM)");
            } else if (hasMojibake(text)) {
                damaged.add(rel + "  (mojibake)");
            }
        }

        assertThat(damaged)
                .as("""
                        Mojibake or a UTF-8 BOM found. Both mean the file was written by something \
                        that did not preserve UTF-8 — on this machine that is almost always \
                        PowerShell `Set-Content`, `>` redirection or `-replace`, which the repo \
                        notes ban on source files for exactly this reason. Do not hand-edit the \
                        damaged characters: re-run `node e2e/scripts/fix-mojibake.mjs` (DRY=1 \
                        first), which repairs by round-trip and cannot miss a sequence nobody \
                        thought to look for. Then fix the tool that wrote the file.""")
                .isEmpty();
    }

    /**
     * True when re-encoding some non-ASCII run as CP1252 bytes and decoding it as UTF-8 yields
     * strictly shorter, valid text — the signature of a UTF-8 → CP1252 → UTF-8 round trip.
     *
     * <p>Runs stop at every ASCII character. That bound is load-bearing rather than an
     * optimisation: a UTF-8 multi-byte sequence never contains a byte below {@code 0x80}, so no
     * genuine mojibake can straddle an ASCII character, while letting a run absorb ASCII would make
     * one undecodable character anywhere in a file mask every real defect in it.
     */
    private static boolean hasMojibake(String text) {
        int i = 0;
        while (i < text.length()) {
            if (text.charAt(i) < 0x80) {
                i += 1;
                continue;
            }
            int start = i;
            var bytes = new java.io.ByteArrayOutputStream();
            while (i < text.length()) {
                char c = text.charAt(i);
                if (c < 0x80) {
                    break;
                }
                int b = cp1252Byte(c);
                if (b < 0) {
                    break;
                }
                bytes.write(b);
                i += 1;
            }
            int runLength = i - start;
            if (runLength == 0) {
                i += 1; // Not CP1252-representable at all, so it cannot be mojibake.
                continue;
            }
            // `new String(bytes, UTF_8)` substitutes U+FFFD on malformed input rather than
            // throwing, which is exactly the signal wanted: a run that does not decode cleanly is
            // not mojibake and must be left alone.
            String decoded = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
            if (decoded.indexOf('\uFFFD') < 0 && decoded.length() < runLength) {
                return true;
            }
        }
        return false;
    }

    /**
     * The CP1252 byte for a character, or {@code -1} if CP1252 cannot represent it.
     *
     * <p>CP1252 differs from Latin-1 only in {@code 0x80}–{@code 0x9F}, where Latin-1 has control
     * codes and CP1252 has typographic characters. Those 27 are precisely the ones that make
     * mojibake recognisable, so omitting them would miss most real sequences.
     */
    private static int cp1252Byte(char c) {
        if (c < 0x80 || (c >= 0xA0 && c <= 0xFF)) {
            return c;
        }
        int idx = CP1252_HIGH.indexOf(c);
        return idx < 0 ? -1 : 0x80 + idx;
    }

    /** {@code 0x80}–{@code 0x9F} in CP1252 order; {@code '\0'} marks the five undefined slots. */
    private static final String CP1252_HIGH =
            "\u20AC\0\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\0\u017D\0"
            + "\0\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\0\u017E\u0178";

    /**
     * Empty means "declares nothing", not "zero bytes". For {@code .java} that includes a file
     * holding only a package line, imports or comments — a stub rather than a source file. For
     * everything else it means no non-whitespace content, because there is no portable way to tell a
     * comment-only shell script from a deliberate one and guessing would produce false failures.
     *
     * <p><strong>{@code package-info.java} is the one exception, and it is not a loophole.</strong>
     * That file's entire purpose is to carry a package javadoc and a package declaration; it has no
     * type to declare, and one holding anything else would be misusing it. So the
     * "declares nothing" rule reports every correctly-written one as a stub. The rule was authored
     * when the repository contained none, which is why the false positive lay dormant until the
     * package documentation landed (D38). The zero-byte half of the check still applies to it —
     * that is the ghost-file case this guard exists for, and it is the half that was ever meaningful
     * here.
     */
    private static boolean isEmpty(Path file) {
        try {
            if (Files.size(file) == 0) {
                return true;
            }
            String name = file.getFileName().toString();
            if (!name.endsWith(".java")) {
                return Files.readString(file, StandardCharsets.UTF_8).isBlank();
            }
            if (name.equals("package-info.java")) {
                return false;
            }
            String stripped = Files.readString(file, StandardCharsets.UTF_8)
                    .replaceAll("(?s)/\\*.*?\\*/", "")
                    .replaceAll("//[^\\n]*", "")
                    .replaceAll("(?m)^\\s*package\\s+[^;]+;", "")
                    .replaceAll("(?m)^\\s*import\\s+[^;]+;", "")
                    .trim();
            return stripped.isEmpty();
        } catch (java.io.UncheckedIOException | IOException e) {
            // A file that cannot be read as UTF-8 is not a source file this guard has an opinion
            // about; silently passing is correct here, unlike for a genuinely unreadable path.
            return false;
        }
    }

    /**
     * The repository root, identified by the {@code .git} directory rather than by counting
     * {@code ..} hops, so the guard keeps working if the module is ever nested more deeply. Falls
     * back to the module directory, which degrades to the original D39 scope rather than failing.
     */
    private static Path repoRoot() {
        for (Path p = MODULE; p != null; p = p.getParent()) {
            if (Files.isDirectory(p.resolve(".git"))) {
                return p;
            }
        }
        return MODULE;
    }

    private static List<Path> sourceFilesUnder(Path root) {
        List<Path> found = new ArrayList<>();
        try {
            Files.walkFileTree(root, new SimpleFileVisitor<>() {
                @Override
                public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                    return PRUNED.contains(dir.getFileName().toString())
                            ? FileVisitResult.SKIP_SUBTREE
                            : FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                    String name = file.getFileName().toString().toLowerCase(Locale.ROOT);
                    int dot = name.lastIndexOf('.');
                    if (dot > 0 && SOURCE_EXTENSIONS.contains(name.substring(dot))) {
                        found.add(file);
                    }
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFileFailed(Path file, IOException e) {
                    // An unreadable entry (a lock file, a permission quirk) must not fail the build.
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException e) {
            throw new IllegalStateException("cannot walk " + root, e);
        }
        return found;
    }
}
