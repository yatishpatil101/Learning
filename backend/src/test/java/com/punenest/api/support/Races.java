package com.punenest.api.support;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.IntConsumer;

/**
 * Runs several real threads into the same code path at the same moment, and reports what each one
 * got back.
 *
 * <p><strong>Why this exists at all.</strong> {@link AbstractApiTest} is {@code @Transactional} and
 * rolls every test back, which is what keeps ~750 HTTP tests from seeing each other's rows. The cost
 * is that no test on that base class can observe a commit — every write it makes is invisible to
 * every other connection, and stays invisible. A check-then-write race is a commit-time phenomenon
 * by definition: the whole bug is that the second writer's count does not include the first writer's
 * <em>committed</em> row. So the rolling-back harness cannot express the bug, cannot express the
 * fix, and would pass identically against both. D90 is the precedent — a defect that survived the
 * entire suite for exactly this reason.
 *
 * <p>A test that uses this therefore has to be a plain {@code @SpringBootTest} with no
 * {@code @Transactional}, and has to clean up after itself, because its rows are real.
 *
 * <p><strong>What the barrier buys.</strong> Nothing, if the code under test is correct — a correct
 * limit gives the same answer at any interleaving. It buys the <em>failure</em>: without every
 * thread released at once, a broken limiter is likely to be exercised serially and pass. The barrier
 * is what makes the test able to fail.
 */
public final class Races {

    /** Long enough for a genuinely slow run, short enough that a deadlock fails rather than hangs. */
    private static final int TIMEOUT_SECONDS = 60;

    private Races() {
    }

    /**
     * Run {@code task} on {@code threads} threads that all start together.
     *
     * @return one entry per thread, in submission order: {@code null} where the task returned
     *         normally, otherwise what it threw. Callers assert on both the shape of this list and
     *         on the committed rows — the two together are the claim, since a limiter could refuse
     *         the right number of callers and still write the wrong number of rows.
     */
    public static List<Throwable> run(int threads, IntConsumer task) {
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        try {
            CyclicBarrier gate = new CyclicBarrier(threads);
            List<Future<Throwable>> futures = new ArrayList<>();
            for (int i = 0; i < threads; i++) {
                int index = i;
                futures.add(pool.submit(() -> {
                    gate.await(TIMEOUT_SECONDS, TimeUnit.SECONDS);
                    try {
                        task.accept(index);
                        return null;
                    } catch (Throwable thrown) {
                        return thrown;
                    }
                }));
            }
            List<Throwable> outcomes = new ArrayList<>();
            for (Future<Throwable> future : futures) {
                try {
                    outcomes.add(future.get(TIMEOUT_SECONDS, TimeUnit.SECONDS));
                } catch (Exception e) {
                    throw new IllegalStateException(
                            "a racing thread never finished — most likely a lock that is held "
                                    + "longer than the test expects, or a connection pool too small "
                                    + "for " + threads + " concurrent writers",
                            e);
                }
            }
            return outcomes;
        } finally {
            pool.shutdownNow();
        }
    }
}
