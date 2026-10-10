package com.draazy.api.documents.vault;

/** Contract schema {@code DocumentUrl}: a short-lived signed download URL, minted per request and never stored. */
public record DocumentUrl(String url) {
}
