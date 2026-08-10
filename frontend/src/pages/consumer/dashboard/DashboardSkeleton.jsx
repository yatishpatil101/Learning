/* Loading placeholder for the /dashboard route chunk.
 *
 * The route is code-split, so between the click and the chunk arriving something
 * has to hold the page open. The app-wide fallback is a centred spinner inside a
 * `min-h-[60vh]` box — a height the dashboard never has. When the chunk lands,
 * the greeting, the section switcher and the panel all appear at once and shove
 * the page down: a late reflow, which is the failure mode that destabilised the
 * document assertions previously (a click resolves against coordinates the
 * spinner occupied, not the control that has just moved into them).
 *
 * The blocks are read off the real components rather than guessed:
 *   - greeting     Dashboard.jsx      — `text-2xl sm:text-3xl` heading + a `text-sm` line
 *   - section row  MobileNav.jsx      — `lg:hidden mb-5`, trigger is `min-h-[52px] rounded-2xl glass-card`
 *   - sidebar      DashboardSidebar   — `hidden lg:block`, `glass-card rounded-2xl p-4`, 260px column
 *   - wrapper      Dashboard.jsx      — `pt-6 lg:pt-8 pb-20 min-h-[100dvh]`, `max-w-7xl`
 *
 * `.skeleton` carries the shimmer and both reduced-motion opt-outs (the OS media
 * query and the in-app Settings toggle), so nothing extra is needed here.
 */
export default function DashboardSkeleton() {
  return (
    <div
      className="pt-6 lg:pt-8 pb-20 min-h-[100dvh]"
      /* One live region for the whole route. Announced once on arrival; putting
         role=status on each block instead would read out a dozen empty nodes. */
      role="status"
      aria-live="polite"
      aria-label="Loading dashboard"
      data-testid="dashboard-skeleton"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Greeting, then the activity strapline — the reading order of the real header. */}
        <div className="mb-6">
          <div className="h-8 sm:h-9 w-56 skeleton rounded" />
          <div className="h-4 w-64 skeleton rounded mt-2" />
        </div>

        {/* Mobile section switcher. Desktop shows the sidebar instead, so this
            block must disappear at the same breakpoint the real one does. */}
        <div className="lg:hidden mb-5">
          <div className="h-[52px] w-full skeleton rounded-2xl" />
        </div>

        <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-6">
          {/* Sidebar — desktop only, mirroring DashboardSidebar's own `hidden lg:block`. */}
          <aside className="hidden lg:block">
            <div className="glass-card rounded-2xl p-4">
              <div className="flex items-center gap-3 px-2 pb-4 mb-3 border-b border-white/8">
                <div className="w-11 h-11 skeleton rounded-full flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="h-4 w-24 skeleton rounded" />
                  <div className="h-3 w-16 skeleton rounded mt-1.5" />
                </div>
              </div>
              <div className="space-y-1">
                {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-10 skeleton rounded-xl" />)}
              </div>
            </div>
          </aside>

          {/* Panel. Which panel is unknown until the chunk resolves, so this is
              the shared floor every tab starts with: a heading and stacked cards,
              at roughly the height the shortest of them occupies. Erring short is
              deliberate — content growing downwards past the fold moves nothing
              the reader is looking at, whereas an over-tall placeholder collapsing
              pulls the whole page up. */}
          <section className="space-y-4">
            <div className="h-6 w-40 skeleton rounded" />
            <div className="h-40 skeleton rounded-2xl" />
            <div className="h-64 skeleton rounded-2xl" />
          </section>
        </div>
      </div>
    </div>
  );
}
