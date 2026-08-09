package com.punenest.api.catalog.city;

import com.punenest.api.catalog.property.ListingCounts;
import com.punenest.api.common.trust.MobileMask;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The city picker and its waitlist.
 *
 * <p>Both operations are public. Neither has an owner, a role or a principal — the only invariants
 * worth defending here are that the listing counts are true and that a repeated signup does not
 * accumulate rows.
 */
@Service
public class CityService {

    private final CityRepository cities;
    private final CityWaitlistRepository waitlist;
    private final ListingCounts listingCounts;
    private final CityMapper cityMapper;

    public CityService(CityRepository cities, CityWaitlistRepository waitlist,
            ListingCounts listingCounts, CityMapper cityMapper) {
        this.cities = cities;
        this.waitlist = waitlist;
        this.listingCounts = listingCounts;
        this.cityMapper = cityMapper;
    }

    /**
     * Every city, live ones first, each with its true live-listing count.
     *
     * <p>Two queries total regardless of how many cities there are: the list, and one grouped
     * aggregate. Counting inside the loop would be an N+1 on an unauthenticated endpoint.
     */
    @Transactional(readOnly = true)
    public List<CityResponse> list() {
        Map<String, Long> counts = listingCounts.byCity();
        return cities.findAllByOrderByLiveDescNameAsc().stream()
                .map(city -> cityMapper.toResponse(
                        city, counts.getOrDefault(city.getName().toLowerCase(Locale.ROOT), 0L)))
                .toList();
    }

    /**
     * Record a waitlist signup. Idempotent: asking twice is the same as asking once.
     *
     * <p><strong>Why a repeat is not an error.</strong> "You are already on the list" and "you are
     * now on the list" are the same outcome to the person asking, and there is nothing they could do
     * differently. Answering 409 would turn a successful outcome into an error the UI then has to
     * translate back into success.
     *
     * <p>The de-duplication is the database's, not this method's — see
     * {@link CityWaitlistRepository#insertIfAbsent}. A read-then-write check here would not be a
     * constraint: two concurrent submissions would both find nothing and both insert.
     */
    @Transactional
    public void joinWaitlist(CityWaitlistCreateRequest request) {
        // @IndianMobile validated the shape; store the canonical ten digits so the mobile column's
        // CHECK is satisfied and a repeat signup de-duplicates on the same key.
        waitlist.insertIfAbsent(
                MobileMask.normalise(request.mobile()), request.city().trim(), request.email());
    }
}
