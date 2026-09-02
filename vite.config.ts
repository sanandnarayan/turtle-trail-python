import vinext from "vinext";
import { defineConfig } from "vite";

const workerConfig = {
  name: "turtle-trail-python",
  main: "./worker/index.ts",
  compatibility_date: "2026-09-02",
  compatibility_flags: ["nodejs_compat"],
  routes: [
    { pattern: "python.codeanand.com", custom_domain: true },
    { pattern: "pyforkids.com", custom_domain: true },
    { pattern: "www.pyforkids.com", custom_domain: true },
  ],
  d1_databases: [
    {
      binding: "DB",
      database_name: "turtle-trail-progress",
      database_id: "278d6127-5301-4363-ae5c-44ce776b72a1",
      migrations_dir: "../../migrations",
    },
  ],
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
