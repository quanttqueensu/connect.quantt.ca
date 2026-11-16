import { after } from "next/server";

import type { D1Database } from "@/lib/db/d1";
import { hubEnv } from "@/lib/hub/env";
import { quietly, mailSender, type SendEmails } from "@/lib/notifications";

/**
 * Send notification emails after the response, so the person who acted
 * isn't kept waiting and an email hiccup never fails their action.
 * The rules for who gets what are in lib/notifications.ts.
 */
export function notifyLater(label: string, task: (db: D1Database, send: SendEmails) => Promise<void>) {
  after(() =>
    quietly(label, async () => {
      const env = await hubEnv();
      await task(env.DB, mailSender(env));
    }),
  );
}
