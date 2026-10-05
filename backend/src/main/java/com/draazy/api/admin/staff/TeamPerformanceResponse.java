package com.draazy.api.admin.staff;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record TeamPerformanceResponse(
        int windowDays,
        List<StaffMember> staff,
        List<QueueMetric> queues) {

    public record StaffMember(
            String id,
            String name,
            List<String> functions,
            long handled,
            Map<String, Long> byFunction) {
    }

    public record QueueMetric(
            String function,
            long open,
            Instant oldestWaitingSince,
            Double medianDecisionMinutes) {
    }
}
