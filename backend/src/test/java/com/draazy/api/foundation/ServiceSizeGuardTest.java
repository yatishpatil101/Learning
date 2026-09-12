package com.draazy.api.foundation;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/** Enforces the service-split trigger of {@code docs/system/package-structure.md} §4.1, which fixes
 * the judgement call at {@value #MAX_LINES} physical lines and the remedy at split-by-use-case. */
@DisplayName("Architecture — service size (package-structure.md §4.1)")
class ServiceSizeGuardTest {

    private static final Path MAIN = Path.of("src", "main", "java");

    /** The split trigger from package-structure.md §4.1. */
    private static final int MAX_LINES = 450;

    /** Services already over the line when §4.1 was agreed, pinned at their size on that day; a pin
     * may only shrink, and must be deleted once the service reaches {@link #MAX_LINES} or below. */
    private static final Map<String, Integer> BASELINE = new LinkedHashMap<>();

    static {
        BASELINE.put("com/draazy/api/services/request/ServiceRequestService.java", 1124);
        // The next raise on this one should be the rooms/groups split — see package-structure.md §4.1.
        BASELINE.put("com/draazy/api/engagement/flatmate/FlatmateSupplyService.java", 876);
        BASELINE.put("com/draazy/api/billing/plan/SubscriptionService.java", 586);
        BASELINE.put("com/draazy/api/billing/boost/BoostService.java", 500);
    }

    /** Names that are a service plus a filler word — the file split §4.1 forbids. Deliberately
     * narrow: a bare {@code …ServiceImpl} is not matched, {@code …ServiceImpl2} is. */
    private static final Pattern FILLER_SUFFIX =
            Pattern.compile("Service(Helpers?|Supports?|Utils?|Extras?|Parts?\\d*|Impl\\d+|\\d+)\\.java$");

    private static final String RULE = """
            package-structure.md §4.1: a service past %d lines splits BY USE-CASE, NEVER BY LAYER. \
            FlatmateSupplyService becomes FlatmateRoomService + FlatmateGroupService — two things \
            the business does — and never FlatmateSupplyServiceHelper, because a helper class named \
            after its parent is a file split, not a design: both files still have to be read \
            together and the parent keeps every responsibility it had.""".formatted(MAX_LINES);

    @Test
    @DisplayName("no service exceeds the 450-line split trigger")
    void servicesStayUnderTheSplitTrigger() {
        List<String> violations = new ArrayList<>();
        for (Path service : serviceFiles()) {
            String key = key(service);
            if (BASELINE.containsKey(key)) {
                continue;
            }
            int lines = lines(service);
            if (lines > MAX_LINES) {
                violations.add("%s is %d lines (limit %d, over by %d)"
                        .formatted(key, lines, MAX_LINES, lines - MAX_LINES));
            }
        }
        assertThat(violations)
                .as("""
                        A service crossed the split trigger. %s

                        Name the use-cases this service is serving. Move the smallest one that owns \
                        its own data and its own transaction into its own service, with its tests, \
                        and let the caller talk to two services. If it is genuinely one linear \
                        workflow with a single reason to change, say so in the pull request and add \
                        it to BASELINE here with its measured size — that is a visible, reviewable \
                        act, which is the point.""".formatted(RULE))
                .isEmpty();
    }

    @Test
    @DisplayName("services grandfathered over the trigger may shrink, never grow")
    void grandfatheredServicesOnlyShrink() {
        List<String> violations = new ArrayList<>();
        BASELINE.forEach((key, pinned) -> {
            Path service = MAIN.resolve(key);
            if (!Files.isRegularFile(service)) {
                return; // reported by baselineStaysHonest
            }
            int lines = lines(service);
            if (lines > pinned) {
                violations.add("%s grew from %d to %d lines (+%d)".formatted(key, pinned, lines, lines - pinned));
            }
        });
        assertThat(violations)
                .as("""
                        A service that was already over the split trigger got bigger. These five were \
                        left un-split on purpose, but "not splitting it today" was never permission \
                        to keep piling on. %s

                        Put the new behaviour in a new use-case service instead. If the growth is \
                        genuinely unavoidable, raise the pin in BASELINE by hand and justify it in \
                        the pull request.""".formatted(RULE))
                .isEmpty();
    }

    @Test
    @DisplayName("the baseline table describes reality — no stale or graduated entries")
    void baselineStaysHonest() {
        List<String> problems = new ArrayList<>();
        BASELINE.forEach((key, pinned) -> {
            Path service = MAIN.resolve(key);
            if (!Files.isRegularFile(service)) {
                problems.add("%s is pinned at %d lines but no longer exists — delete the entry (or fix the path if it moved)"
                        .formatted(key, pinned));
                return;
            }
            int lines = lines(service);
            if (lines <= MAX_LINES) {
                problems.add("%s is now %d lines, at or under the %d limit — delete its BASELINE entry so the normal rule applies"
                        .formatted(key, lines, MAX_LINES));
            }
        });
        assertThat(problems)
                .as("""
                        The grandfathered list has drifted from the tree. An exception nobody prunes \
                        stops being an exception and becomes a permanent hole: a service that got \
                        back under the limit would otherwise be free to regrow to its old pin \
                        unnoticed.""")
                .isEmpty();
    }

    @Test
    @DisplayName("no class exists that is a service plus a filler suffix")
    void noFillerSuffixClasses() {
        List<String> violations = new ArrayList<>();
        try (Stream<Path> paths = Files.walk(MAIN)) {
            paths.filter(p -> FILLER_SUFFIX.matcher(p.getFileName().toString()).find())
                    .forEach(p -> violations.add(key(p)));
        } catch (IOException e) {
            throw new IllegalStateException("cannot walk " + MAIN.toAbsolutePath(), e);
        }
        assertThat(violations)
                .as("""
                        A class appeared whose name is an existing service plus a filler word. That \
                        is the evasion the split trigger invites: the line count drops, the design \
                        does not change, and the reader now has two files to hold in their head \
                        instead of one. %s""".formatted(RULE))
                .isEmpty();
    }

    private static List<Path> serviceFiles() {
        try (Stream<Path> paths = Files.walk(MAIN)) {
            return paths
                    .filter(p -> p.getFileName().toString().endsWith("Service.java"))
                    .sorted()
                    .toList();
        } catch (IOException e) {
            throw new IllegalStateException("cannot walk " + MAIN.toAbsolutePath(), e);
        }
    }

    /** Path relative to the source root, slash-separated, so the table reads the same on any OS. */
    private static String key(Path service) {
        return MAIN.relativize(service).toString().replace('\\', '/');
    }

    private static int lines(Path service) {
        try {
            return Files.readAllLines(service, StandardCharsets.UTF_8).size();
        } catch (IOException e) {
            throw new IllegalStateException("cannot read " + service, e);
        }
    }
}
