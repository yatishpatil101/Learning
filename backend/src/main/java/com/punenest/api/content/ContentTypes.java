package com.punenest.api.content;

/**
 * The four CMS lists the API can serve (contract parameter {@code ContentType}).
 *
 * <p><strong>Ops manages three of them.</strong> This comment used to read "the four CMS lists ops
 * manages", which is not true and has not been true: the admin console's Content screen has tabs
 * for {@code banners}, {@code faqs} and {@code announcements}, and none for {@code services}. Every
 * other layer for {@code services} exists -- table, entity, repository, the public {@code GET
 * /services}, this service's write branches, the {@code content.services} permission, and a
 * {@code case 'services'} in both of the client's content providers -- but nothing writes it and
 * nothing reads it, so {@code cms_services} is authored by nobody and rendered to nobody.
 *
 * <p>Deliberately not resolved by adding the tab. A console tab on its own produces records no
 * visitor sees; pointing the {@code /services} landing index at the CMS on its own produces a page
 * fed by a table nobody can edit. Either half alone is worse than neither, which is presumably how
 * it arrived here. The choice between finishing both ends and deleting the type is recorded as item
 * 26 in {@code tasks/DECISIONS-NEEDED.md}; this comment exists so the next reader does not spend the
 * afternoon looking for the fourth tab.
 */
public final class ContentTypes {

    public static final String ANNOUNCEMENTS = "announcements";
    public static final String SERVICES = "services";
    public static final String FAQS = "faqs";
    public static final String BANNERS = "banners";

    private ContentTypes() {
    }
}
