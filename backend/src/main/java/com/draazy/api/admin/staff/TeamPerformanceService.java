package com.draazy.api.admin.staff;

import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class TeamPerformanceService {

    private final TeamPerformanceRepository repository;
    private final AccountPermissions permissions;
    private final Clock clock;

    TeamPerformanceService(TeamPerformanceRepository repository, AccountPermissions permissions,
            Clock clock) {
        this.repository = repository;
        this.permissions = permissions;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    TeamPerformanceResponse performance(int days) {
        Instant to = Instant.now(clock);
        Instant from = to.minus(days, ChronoUnit.DAYS);
        Map<String, StaffStats> staff = staffIndex();
        for (TeamPerformanceRepository.ActivityCount row : repository.activity(from, to)) {
            StaffStats stats = staff.get(row.actor());
            if (stats == null) {
                continue;
            }
            stats.handled += row.count();
            String function = TeamPerformanceAuditFunctions.functionFor(row.action(), row.entity(), row.serviceTeam());
            if (function != null) {
                stats.byFunction.merge(function, row.count(), Long::sum);
            }
        }
        return new TeamPerformanceResponse(days,
                staff.values().stream()
                        .sorted(Comparator.comparingLong(StaffStats::handled).reversed()
                                .thenComparing(s -> s.name))
                        .map(StaffStats::toResponse)
                        .toList(),
                repository.queues(from));
    }

    @Transactional(readOnly = true)
    TeamPerformanceResponse myWork(AuthPrincipal caller, int days) {
        Instant to = Instant.now(clock);
        Instant from = to.minus(days, ChronoUnit.DAYS);
        Set<String> functions = permissions.functionsFor(caller.role(), caller.userId());
        StaffStats stats = new StaffStats(caller.userId(), repository.name(caller.userId()),
                functions.stream().sorted().toList());
        for (TeamPerformanceRepository.ActivityCount row :
                repository.activityForActor(caller.userId(), from, to)) {
            stats.handled += row.count();
            String function = TeamPerformanceAuditFunctions.functionFor(row.action(), row.entity(), row.serviceTeam());
            if (function != null) {
                stats.byFunction.merge(function, row.count(), Long::sum);
            }
        }
        return new TeamPerformanceResponse(days, List.of(stats.toResponse()),
                repository.queues(from).stream()
                        .filter(queue -> functions.contains(queue.function()))
                        .toList());
    }

    private Map<String, StaffStats> staffIndex() {
        Map<String, StaffStats> out = new LinkedHashMap<>();
        for (TeamPerformanceRepository.StaffAccount account : repository.staff()) {
            List<String> functions = permissions.functionsFor(Roles.Wire.STAFF, account.id())
                    .stream().sorted().toList();
            out.put(account.id().toString(), new StaffStats(account.id(), account.name(), functions));
        }
        return out;
    }

    private static final class StaffStats {
        private final UUID id;
        private final String name;
        private final List<String> functions;
        private final Map<String, Long> byFunction = new LinkedHashMap<>();
        private long handled;

        private StaffStats(UUID id, String name, List<String> functions) {
            this.id = id;
            this.name = name;
            this.functions = functions;
        }

        private long handled() {
            return handled;
        }

        private TeamPerformanceResponse.StaffMember toResponse() {
            return new TeamPerformanceResponse.StaffMember(
                    id.toString(), name, functions, handled, Map.copyOf(byFunction));
        }
    }
}
