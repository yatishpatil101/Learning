package com.punenest.api.engagement.society;

/**
 * What a "helpful" vote turns into once it lands.
 *
 * <p>The vote endpoints answer with the new state rather than 204, because the button renders a
 * count. A client that could only learn "it worked" would either re-read the whole page to update
 * one number or guess — and a guess is wrong the moment somebody else voted in between, which on a
 * popular tip is most of the time.
 */
public record SocietyHelpfulResponse(long helpfulCount, boolean helpfulByMe) {
}
