import { AppShell } from "@/components/app-shell";
import { viewFromParams } from "@/lib/view-context";
import { notion } from "@/lib/server/notion-service";
import { repository } from "@/lib/server/repository";
import { publicConfig } from "@/lib/server/config";

export const dynamic = "force-dynamic";
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (typeof value === "string") params.set(key, value);
  const [initialLocal, initialGraph] = await Promise.all([
    Promise.resolve().then(() => repository().snapshot()).catch(() => undefined),
    notion().then(adapter => adapter.getCachedGraph()).catch(() => undefined),
  ]);
  const requestedView = viewFromParams(params);
  return <AppShell initialView={!requestedView || requestedView === "inbox" ? "overview" : requestedView} initialLocal={initialLocal} initialGraph={initialGraph} initialConfig={publicConfig()} />;
}
