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
     */
    private static final Set<String> PRUNED = Set.of(
            "node_modules", "target", "target-cli", "bin", "dist", "build", "coverage",
            ".git", ".idea", ".vscode", ".gradle", ".venv", "__pycache__",
            "test-results", "playwright-report", ".copilot", ".claude");

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
     * Empty means "declares nothing", not "zero bytes". For {@code .java} that includes a file
     * holding only a package line, imports or comments — a stub rather than a source file. For
     * everything else it means no non-whitespace content, because there is no portable way to tell a
     * comment-only shell script from a deliberate one and guessing would produce false failures.
     */
    private static boolean isEmpty(Path file) {
        try {
            if (Files.size(file) == 0) {
                return true;
            }
            if (!file.getFileName().toString().endsWith(".java")) {
                return Files.readString(file, StandardCharsets.UTF_8).isBlank();
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
