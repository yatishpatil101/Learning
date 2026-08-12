package com.punenest.api.foundation;

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

/**
 * Enforces the service-split trigger of {@code docs/system/package-structure.md} §4.1.
 *
 * <p><strong>Why this exists.</strong> §4 asks for services that are "small &amp;
 * single-responsibility", which is a judgement call, and a judgement call with no number attached is
 * settled by whoever is holding the keyboard. §4.1 fixes the number at {@value #MAX_LINES} lines and
 * fixes the shape of the remedy: a service past the line splits <strong>by use-case, never by
 * layer</strong>. This test is the half that survives the people who agreed it.
 *
 * <p><strong>How lines are counted: every physical line, including licence, package, imports and
 * Javadoc.</strong> The alternative — counting only "real" statements — sounds fairer and is worse,
 * because it makes the number arguable. A threshold you can check with {@code wc -l} or the line
 * number in the editor gutter is a threshold nobody litigates; one that needs this test to explain
 * itself invites a debate about the measurement instead of about the design. The excluded material
 * is not free either: a service with a hundred lines of imports has a coupling problem, and a
 * service whose Javadoc runs for pages is still a service that cannot be read in one sitting. Cost
 * of reading is the thing being capped, and comments are read.
 *
 * <p><strong>Why there is a baseline.</strong> Six services were already past the line when the rule
 * landed, {@code ServiceRequestService} at 1124 lines being the worst. Splitting six live services to
 * make a new guard go green would be a large untested refactor performed to satisfy a lint — the
 * exact move §4.1 exists to discourage. They are pinned here at their measured size instead: they may
 * shrink, never grow, and a pin may only be raised by editing this table by hand, which is
 * deliberate and shows up in review. This mirrors the {@code LAYER} table in {@link
 * ArchitectureBoundaryTest}, where adding a context is likewise a visible edit rather than an
 * allowlist that quietly absorbs anything.
 */
@DisplayName("Architecture — service size (package-structure.md §4.1)")
class ServiceSizeGuardTest {

    private static final Path MAIN = Path.of("src", "main", "java");

    /** The split trigger from package-structure.md §4.1. */
    private static final int MAX_LINES = 450;

    /**
     * Services that were already over the line when §4.1 was agreed, pinned at their exact size on
     * that day. A pinned service may only shrink. When one finally drops to {@link #MAX_LINES} or
     * below it must be deleted from this table — {@link #baselineStaysHonest()} enforces that, so a
     * service cannot graduate and then quietly regrow under an obsolete pin.
     */
    private static final Map<String, Integer> BASELINE = new LinkedHashMap<>();

    static {
        // Raised 1087 -> 1124 for D120/D121. Four collaborators absorbed the actual work — the
        // checklist catalogue (ServiceRequestChecklist), the co-fill parties (CoFillParties), the
        // read receipts (ServiceRequestReadReceipts) and the ticket link (TicketMirror) are all
        // their own classes. What is left here is the +37 those four cannot own: each needs the
        // participant guard, and that guard is this service's, so the delegating entry points and
        // the promotion of `visible` to package-private live where the guard lives. Extracting
        // those stubs would have produced a class holding nothing but four one-line calls.
        BASELINE.put("com/punenest/api/services/request/ServiceRequestService.java", 1124);
        BASELINE.put("com/punenest/api/engagement/flatmate/FlatmateSupplyService.java", 737);
        BASELINE.put("com/punenest/api/finance/rent/RentService.java", 700);
        BASELINE.put("com/punenest/api/billing/plan/SubscriptionService.java", 586);
        BASELINE.put("com/punenest/api/billing/boost/BoostService.java", 500);
        // Raised 492 -> 531 for D70 (a poster's read of the interests on their own ad). The +39 is
        // one paged read and its ownership check, not new state or a new flow, and it lands next to
        // the host-wide inbox it narrows. Splitting a single query out would have produced a class
        // that existed only to keep a number down. The service stays pinned and may not grow again.
        BASELINE.put("com/punenest/api/engagement/flatmate/FlatmateSeekerService.java", 531);
    }

    /**
     * Names that are a service plus a filler word — the file split §4.1 forbids. Deliberately narrow.
     * A bare {@code …ServiceImpl} is <em>not</em> matched: an interface with a single implementation
     * is a legitimate (if unfashionable) pattern, and this repo has no such pair today, so flagging
     * it would be inventing a rule nobody agreed. {@code …ServiceImpl2} is matched, because a
     * numbered implementation is overflow wearing a costume.
     */
    private static final Pattern FILLER_SUFFIX =
            Pattern.compile("Service(Helpers?|Supports?|Utils?|Extras?|Parts?\\d*|Impl\\d+|\\d+)\\.java$");

    private static final String RULE = """
            package-structure.md §4.1: a service past %d lines splits BY USE-CASE, NEVER BY LAYER. \
            RentService becomes RentBillingService + RentPaymentService — two things the business \
            does — and never RentServiceHelper, because a helper class named after its parent is a \
            file split, not a design: both files still have to be read together and the parent keeps \
            every responsibility it had.""".formatted(MAX_LINES);

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
                        A service that was already over the split trigger got bigger. These six were \
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
