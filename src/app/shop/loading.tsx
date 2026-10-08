/** Shown while the catalog loads. */
export default function Loading() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 md:py-16" aria-busy="true">
      <p role="status" className="text-2xl">
        Loading the aisles...
      </p>
      <ul aria-hidden className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="h-80 animate-pulse rounded-wobbly-md border-2 border-dashed border-pencil/40 bg-white" />
        ))}
      </ul>
    </section>
  );
}
