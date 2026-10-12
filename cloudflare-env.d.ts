// Bindings from wrangler.jsonc, as getCloudflareContext().env sees them.
import type { QuanttDirectory } from "./lib/quantt-signin";

declare global {
  interface CloudflareEnv {
    AUTH: QuanttDirectory;
  }
}

export {};
