/* Loading placeholder for the /society and /society/:slug route chunk.
 *
 * Replaces the app-wide centred spinner, which lives in a `min-h-[60vh]` box and
 * therefore collapses into a much taller page the moment the chunk resolves. The
 * hero alone is 224px on a phone and 288px from sm up, so the jump is large and
 * lands right where a reader has just started looking — and anything asserting
 * against the tab row has to race that reflow.
 *
 * Measurements come from Society.jsx and the components it renders:
 *   - wrapper     `pt-8 sm:pt-10 pb-24`, `max-w-6xl`
 *   - hero        `rounded-3xl overflow-hidden mb-6 glass`, image `h-56 sm:h-72`
 *   - stats       `grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-8` of `.rd-cell`
 *   - tab strip   `.pn-detail-tab` — .85rem block padding around a .875rem line, ≈48px
 *   - body        `grid lg:grid-cols-3 gap-8`, content spans 2 with the sidebar beside it
 *
 * `.rd-cell` and `.glass` are defined in the global stylesheet, not in a route
 * chunk, so they are already applied while this renders.
 */
export default function SocietySkeleton() {
  return (
    <div
      className="pt-8 sm:pt-10 pb-24 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8"
      /* One live region for the whole route, announced once. */
      role="status"
      aria-live="polite"
      aria-label="Loading society"
      data-testid="society-skeleton"
    >
      {/* Breadcrumb */}
      <div className="h-5 w-72 max-w-full skeleton rounded mb-5" />

      {/* Hero — one block at the image's exact height, because the title, tags and
          rating are absolutely positioned over it and contribute nothing extra. */}
      <div className="skeleton rounded-3xl h-56 sm:h-72 w-full mb-6" />

      {/* Stat cells: four, in the real 2-up / 4-up grid, each holding a label line
          over a value line so the cell height comes out of the same padding. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-8">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rd-cell">
            <div className="h-3 w-16 skeleton rounded" />
            <div className="h-4 w-20 skeleton rounded mt-1.5" />
          </div>
        ))}
      </div>

      {/* Section tabs. Five, matching the overview/homes/reviews/community/location
          strip; the bottom rule is real so the line does not appear from nowhere. */}
      <div className="flex gap-1 sm:gap-2 border-b border-white/10 mb-6 overflow-hidden">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-12 w-24 skeleton rounded-t-lg flex-shrink-0" />)}
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="h-48 skeleton rounded-2xl" />
          <div className="h-64 skeleton rounded-2xl" />
        </div>
        {/* Sidebar — full width on a phone, where it stacks under the content. */}
        <div className="h-72 skeleton rounded-2xl" />
      </div>
    </div>
  );
}
