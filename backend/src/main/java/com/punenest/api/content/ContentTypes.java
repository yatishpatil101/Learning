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
 * <p><strong>Kept, deliberately unfinished (D26).</strong> Adding the console tab on its own would
 * produce records no visitor sees; pointing a {@code /services} landing index at the CMS on its own
 * would produce a page fed by a table nobody can edit. Either half alone is worse than neither,
 * which is presumably how it arrived here. Deleting the type was considered and rejected: every
 * layer already exists and is tested, the column is a {@code text} discriminator so an unused value
 * costs nothing at rest, and removing it would mean unpicking a permission, a public route and two
 * client providers to save nothing. It stays as a complete, dormant fourth type, to be switched on
 * by building both ends together. This comment exists so the next reader does not spend the
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
