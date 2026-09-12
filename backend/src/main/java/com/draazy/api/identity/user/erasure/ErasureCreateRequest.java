package com.draazy.api.identity.user.erasure;

import jakarta.validation.constraints.Size;

/**
 * {@code POST /me/erasure} body.
 *
 * <p>{@code reason} is optional and always will be. A statutory right is not conditional on
 * explaining yourself, and a required field here would turn one into a negotiation. It is accepted
 * because a subject who does explain often says the thing that decides the case — "I never signed
 * up" reads very differently from "I have moved out".
 */
public record ErasureCreateRequest(@Size(max = 2000) String reason) {
}
