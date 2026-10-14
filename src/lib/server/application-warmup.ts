import "server-only";
import { defaultContactOptions } from "@/lib/contact-contracts";
import { contactAdapter } from "./contact";
import { githubAdapter } from "./github";
import { repository } from "./repository";
import { startNotionBackgroundSync } from "./notion-service";

const warmupGlobal = globalThis as typeof globalThis & { taesksApplicationWarmup?: boolean };

export function startApplicationWarmup() {
  if (warmupGlobal.taesksApplicationWarmup) return;
  warmupGlobal.taesksApplicationWarmup = true;
  startNotionBackgroundSync();
  void Promise.resolve().then(() => repository().snapshot()).catch(() => undefined);

  const refreshRemoteSources = async () => {
    const unreadOptions = { ...defaultContactOptions, filter: "unread" as const };
    await Promise.allSettled([
      githubAdapter().dashboard(),
      contactAdapter().list(defaultContactOptions),
      contactAdapter().list(unreadOptions),
    ]);
  };
  void refreshRemoteSources().catch(() => undefined);
  const timer = setInterval(() => { void refreshRemoteSources().catch(() => undefined); }, 60_000);
  timer.unref?.();
}
