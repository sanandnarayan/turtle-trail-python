import vinext from "vinext";
import { defineConfig } from "vite";

const workerConfig = {
  name: "turtle-trail-python",
  main: "./worker/index.ts",
  compatibility_date: "2026-09-02",
  compatibility_flags: ["nodejs_compat"],
  routes: [{ pattern: "python.codeanand.com", custom_domain: true }],
};

export default defineConfig(async () => {
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: workerConfig,
      }),
    ],
  };
});
