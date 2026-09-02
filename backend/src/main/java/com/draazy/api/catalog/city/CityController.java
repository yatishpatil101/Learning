package com.draazy.api.catalog.city;

import com.draazy.api.common.web.Routes;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /cities} — the city picker, and the waitlist for the cities not on it.
 *
 * <p>Both operations are public. The read has to be, because it is what the app shows before anyone
 * signs in; the write has to be, because the whole point is to hear from people who are not users yet
 * and may never be if their city never launches.
 */
@RestController
public class CityController {

    private final CityService cityService;

    public CityController(CityService cityService) {
        this.cityService = cityService;
    }

    /** {@code GET /cities} — every city, live ones first, with true live-listing counts. */
    @GetMapping(Routes.Cities.BASE)
    public List<CityResponse> list() {
        return cityService.list();
    }

    /**
     * {@code POST /cities/waitlist} — "tell me when you launch in my city".
     *
     * <p>Answers 201 whether or not a row was written. A repeat submission is not a conflict: the
     * caller's intent is "make sure I'm on this list", and after either outcome they are. Reporting
     * 409 would leak that a given mobile has already asked — on an endpoint anyone on the internet
     * can call, that turns a signup form into a membership oracle.
     */
    @PostMapping(Routes.Cities.WAITLIST)
    @ResponseStatus(HttpStatus.CREATED)
    public void joinWaitlist(@Valid @RequestBody CityWaitlistCreateRequest request) {
        cityService.joinWaitlist(request);
    }
}
