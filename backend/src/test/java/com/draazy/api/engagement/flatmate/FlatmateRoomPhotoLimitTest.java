package com.draazy.api.engagement.flatmate;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

@DisplayName("Flatmate rooms — held to the same photo limit as every listing")
class FlatmateRoomPhotoLimitTest extends AbstractApiTest {

    @Autowired UserRepository users;

    private User host() {
        User u = new User("9861530001", Roles.Wire.BUYER);
        u.setName("Room Photo Host");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private static String roomWithPhotos(int count) {
        String photos = IntStream.range(0, count)
                .mapToObj(i -> "\"https://cdn.example/limit-" + i + ".jpg\"")
                .collect(Collectors.joining(","));
        return """
                {"bhk":"2","roomType":"private","attachedBath":"attached","furnishing":"semi",
                 "locality":"LimitTown","society":"Limit Heights","rentShare":15000,"deposit":30000,
                 "availableFrom":"2026-09-01","lookingFor":"any","foodPref":"any",
                 "agreementDeclared":true,"photos":[%s],"note":"Sunny room.",%s}
                """.formatted(photos, FlatmateAgreementFixture.EVIDENCE);
    }

    @Test
    @DisplayName("an eleventh room photo is refused on create and on edit")
    void elevenIsRefused() throws Exception {
        User h = host();
        mvc.perform(post(Routes.Flatmates.ROOMS).header(HttpHeaders.AUTHORIZATION, bearer(h))
                        .contentType(MediaType.APPLICATION_JSON).content(roomWithPhotos(11)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message", containsString("A room can have at most 10 photos")));
        mvc.perform(patch(Routes.Flatmates.ROOM_BY_ID, UUID.randomUUID())
                        .header(HttpHeaders.AUTHORIZATION, bearer(h))
                        .contentType(MediaType.APPLICATION_JSON).content(roomWithPhotos(11)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message", containsString("A room can have at most 10 photos")));
    }
}
