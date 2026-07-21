import { defineConfig } from "@trigger.dev/sdk";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";

// Pushed into the Trigger.dev environment at deploy time so the tasks (chat agent +
// ingest) have their runtime secrets without setting them by hand in the dashboard.
const syncedEnvVars = [
  "CLICKHOUSE_URL",
  "CLICKHOUSE_USERNAME",
  "CLICKHOUSE_PASSWORD",
  "CLICKHOUSE_DATABASE",
  "OPENAI_API_KEY",
] as const;

export default defineConfig({
  project: "proj_dafxddqhdvhxtptwvbij",
  dirs: ["./trigger"],
  maxDuration: 3600,
  build: {
    extensions: [
      syncEnvVars(() =>
        syncedEnvVars.flatMap((name) => {
          const value = process.env[name];
          return value
            ? [{ name, value, isSecret: name !== "CLICKHOUSE_DATABASE" }]
            : [];
        }),
      ),
    ],
  },
});
