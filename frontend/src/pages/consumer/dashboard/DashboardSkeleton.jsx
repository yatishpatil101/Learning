/* The route is code-split, and the app-wide `min-h-[60vh]` spinner is a height the dashboard never
   has — the chunk landing shoves the page down mid-click. Block sizes mirror Dashboard.jsx,
   MobileNav.jsx and DashboardSidebar. */
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

          {/* Which panel is unknown until the chunk resolves, so this is the shared floor every tab
              starts with. Erring short is deliberate: an over-tall placeholder collapsing pulls the
              whole page up. */}
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
