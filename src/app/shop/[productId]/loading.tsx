/** Shown while a product page loads. */
export default function Loading() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 md:py-12" aria-busy="true">
      <p role="status" className="sr-only">
        Loading product...
      </p>
      <div aria-hidden className="mt-12 grid gap-8 md:grid-cols-2 md:gap-12">
        <div className="aspect-square animate-pulse rounded-wobbly-md border-2 border-dashed border-pencil/40 bg-white" />
        <div className="space-y-4">
          <div className="h-12 w-3/4 animate-pulse rounded-wobbly bg-muted" />
          <div className="h-10 w-1/3 animate-pulse rounded-wobbly bg-muted" />
          <div className="h-24 animate-pulse rounded-wobbly bg-muted" />
        </div>
      </div>
    </section>
  );
}
