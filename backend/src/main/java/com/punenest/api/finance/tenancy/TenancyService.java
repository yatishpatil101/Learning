package com.punenest.api.finance.tenancy;

import com.punenest.api.common.PlatformTime;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
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

/**
 * The tenancy lifecycle — reads for both sides of a live let, and the single creation path.
 *
 * <p><strong>No client creates a tenancy.</strong> {@code POST /tenancies} was removed from the
 * contract (spec fix S9). A tenancy is the record every downstream tenancy surface trusts, so a
 * forged one is a claim to be living in, or letting out, somebody else's home.
 * The only constructor is {@link #openFromClosedDeal}, called inside {@code DealService.close} in
 * the same transaction that closes a rent deal — the one moment where the owner, the tenant, the
 * rent and the deposit are all already known and already authorised (D1).
 *
 * <p><strong>Reads are strictly participant-scoped.</strong> {@code GET /me/tenancies} returns
 * tenancies the caller holds as tenant; {@code GET /tenancies} returns tenancies on the caller's
 * listings. Neither can name a row the caller is not a party to, so there is no id-based read to
 * guard.
 *
 * <p><strong>Both lease dates are stamped in {@link PlatformTime#IST}</strong> (tech debt D179).
 * These are not display values: {@code start_date} and {@code end_date} are written to the row that
 * rent payments hang off, and they are what a tenant and an owner would read off a printed
 * agreement. On a UTC host the JVM is still on yesterday for the first 5.5 hours of every Indian
 * day, so a deal closed at 01:00 IST on the 1st would record a lease that began — or ended — in the
 * previous month, and no later read could tell that the date was wrong.
 */
@Service
public class TenancyService {

    private final TenancyRepository tenancies;
    private final UserRepository users;

    public TenancyService(TenancyRepository tenancies, UserRepository users) {
        this.tenancies = tenancies;
        this.users = users;
    }

    /** Contract {@code myTenancies} — the homes the caller rents. */
    @Transactional(readOnly = true)
    public List<TenancyDto> myTenancies(UUID callerId) {
        return project(tenancies.findByTenantId(callerId));
    }

    /** Contract {@code ownerTenancies} — the caller's listings that are let. */
    @Transactional(readOnly = true)
    public List<TenancyDto> ownerTenancies(UUID callerId) {
        return project(tenancies.findByOwnerId(callerId));
    }

    /**
     * Open a tenancy because a rent deal just closed (D1).
     *
     * <p>Called from {@code DealService.close} and from nowhere else, inside that method's
     * transaction: if the tenancy cannot be written the close must not stand either, or the owner
     * would see a rented flat with no agreement behind it and no way to collect rent.
     *
     * <p><strong>Off-platform tenants get no tenancy, and that is correct.</strong> A close may name
     * a mobile with no account — very common for a Pune owner who found the tenant through a broker.
     * {@code tenancies.tenant_id} is a non-null FK to {@code users}, so there is no row to point at.
     * Rather than inventing a shadow user, the deal simply closes without a tenancy: the owner has
     * recorded that the flat is let, and rent collection through the platform needs the tenant to
     * sign up anyway. Returns empty so the caller can log it.
     *
     * <p><strong>Idempotent.</strong> If the property already has an active tenancy the existing one
     * is returned untouched. {@code V10__DDL_tenancy_finance.sql}'s {@code uq_tenancies_active_per_property} is the real guarantee —
     * two active rows would be a double-let, not a duplicate record — and this check keeps a
     * legitimate re-close from hitting it as an error.
     *
     * @param propertyId  the let listing
     * @param ownerId     the landlord
     * @param tenantId    the resolved tenant user, or {@code null} if off-platform
     * @param monthlyRent the agreed rent, whole INR
     * @return the tenancy, or empty when the tenant is off-platform
     */
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
        // The lease starts the day the deal closed. The end date is left null: the parties agree a
        // term off-platform and nothing here knows it, and guessing eleven months would put a date
        // in front of a tenant that neither party ever agreed to.
        tenancy.setStartDate(LocalDate.now(PlatformTime.IST));
        tenancy.setStatus(TenancyStatuses.ACTIVE);
        return Optional.of(tenancies.save(tenancy));
    }

    /**
     * End the active tenancy on a property, if there is one — the counterpart to
     * {@link #openFromClosedDeal}, called when an owner reopens a closed rent deal (D1).
     *
     * <p>{@code ended}, not deleted: who lived in the flat and when is the record, and the tenancy
     * is the parent of rent payments that must stay attributable. Ending it also frees
     * {@code uq_tenancies_active_per_property} so the flat can be let again.
     */
    @Transactional
    public void endActiveTenancy(UUID propertyId) {
        tenancies.findActiveByPropertyId(propertyId).ifPresent(tenancy -> {
            tenancy.setStatus(TenancyStatuses.ENDED);
            tenancy.setEndDate(LocalDate.now(PlatformTime.IST));
            tenancies.save(tenancy);
        });
    }

    /**
     * Resolve both participants for a page of tenancies in one query rather than two per row —
     * these lists are short but the N+1 would be on a read that already joins nothing.
     */
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
