/* Loading placeholder for the /flatmates route chunk.
 *
 * Replaces the app-wide centred spinner. The spinner sits in a `min-h-[60vh]`
 * box, so the hero, the filter deck and the first row of cards all land at once
 * and jolt the page — a late reflow, and the reason this route was awkward to
 * assert against: a tap aimed at the List/Map toggle can land where the spinner
 * used to be.
 *
 * Sizes are taken from the real components:
 *   - wrapper    Flatmates.jsx  — `pt-6 pb-20 min-h-[100dvh]`, `max-w-6xl`
 *   - hero       Hero.jsx       — `glass rounded-3xl p-4 sm:p-6 mb-4`, badge + h1 + 2-line blurb + 3 pills
 *   - filters    FilterBar.jsx  — `glass rounded-2xl p-4 sm:p-5 mb-5`, tab row over a control row
 *   - results    Results.jsx    — `grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5`
 *
 * Deliberately built from global classes only (`skeleton`, `glass`, Tailwind
 * utilities). `styles/routes/flatmates.css` is imported by Flatmates.jsx, which
 * means it ships inside the very chunk this placeholder is waiting for — reaching
 * for `.sf-card` or `.sf-seg` here would render unstyled until the moment the
 * skeleton is thrown away, i.e. exactly when it stops mattering.
 */
export default function FlatmatesSkeleton() {
  return (
    <div
      className="pt-6 pb-20 min-h-[100dvh]"
      /* One live region for the whole route, announced once. */
      role="status"
      aria-live="polite"
      aria-label="Loading flatmates"
      data-testid="flatmates-skeleton"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Hero */}
        <div className="glass rounded-3xl p-4 sm:p-6 mb-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-5">
            <div className="max-w-2xl w-full">
              <div className="h-6 w-40 skeleton rounded-full mb-2.5" />
              <div className="h-8 sm:h-9 w-3/4 skeleton rounded" />
              <div className="h-4 w-full skeleton rounded mt-2" />
              <div className="h-4 w-2/3 skeleton rounded mt-1.5" />
              {/* The three trust pills — same count, so the hero keeps its height. */}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
                <div className="h-4 w-28 skeleton rounded" />
                <div className="h-4 w-24 skeleton rounded" />
                <div className="h-4 w-32 skeleton rounded" />
              </div>
            </div>
            {/* Post + verify buttons: a row on a phone, a column from sm up, matching Hero. */}
            <div className="flex flex-row sm:flex-col items-stretch gap-2 flex-shrink-0 w-full sm:w-auto">
              <div className="h-10 flex-1 sm:flex-none sm:w-44 skeleton rounded-xl" />
              <div className="h-10 flex-1 sm:flex-none sm:w-44 skeleton rounded-xl" />
            </div>
          </div>
        </div>

        {/* Filter deck — category tabs sit flush above the control row, sharing one card. */}
        <div className="glass rounded-2xl p-4 sm:p-5 mb-5">
          <div className="mb-3 pb-3 border-b border-white/10 flex gap-2">
            <div className="h-9 w-28 skeleton rounded-full" />
            <div className="h-9 w-24 skeleton rounded-full" />
            <div className="h-9 w-28 skeleton rounded-full hidden sm:block" />
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="h-10 lg:flex-1 lg:max-w-[600px] skeleton rounded-full" />
            <div className="flex items-center gap-2">
              <div className="h-10 w-24 skeleton rounded-xl lg:hidden" />
              <div className="h-10 w-40 skeleton rounded-xl ml-auto" />
            </div>
          </div>
        </div>

        {/* Six cards: the first screenful on every breakpoint (one column on a
            phone, two from sm, three from xl), so the grid never reflows when the
            real list replaces it. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="glass rounded-2xl p-5">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 skeleton rounded-full flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="h-4 w-28 skeleton rounded" />
                  <div className="h-3 w-20 skeleton rounded mt-1.5" />
                </div>
              </div>
              <div className="h-5 w-32 skeleton rounded mt-4" />
              <div className="flex flex-wrap gap-2 mt-3">
                <div className="h-6 w-20 skeleton rounded-full" />
                <div className="h-6 w-16 skeleton rounded-full" />
                <div className="h-6 w-24 skeleton rounded-full" />
              </div>
              <div className="h-3 w-full skeleton rounded mt-3" />
              <div className="h-3 w-4/5 skeleton rounded mt-1.5" />
              <div className="h-9 w-full skeleton rounded-xl mt-4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
