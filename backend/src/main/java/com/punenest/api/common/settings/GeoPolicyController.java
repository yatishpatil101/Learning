package com.punenest.api.common.settings;

import com.punenest.api.common.web.Routes;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * {@code GET /geo} — the map coverage and the places the platform will not suggest.
 *
 * <p><strong>Why a public route exists at all.</strong> The {@code geo} block decides what a
 * logged-out visitor is shown: where a map centres, whether a locality search box is hard-fenced to
 * the city bounds or merely biased toward them, and which places are hidden from every suggestion
 * box in the product.
 * It lives in the settings document, which is admin-only in both directions because the same
 * document carries the fee table and the permission map — so an administrator-only reader cannot be
 * the client's source for it.
 *
 * <p><strong>What it was doing instead.</strong> Every one of the twenty consumer call sites read
 * {@code rawDb().settings.geo} out of its own browser's local storage. The admin console's write
 * was real and reached the database; the read never went near it. So an operator could take a city
 * live, redraw its coverage, or blacklist a society whose listings were being reported — be told
 * each time that it saved, because it did — and have none of it reach a single visitor. There was
 * even a workaround for the staleness, {@code syncGeoFromDisk}, and it began by awaiting a loader
 * that returns null unless {@code import.meta.env.DEV && !navigator.webdriver}: it was switched off
 * in production and under every test run, which is to say in both environments where it mattered.
 *
 * <p><strong>Every field is an override.</strong> The client ships the built-in {@code CITY_GEO} —
 * a centre and a bounding box per city — and merges this response over it. City launch status now
 * comes from {@code GET /cities}. There is deliberately no seeded {@code geo} row, so a fresh
 * install answers {@code {}} and gets the built-in policy, which is the correct reading of an
 * operator who has never opened the Maps panel. That is also what makes this endpoint safe to fail:
 * an unreachable server leaves the client on defaults rather than on nothing.
 *
 * <p><strong>Scope is one block, and narrower than the block.</strong> Not {@code fees}, not
 * {@code permissions}, not {@code adminFlags} — the same line {@code /flags} and {@code /move-pack}
 * hold. And within {@code geo}, each blacklist entry's free-text {@code note} is dropped: it is an
 * operator's reason for hiding a named building, the matcher has never read it, and a route a
 * stranger can call is not where it goes.
 *
 * <p><strong>No service layer</strong>, for the reason {@link AppFlagsController} and
 * {@code MovePackController} give: there is no decision between the row and the wire beyond
 * projecting it, and a class whose whole body is a delegation is not a layer. The projection is
 * longer here than on those two because the block has more shape, not because it has more logic.
 */
@RestController
public class GeoPolicyController {

    private static final Logger log = LoggerFactory.getLogger(GeoPolicyController.class);

    /**
     * The key the admin console writes.
     *
     * <p>Unlike {@code fees}, {@code flags} and {@code movePack} this row is <em>not</em> seeded —
     * see {@code R__seed_reference_data.sql}, where its absence is the point. Defaults for this
     * block live in the client's {@code CITY_GEO}, so seeding a copy here would create a second
     * source of truth that could disagree with the first.
     */
    private static final String GEO_KEY = "geo";

    /**
     * Shortest string the client's matcher will act on.
     *
     * <p>{@code isBlacklisted} requires {@code term.length >= 2} before it will test a substring,
     * because a one-character term matches most of Pune. An entry below it is inert on the client,
     * so publishing it would put a row in the list that can never do anything. Kept in step with
     * {@code lib/geoConfig.js} by this comment and by the test that asserts it.
     */
    private static final int MIN_BLACKLIST_TERM = 2;

    /** Bounds of the coordinate system. A "latitude" outside these is not a mistyped place. */
    private static final double MAX_LATITUDE = 90;
    private static final double MAX_LONGITUDE = 180;

    private final SettingRepository settings;
    private final ObjectMapper objectMapper;

    public GeoPolicyController(SettingRepository settings, ObjectMapper objectMapper) {
        this.settings = settings;
        this.objectMapper = objectMapper;
    }

    /**
     * {@code GET /geo} — the operator's geo overrides, projected onto the contract's shape.
     *
     * <p>A missing, unparseable or non-object row answers the empty policy rather than failing.
     * Every consumer of this endpoint is a page render or a keystroke in a search box, and the
     * alternative to defaulting is a blank site because somebody hand-edited a config row.
     */
    @GetMapping(Routes.Geo.BASE)
    @Transactional(readOnly = true)
    public GeoPolicyResponse geo() {
        JsonNode stored = storedGeo();
        if (stored == null) {
            return new GeoPolicyResponse(null, Map.of(), List.of());
        }
        JsonNode enforce = stored.get("enforceCityLimit");
        return new GeoPolicyResponse(
                enforce != null && enforce.isBoolean() ? enforce.booleanValue() : null,
                cities(stored.get("cities")),
                blacklist(stored.get("blacklist")));
    }

    /** The parsed {@code geo} row, or null for every way reading it can fail. */
    private JsonNode storedGeo() {
        return settings.findById(GEO_KEY).map(row -> {
            JsonNode parsed;
            try {
                parsed = objectMapper.readTree(row.getValue());
            } catch (RuntimeException e) {
                log.warn("settings.{} is not parseable JSON; serving the built-in geo policy",
                        GEO_KEY, e);
                return null;
            }
            if (!parsed.isObject()) {
                log.warn("settings.{} is not a JSON object; serving the built-in geo policy",
                        GEO_KEY);
                return null;
            }
            return parsed;
        }).orElse(null);
    }

    /**
     * Per-city map overrides, keyed by the name the client knows the city by.
     *
     * <p>A city whose entry survives projection with nothing set is omitted rather than published
     * as three nulls. "The operator opened this city's panel once" is not a fact the client can act
     * on, and an empty entry in a map of overrides invites a reader to think an override exists.
     */
    private static Map<String, GeoPolicyResponse.CityGeo> cities(JsonNode node) {
        Map<String, GeoPolicyResponse.CityGeo> out = new LinkedHashMap<>();
        if (node == null || !node.isObject()) {
            return out;
        }
        node.properties().forEach(entry -> {
            JsonNode city = entry.getValue();
            if (city == null || !city.isObject()) {
                return;
            }
            GeoPolicyResponse.CityGeo projected = new GeoPolicyResponse.CityGeo(
                    latLng(city.get("center")),
                    bounds(city.get("bounds")));
            if (projected.center() != null || projected.bounds() != null) {
                out.put(entry.getKey(), projected);
            }
        });
        return out;
    }

    /**
     * A centre point, or null unless both coordinates are real, in-range numbers.
     *
     * <p>Half a point is not a point. Returning a partial one would have the client centre a map on
     * a latitude and a zero, which lands it in the sea off Africa; returning null falls back to the
     * built-in centre for that city, which is a place.
     *
     * <p>Range and finiteness are checked for the same reason, one step further on. A latitude of
     * 200 is not a point either, and {@code 1e999} parses as {@code Infinity}, which Jackson writes
     * as the bare token {@code Infinity} — not JSON, so the browser's {@code JSON.parse} throws and
     * the client falls back to *no* policy at all. A single malformed coordinate must cost the
     * operator that one override, not the whole document.
     */
    private static GeoPolicyResponse.LatLng latLng(JsonNode node) {
        if (node == null || !node.isObject()) {
            return null;
        }
        Double lat = coordinate(node.get("lat"), MAX_LATITUDE);
        Double lng = coordinate(node.get("lng"), MAX_LONGITUDE);
        if (lat == null || lng == null) {
            return null;
        }
        return new GeoPolicyResponse.LatLng(lat, lng);
    }

    /**
     * A coverage box, or null unless all four edges are real, in-range numbers <em>and</em> the box
     * they describe encloses something.
     *
     * <p>Same rule as {@link #latLng}, and it matters more: the client turns these bounds into a
     * hard {@code locationRestriction} on the Places request when the city limit is on. A box
     * missing its south edge is not a smaller box — it is a fence with a gap, and the search it
     * fences would silently start suggesting places from the next district.
     *
     * <p>An inverted box — north below south, or east of west — is the opposite failure and just as
     * quiet: it encloses nothing, so {@code withinBounds} refuses every candidate and the suggestion
     * box for that city goes permanently empty with no error anywhere. Dropping it hands the city
     * back its built-in bounds, which are a working fence. No attempt is made to repair one by
     * swapping the edges: an operator who typed them the wrong way round has said something about a
     * region they did not mean, and guessing which half was the typo is not this route's business.
     */
    private static GeoPolicyResponse.Bounds bounds(JsonNode node) {
        if (node == null || !node.isObject()) {
            return null;
        }
        Double north = coordinate(node.get("north"), MAX_LATITUDE);
        Double south = coordinate(node.get("south"), MAX_LATITUDE);
        Double east = coordinate(node.get("east"), MAX_LONGITUDE);
        Double west = coordinate(node.get("west"), MAX_LONGITUDE);
        if (north == null || south == null || east == null || west == null) {
            return null;
        }
        if (north <= south || east <= west) {
            return null;
        }
        return new GeoPolicyResponse.Bounds(north, south, east, west);
    }

    /**
     * One coordinate: a finite number within {@code limit} of zero, or null.
     *
     * <p>Null rather than a clamped value on purpose. Clamping 200 to 90 invents a place the
     * operator never named and puts it at the North Pole, where it looks deliberate; null falls back
     * to the built-in, which is the city they were editing.
     */
    private static Double coordinate(JsonNode node, double limit) {
        if (node == null || !node.isNumber()) {
            return null;
        }
        double value = node.doubleValue();
        if (!Double.isFinite(value) || Math.abs(value) > limit) {
            return null;
        }
        return value;
    }

    /**
     * The blacklist, in stored order (the panel prepends, so newest first).
     *
     * <p>Two things are dropped. The operator's {@code note} — their free-text reason for hiding a
     * named building — because it is moderator prose and this route is anonymous. And any entry
     * that could not match anything: no {@code placeId} and no term long enough for the client's
     * matcher to test. Both omissions cost the client nothing, because neither field is an input to
     * {@code isBlacklisted}.
     */
    private static List<GeoPolicyResponse.BlacklistEntry> blacklist(JsonNode node) {
        List<GeoPolicyResponse.BlacklistEntry> out = new ArrayList<>();
        if (node == null || !node.isArray()) {
            return out;
        }
        for (JsonNode entry : node) {
            if (entry == null || !entry.isObject()) {
                continue;
            }
            String placeId = text(entry.get("placeId"));
            String term = text(entry.get("term"));
            if (term != null && term.length() < MIN_BLACKLIST_TERM) {
                term = null;
            }
            if (placeId == null && term == null) {
                continue;
            }
            out.add(new GeoPolicyResponse.BlacklistEntry(text(entry.get("id")), placeId, term));
        }
        return out;
    }

    /** A trimmed string field, or null when it is absent, the wrong type, or blank. */
    private static String text(JsonNode node) {
        if (node == null || !node.isString()) {
            return null;
        }
        String value = node.stringValue().trim();
        return value.isEmpty() ? null : value;
    }
}
