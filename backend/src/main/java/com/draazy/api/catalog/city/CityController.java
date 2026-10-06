package com.draazy.api.catalog.city;

import com.draazy.api.common.web.Routes;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Public, because it hears from people who are not users yet. */
@RestController
public class CityController {

    private final CityService cityService;

    public CityController(CityService cityService) {
        this.cityService = cityService;
    }

    /** Always 201: a 409 on repeat would let anyone probe whether a mobile has already signed up. */
    @PostMapping(Routes.Cities.WAITLIST)
    @ResponseStatus(HttpStatus.CREATED)
    public void joinWaitlist(@Valid @RequestBody CityWaitlistCreateRequest request) {
        cityService.joinWaitlist(request);
    }
}
