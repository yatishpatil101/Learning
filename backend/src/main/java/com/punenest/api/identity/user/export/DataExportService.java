package com.punenest.api.identity.user.export;

import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * <strong>Assembles the subject's data-access document.</strong>
 *
 * <p>Deliberately thin. Everything that required a judgement call — which tables are in scope, which
 * columns are withheld and why, what happens to the second person on a shared record — lives in
 * {@link DataExportScope} and {@link DataExportRedaction}, where it can be read as an argument rather
 * than inferred from control flow. What is left here is the mechanical part: run each query, cap it,
 * normalise the values, and say honestly what was cut.
 *
 * <h2>Native SQL rather than the repositories</h2>
 *
 * <p>The same choice {@code ErasureService} made, for the same reason. Going through JPA would mean
 * seventy repository methods, entity graphs that lazily pull in exactly the associated {@code users}
 * rows this endpoint exists to keep out, and a scope that no reviewer could audit without reading
 * seventy entity classes. A named-column {@code SELECT} is the form in which a reviewer can see
 * exactly what leaves the building — and, just as importantly, the form a structural test can read
 * back and assert against, which is how {@code DataExportCoverageTest} proves the redaction rule
 * rather than restating it.
 *
 * <h2>The row cap</h2>
 *
 * <p>Every dataset is capped. Without it, {@code page_views} alone would make the response size a
 * function of how much the subject has used the product, and the endpoint's cost unbounded — an
 * account with a year of browsing would produce tens of megabytes assembled in memory, and a
 * handful of concurrent requests would be a denial of service the platform funded itself.
 *
 * <p>The cap is enforced by fetching {@code limit + 1} rows and discarding the extra. That is the
 * whole reason for the {@code +1}: it is the difference between a dataset that happens to have
 * exactly {@code limit} rows and one that was cut short, and without knowing which, the {@code
 * truncated} flag would have to be a guess. A truncated dataset that did not say so would be the
 * silent omission this entire feature is built to avoid — worse than no export, because it would
 * assert a completeness it does not have.
 *
 * <p>The default of 200 is set so that essentially every real account is under it in every dataset
 * except {@code page_views}, while the worst case for the whole document is a known constant: 200
 * rows times the number of datasets, not a function of anything a caller controls. A subject
 * genuinely truncated in a dataset they care about can be served a targeted extract by hand — which
 * is the correct escalation path for a right that is exercised a handful of times a year, and much
 * better than an unbounded endpoint that is available to everyone all the time.
 *
 * <h2>One transaction</h2>
 *
 * <p>{@code readOnly = true}, one transaction across all datasets, so the document is a consistent
 * snapshot rather than seventy reads that could disagree with each other about whether a deal closed
 * halfway through. It also lets PostgreSQL route the whole thing through a single MVCC snapshot,
 * which is the cheap way to run this many statements.
 */
@Service
public class DataExportService {

    private final NamedParameterJdbcTemplate jdbc;
    private final UserRepository users;
    private final int rowLimit;

    DataExportService(NamedParameterJdbcTemplate jdbc, UserRepository users,
            @Value("${punenest.export.row-limit:200}") int rowLimit) {
        this.jdbc = jdbc;
        this.users = users;
        this.rowLimit = rowLimit;
    }

    /**
     * Builds the whole document for one subject.
     *
     * <p>Takes the id from the authenticated principal and nothing else. There is no parameter here
     * by which a caller could name somebody other than themselves, which is the property that makes
     * this endpoint safe to expose without an authorisation check beyond "you are signed in" — see
     * {@link DataExportController}.
     */
    @Transactional(readOnly = true)
    public DataExportResponse exportFor(UUID subjectId) {
        User subject = users.findById(subjectId)
                .orElseThrow(() -> NotFoundException.of("User"));

        // subjectIdText exists because reviews.target_id and reports.target_id are text columns
        // holding a stringified id; comparing a uuid parameter against them would fail at the
        // driver. Naming the coercion in the parameter map keeps the casts out of the SQL, where
        // they would be one more thing for a reader of the scope to decode.
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("subjectId", subjectId)
                .addValue("subjectIdText", subjectId.toString())
                .addValue("subjectMobile", subject.getMobile());

        List<DataExportResponse.Dataset> datasets = new ArrayList<>();
        for (DataExportScope.Dataset dataset : DataExportScope.all()) {
            datasets.add(read(dataset, params, subjectId));
        }

        return new DataExportResponse(
                Instant.now(),
                subjectId,
                DataExportResponse.SCHEMA_VERSION,
                DataExportScope.redactionRule(),
                rowLimit,
                List.copyOf(datasets),
                DataExportScope.exclusions().stream()
                        .map(e -> new DataExportResponse.Exclusion(e.name(), e.reason()))
                        .toList());
    }

    private DataExportResponse.Dataset read(DataExportScope.Dataset dataset,
            MapSqlParameterSource params, UUID subjectId) {

        // Wrapping rather than appending: the scope's queries carry their own ORDER BY, and
        // appending a LIMIT to a string that may end in a comment or a trailing newline is the kind
        // of concatenation that works until the day somebody formats a query differently.
        String sql = "select * from (\n" + dataset.sql() + "\n) as d limit " + (rowLimit + 1);

        List<Map<String, Object>> raw = jdbc.queryForList(sql, params);
        boolean truncated = raw.size() > rowLimit;
        if (truncated) {
            raw = raw.subList(0, rowLimit);
        }

        List<Map<String, Object>> rows = raw.stream()
                .map(row -> DataExportRedaction.row(row, subjectId))
                .toList();

        return new DataExportResponse.Dataset(
                dataset.domain(),
                dataset.name(),
                dataset.describes(),
                rows.size(),
                truncated,
                dataset.withheld(),
                rows);
    }
}
