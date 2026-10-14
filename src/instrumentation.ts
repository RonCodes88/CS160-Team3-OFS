// Runs once when a server starts. Node-only code is imported dynamically so
// the Edge runtime never bundles it.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkEnvOnStartup } = await import("@/lib/envStartup");
    checkEnvOnStartup();
  }
}
