/* Loading placeholder for the property detail route.
 *
 * Replaces a centred spinner. A spinner says "wait"; a skeleton says "wait, and
 * here is the shape of what is coming" — and because the blocks match the real
 * layout, the page does not jump when the data lands. On a listing page that
 * matters more than usual: the hero is full-bleed 4:3 on a phone, so a spinner
 * collapsing into a 309px-tall image is a large, visible shift.
 *
 * The measurements are taken from the real components, not guessed:
 *   - hero      Gallery.jsx  — `aspect-[4/3]` full-bleed, `sm:h-[320px] lg:h-[360px]`
 *   - price     the overlay on mobile / the header block on desktop
 *   - sidebar   PropertyHeader's owner card, `lg:col-span-2` + 1
 *
 * `.skeleton` carries the shimmer and (since this was added) honours both
 * reduced-motion opt-outs.
 */
export default function PropertySkeleton() {
  return (
    <div
      className="pt-[calc(var(--dz-nav-h)+16px)] sm:pt-[calc(var(--dz-nav-h)+40px)] pb-24"
      /* One live region for the whole route, announced once. Without role=status a
         screen reader gets silence between navigation and content; with it on each
         block it would get a dozen announcements. */
      role="status"
      aria-live="polite"
      aria-label="Loading property"
      data-testid="property-skeleton"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Back pill */}
        <div className="h-8 w-32 skeleton rounded-full mb-4" />

        {/* Hero — same bleed and ratio as the real gallery, so nothing moves. */}
        <div className="-mx-4 sm:mx-0 mb-6 sm:mb-10">
          <div className="skeleton aspect-[4/3] sm:aspect-auto sm:h-[320px] lg:h-[360px] w-full rounded-none sm:rounded-2xl" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          <div className="lg:col-span-2">
            {/* Tag row */}
            <div className="flex gap-2 mb-4">
              <div className="h-6 w-20 skeleton rounded-full" />
              <div className="h-6 w-24 skeleton rounded-full" />
            </div>
            {/* Price, then title, then locality — the reading order of the real page. */}
            <div className="h-9 w-48 skeleton rounded mb-3" />
            <div className="h-7 w-3/4 skeleton rounded mb-2" />
            <div className="h-5 w-1/2 skeleton rounded mb-6" />

            {/* Spec grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 skeleton rounded-xl" />)}
            </div>
          </div>

          {/* Owner card — desktop only, mirroring the real sidebar. */}
          <div className="hidden lg:block">
            <div className="h-64 skeleton rounded-2xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
