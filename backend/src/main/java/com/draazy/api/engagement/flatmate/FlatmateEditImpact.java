package com.draazy.api.engagement.flatmate;

import java.util.List;

/** The return type {@link FlatmateEditRules} hands to the supply and seeker services, so it belongs
 * to neither. Mirrors {@code catalog.listing.EditImpact}. */
record FlatmateEditImpact(boolean remoderationRequired, boolean recheckOnly, List<String> rechecked) {

    static final FlatmateEditImpact SILENT = new FlatmateEditImpact(false, false, List.of());
}
