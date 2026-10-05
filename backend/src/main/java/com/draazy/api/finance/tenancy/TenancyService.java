package com.draazy.api.finance.tenancy;

import com.draazy.api.common.PlatformTime;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TenancyService {

    private final TenancyRepository tenancies;
    private final UserRepository users;

    public TenancyService(TenancyRepository tenancies, UserRepository users) {
        this.tenancies = tenancies;
        this.users = users;
    }

    @Transactional(readOnly = true)
    public List<TenancyDto> myTenancies(UUID callerId) {
        return project(tenancies.findByTenantId(callerId));
    }

    // End tenancies instead of deleting; rent payments must remain attributable.
    @Transactional
    public Optional<Tenancy> openFromClosedDeal(UUID propertyId, UUID ownerId, UUID tenantId,
                                                Long monthlyRent) {
        if (tenantId == null) {
            return Optional.empty();
        }
        Optional<Tenancy> existing = tenancies.findActiveByPropertyId(propertyId);
        if (existing.isPresent()) {
            return existing;
        }
        Tenancy tenancy = new Tenancy(propertyId, tenantId, ownerId);
        tenancy.setRent(monthlyRent);

        tenancy.setStartDate(LocalDate.now(PlatformTime.IST));
        tenancy.setStatus(TenancyStatuses.ACTIVE);
        return Optional.of(tenancies.save(tenancy));
    }

    @Transactional
    public void endActiveTenancy(UUID propertyId) {
        tenancies.findActiveByPropertyId(propertyId).ifPresent(tenancy -> {
            tenancy.setStatus(TenancyStatuses.ENDED);
            tenancy.setEndDate(LocalDate.now(PlatformTime.IST));
            tenancies.save(tenancy);
        });
    }

    // Resolve participants in one query so this otherwise-simple read avoids N+1.
    private List<TenancyDto> project(List<Tenancy> rows) {
        if (rows.isEmpty()) {
            return List.of();
        }
        Set<UUID> userIds = new HashSet<>();
        for (Tenancy tenancy : rows) {
            userIds.add(tenancy.getTenantId());
            userIds.add(tenancy.getOwnerId());
        }
        Map<UUID, User> byId = users.findAllById(userIds).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));

        List<TenancyDto> out = new ArrayList<>(rows.size());
        for (Tenancy tenancy : rows) {
            out.add(TenancyMapper.toDto(
                    tenancy, byId.get(tenancy.getTenantId()), byId.get(tenancy.getOwnerId())));
        }
        return out;
    }
}
