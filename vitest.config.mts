import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors tsconfig's "@/*" path. Only "@" or "@/…" match, so scoped
    // packages like @anthropic-ai/sdk are untouched.
    alias: { "@": import.meta.dirname },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Tests must never reach a provider: clear keys so an accidental real
    // client call fails fast instead of spending money.
    env: {
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      GOOGLE_AI_API_KEY: "",
      XAI_API_KEY: "",
      // The model registry reads Postgres; with no URL it uses its built-in
      // defaults, so no test reaches a database.
      DATABASE_URL: "",
      ERROR_API_URL: "",
      ERROR_API_KEY: "",
    },
  },
});
