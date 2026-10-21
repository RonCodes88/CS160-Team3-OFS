/** Shown while the catalog loads. */
export default function Loading() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 md:py-16" aria-busy="true">
      <p role="status" className="text-2xl">
        Loading the aisles...
      </p>
      <ul aria-hidden className="mt-8 grid grid-cols-2 gap-3 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i} className="h-80 animate-pulse rounded-wobbly-md border-2 border-dashed border-pencil/40 bg-white" />
        ))}
      </ul>
    </section>
  );
}
