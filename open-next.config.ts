import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Defaults: no incremental cache. Every page here is per-user and dynamic.
export default defineCloudflareConfig();
