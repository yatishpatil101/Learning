package com.draazy.api.support;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.auth.Totp;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;

/** Drives the whole back-office sign-in (password, then enrol or code) the way a browser would. */
public final class StaffSignIn {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    private StaffSignIn() {
    }

    public static JsonNode password(MockMvc mvc, String email, String password) throws Exception {
        return postOk(mvc, Routes.Auth.STAFF_LOGIN,
                "{\"email\":\"%s\",\"password\":\"%s\"}".formatted(email, password));
    }

    /** Enrols a fresh authenticator; returns its decoded secret. */
    public static byte[] enrol(MockMvc mvc, String challenge) throws Exception {
        JsonNode body = postOk(mvc, Routes.Auth.STAFF_LOGIN_ENROL,
                "{\"challenge\":\"%s\"}".formatted(challenge));
        return decodeBase32(body.get("secret").asText());
    }

    public static MockHttpServletResponse submit(MockMvc mvc, String route, String challenge,
            String code) throws Exception {
        return mvc.perform(post(route).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"challenge\":\"%s\",\"code\":\"%s\",\"remember\":true}"
                                .formatted(challenge, code)))
                .andReturn().getResponse();
    }

    public static String codeNow(byte[] secret) {
        return Totp.code(secret, Totp.stepAt(Instant.now()));
    }

    /** First sign-in of a never-enrolled account, ending with tokens and the refresh cookie. */
    public static MockHttpServletResponse firstSignIn(MockMvc mvc, String email, String password)
            throws Exception {
        String challenge = password(mvc, email, password).get("challenge").asText();
        byte[] secret = enrol(mvc, challenge);
        return submit(mvc, Routes.Auth.STAFF_LOGIN_ENROL_CONFIRM, challenge, codeNow(secret));
    }

    public static byte[] decodeBase32(String text) {
        byte[] out = new byte[text.length() * 5 / 8];
        int buffer = 0;
        int bits = 0;
        int index = 0;
        for (char c : text.toCharArray()) {
            buffer = (buffer << 5) | BASE32.indexOf(c);
            bits += 5;
            if (bits >= 8) {
                out[index++] = (byte) (buffer >> (bits - 8));
                bits -= 8;
            }
        }
        return out;
    }

    private static JsonNode postOk(MockMvc mvc, String route, String body) throws Exception {
        MockHttpServletResponse response = mvc.perform(post(route)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andReturn().getResponse();
        if (response.getStatus() != 200) {
            throw new AssertionError(route + " answered " + response.getStatus() + ": "
                    + response.getContentAsString());
        }
        return JSON.readTree(response.getContentAsString());
    }
}
