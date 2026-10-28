export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initErrorReporter } = await import("@above-public-affairs/error-reporter");
    initErrorReporter({ project: "ai-topic-explorer" });
  }
}
