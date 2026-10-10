package com.draazy.api.catalog.society;

import com.draazy.api.common.error.BadRequestException;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SocietyResolveService {

    private static final int MAX_CANDIDATES = 3;

    private static final Pattern PLACE_ID = Pattern.compile("^[A-Za-z0-9_-]{1,255}$");

    private static final int MAX_NAME = 160;

    private final SocietyRepository societies;
    private final SocietyService societyService;

    public SocietyResolveService(SocietyRepository societies, SocietyService societyService) {
        this.societies = societies;
        this.societyService = societyService;
    }

    @Transactional(readOnly = true)
    public SocietyResolveResponse resolve(String placeId, String name, Double lat, Double lng) {
        String id = placeId == null ? "" : placeId.trim();
        if (!PLACE_ID.matcher(id).matches()) {
            throw new BadRequestException("placeId is required: letters, digits, - and _, at most 255 characters");
        }
        if (name != null && name.length() > MAX_NAME) {
            throw new BadRequestException("name is at most " + MAX_NAME + " characters");
        }
        if (lat != null && !(lat >= -90 && lat <= 90) || lng != null && !(lng >= -180 && lng <= 180)) {
            throw new BadRequestException("lat must be within -90..90 and lng within -180..180");
        }
        Optional<Society> hit = societies.findByPlaceId(id)
                .map(held -> SocietyMergePointer.survivor(societies, held))
                .filter(s -> s.getArchivedAt() == null);
        if (hit.isPresent()) {
            return new SocietyResolveResponse(
                    societyService.summarise(List.of(hit.get())).getFirst(), List.of());
        }
        List<Society> nearby = lat == null || lng == null ? List.of() : candidates(name, lat, lng);
        return new SocietyResolveResponse(null, nearby.isEmpty() ? List.of()
                : societyService.summarise(nearby));
    }

    private List<Society> candidates(String name, double lat, double lng) {
        Set<String> mine = SocietyMatching.tokens(name);
        if (mine.isEmpty()) {
            return List.of();
        }
        return societies.withinBox(lat - SocietyMatching.LAT_BOX, lat + SocietyMatching.LAT_BOX,
                        lng - SocietyMatching.LNG_BOX, lng + SocietyMatching.LNG_BOX).stream()
                .map(s -> new Scored(s, SocietyMatching.metresBetween(lat, lng, s.getLat(), s.getLng()), mine))
                .filter(c -> c.metres() <= SocietyMatching.NEARBY_METRES && c.score() >= SocietyMatching.FLOOR)
                .sorted(Comparator.comparingDouble(Scored::score).reversed()
                        .thenComparingDouble(Scored::metres))
                .limit(MAX_CANDIDATES)
                .map(Scored::society)
                .toList();
    }

    private record Scored(Society society, double metres, double score) {

        Scored(Society society, double metres, Set<String> mine) {
            this(society, metres, SocietyMatching.nameScore(mine, SocietyMatching.tokens(society.getName()))
                    + (metres <= SocietyMatching.NEAR_METRES ? SocietyMatching.NEAR_BOOST : 0));
        }
    }
}
