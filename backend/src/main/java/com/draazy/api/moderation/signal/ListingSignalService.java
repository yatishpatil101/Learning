package com.draazy.api.moderation.signal;

import com.draazy.api.catalog.property.PhotoHash;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.moderation.report.ReportStatuses;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import java.sql.Timestamp;
import java.text.Normalizer;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ListingSignalService {

    private static final List<String> ACTIVE = List.of(PropertyStatus.APPROVED, PropertyStatus.PENDING);
    private static final List<String> REPORT_STATUSES = List.of(ReportStatuses.OPEN, ReportStatuses.ACTIONED);
    private static final List<String> BROKER_WORDS = List.of(
            "brokerage", "commission", "1 month rent", "one month rent", "multiple options",
            "agent", "realty", "properties", "associates", "consultant", "consultancy");

    private final EntityManager em;

    public ListingSignalService(EntityManager em) {
        this.em = em;
    }

    @Transactional(readOnly = true)
    public Map<UUID, ListingSignals> forProperties(List<Property> properties) {
        if (properties == null || properties.isEmpty()) {
            return Map.of();
        }
        List<UUID> ids = properties.stream().map(Property::getId).toList();
        Set<UUID> ownerIds = new LinkedHashSet<>();
        Map<UUID, UUID> ownersByProperty = new HashMap<>();
        for (Property property : properties) {
            UUID ownerId = property.getOwner() == null ? null : property.getOwner().getId();
            if (ownerId != null) {
                ownerIds.add(ownerId);
                ownersByProperty.put(property.getId(), ownerId);
            }
        }

        Set<UUID> photoMatches = photoMatches(ids);
        Set<UUID> conflicts = conflictListings(ids);
        Set<UUID> copiedDescriptions = copiedDescriptions(ids);
        Set<UUID> manySocietyOwners = manySocietyOwners(ownerIds);
        Set<UUID> manyLocalityOwners = manyLocalityOwners(ownerIds);
        Set<UUID> brokerageReportOwners = brokerageReportOwners(ownerIds);
        Map<UUID, Set<String>> brokerWording = brokerWording(properties);

        Map<UUID, ListingSignals> out = new LinkedHashMap<>();
        for (Property property : properties) {
            UUID id = property.getId();
            UUID ownerId = ownersByProperty.get(id);
            List<ListingSignals.Item> items = new ArrayList<>();
            add(items, conflicts.contains(id), "duplicate_conflict", "hard",
                    "Unresolved cross-owner duplicate cluster.");
            add(items, photoMatches.contains(id), "photo_match_other_account", "hard",
                    "Photo hash matches another owner's active listing.");
            add(items, ownerId != null && brokerageReportOwners.contains(ownerId), "brokerage_reports",
                    "hard", "Owner has at least two open or upheld brokerage reports.");
            add(items, ownerId != null && manySocietyOwners.contains(ownerId), "many_societies",
                    "soft", "Owner has active listings in more than two societies or localities.");
            Set<String> words = brokerWording.getOrDefault(id, Set.of());
            add(items, !words.isEmpty(), "broker_wording", "soft",
                    "Broker wording matched: " + String.join(", ", words) + ".");
            add(items, copiedDescriptions.contains(id), "copied_description", "soft",
                    "Description matches another owner's listing.");
            add(items, ownerId != null && manyLocalityOwners.contains(ownerId), "many_localities_30d",
                    "soft", "Owner listed in at least three localities in the last 30 days.");

            boolean hard = items.stream().anyMatch(item -> "hard".equals(item.severity())
                    && !"duplicate_conflict".equals(item.code()));
            long soft = items.stream().filter(item -> "soft".equals(item.severity())).count();
            out.put(id, new ListingSignals(hard || soft >= 2, hard, conflicts.contains(id),
                    List.copyOf(items)));
        }
        return out;
    }

    @Transactional(readOnly = true)
    public boolean hasHardSignal(UUID propertyId) {
        Property property = em.find(Property.class, propertyId);
        if (property == null) {
            return false;
        }
        ListingSignals listingSignals = forProperties(List.of(property)).getOrDefault(propertyId, ListingSignals.NONE);
        return listingSignals.hardBlock() || listingSignals.conflict();
    }

    private Set<UUID> photoMatches(List<UUID> ids) {
        Query query = em.createNativeQuery("""
                select mh.property_id, mh.hash, oh.hash
                from property_photo_hashes mh
                join properties mp on mp.id = mh.property_id
                join property_photo_hashes oh on (
                     oh.band0 = mh.band0 or oh.band1 = mh.band1
                  or oh.band2 = mh.band2 or oh.band3 = mh.band3)
                join properties op on op.id = oh.property_id
                where mh.property_id in (:ids)
                  and oh.property_id <> mh.property_id
                  and op.owner_id <> mp.owner_id
                  and op.archived = false
                  and op.status in (:statuses)
                """);
        query.setParameter("ids", ids);
        query.setParameter("statuses", ACTIVE);
        return matchedByHash(query);
    }

    private Set<UUID> conflictListings(List<UUID> ids) {
        Set<UUID> out = new HashSet<>();
        Query doorway = em.createNativeQuery("""
                select distinct mp.id
                from properties mp
                join properties op on op.owner_id <> mp.owner_id
                 and op.archived = false
                 and op.status in (:statuses)
                 and (
                      (mp.electricity_meter_key is not null
                       and op.electricity_meter_key = mp.electricity_meter_key)
                   or (mp.address_key is not null and mp.locality_slug is not null
                       and op.address_key = mp.address_key
                       and op.locality_slug = mp.locality_slug)
                 )
                where mp.id in (:ids)
                """);
        doorway.setParameter("ids", ids);
        doorway.setParameter("statuses", ACTIVE);
        for (Object row : doorway.getResultList()) {
            out.add((UUID) row);
        }
        out.addAll(photoMatches(ids));
        return out;
    }

    private Set<UUID> copiedDescriptions(List<UUID> ids) {
        Query query = em.createNativeQuery("""
                with page as (
                  select id, owner_id,
                         trim(regexp_replace(regexp_replace(lower(description), '[^[:alnum:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')) as norm
                  from properties
                  where id in (:ids) and description is not null
                )
                select distinct page.id
                from page
                join properties other on other.owner_id <> page.owner_id
                 and other.archived = false
                 and other.description is not null
                 and trim(regexp_replace(regexp_replace(lower(other.description), '[^[:alnum:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')) = page.norm
                where length(page.norm) >= 60
                """);
        query.setParameter("ids", ids);
        return uuidSet(query);
    }

    private Set<UUID> manySocietyOwners(Set<UUID> ownerIds) {
        if (ownerIds.isEmpty()) {
            return Set.of();
        }
        Query query = em.createNativeQuery("""
                select owner_id
                from properties
                where owner_id in (:ownerIds)
                  and archived = false
                  and status in (:statuses)
                group by owner_id
                having count(distinct coalesce(cast(society_id as text),
                         nullif(locality_slug, ''), lower(locality))) > 2
                """);
        query.setParameter("ownerIds", ownerIds);
        query.setParameter("statuses", ACTIVE);
        return uuidSet(query);
    }

    private Set<UUID> manyLocalityOwners(Set<UUID> ownerIds) {
        if (ownerIds.isEmpty()) {
            return Set.of();
        }
        Query query = em.createNativeQuery("""
                select owner_id
                from properties
                where owner_id in (:ownerIds)
                  and archived = false
                  and created_at >= :since
                group by owner_id
                having count(distinct coalesce(nullif(locality_slug, ''), lower(locality))) >= 3
                """);
        query.setParameter("ownerIds", ownerIds);
        query.setParameter("since", Timestamp.from(Instant.now().minus(30, ChronoUnit.DAYS)));
        return uuidSet(query);
    }

    private Set<UUID> brokerageReportOwners(Set<UUID> ownerIds) {
        if (ownerIds.isEmpty()) {
            return Set.of();
        }
        List<String> ownerTexts = ownerIds.stream().map(UUID::toString).toList();
        Query query = em.createNativeQuery("""
                select owner_id from (
                  select p.owner_id as owner_id, r.id as report_id
                  from reports r
                  join properties p on r.target_type = 'property' and r.target_id = cast(p.id as text)
                  where p.owner_id in (:ownerIds)
                    and r.reason in ('brokerage', 'broker')
                    and r.status in (:statuses)
                  union all
                  select u.id as owner_id, r.id as report_id
                  from reports r
                  join users u on r.target_type = 'user' and r.target_id = cast(u.id as text)
                  where r.target_id in (:ownerTexts)
                    and r.reason = 'brokerage'
                    and r.status in (:statuses)
                ) reports
                group by owner_id
                having count(distinct report_id) >= 2
                """);
        query.setParameter("ownerIds", ownerIds);
        query.setParameter("ownerTexts", ownerTexts);
        query.setParameter("statuses", REPORT_STATUSES);
        return uuidSet(query);
    }

    private Map<UUID, Set<String>> brokerWording(List<Property> properties) {
        Map<UUID, Set<String>> out = new HashMap<>();
        Map<String, Pattern> patterns = new HashMap<>();
        for (String word : BROKER_WORDS) {
            patterns.put(word, Pattern.compile("(?i)(^|\\P{Alnum})" + Pattern.quote(word)
                    + "($|\\P{Alnum})"));
        }
        for (Property property : properties) {
            String text = String.join(" ",
                    safe(property.getTitle()), safe(property.getDescription()),
                    property.getOwner() == null ? "" : safe(property.getOwner().getName()));
            Set<String> hits = new LinkedHashSet<>();
            for (Map.Entry<String, Pattern> entry : patterns.entrySet()) {
                if (entry.getValue().matcher(text).find()) {
                    hits.add(entry.getKey());
                }
            }
            if (!hits.isEmpty()) {
                out.put(property.getId(), hits);
            }
        }
        return out;
    }

    private static Set<UUID> matchedByHash(Query query) {
        Set<UUID> out = new HashSet<>();
        for (Object raw : query.getResultList()) {
            Object[] row = (Object[]) raw;
            long mine = ((Number) row[1]).longValue();
            long other = ((Number) row[2]).longValue();
            if (PhotoHash.sameShot(mine, other)) {
                out.add((UUID) row[0]);
            }
        }
        return out;
    }

    private static Set<UUID> uuidSet(Query query) {
        Set<UUID> out = new HashSet<>();
        for (Object row : query.getResultList()) {
            out.add((UUID) row);
        }
        return out;
    }

    private static void add(List<ListingSignals.Item> items, boolean condition, String code,
            String severity, String detail) {
        if (condition) {
            items.add(new ListingSignals.Item(code, severity, detail));
        }
    }

    private static String safe(String value) {
        if (value == null) {
            return "";
        }
        return Normalizer.normalize(value, Normalizer.Form.NFKC)
                .toLowerCase(Locale.ROOT);
    }
}
