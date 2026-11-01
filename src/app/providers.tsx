"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { LocalizationProvider } from "@/components/localization";
import type { PublicConfig } from "@/lib/public-config";
import type { LocalSnapshot } from "@/lib/types";
import { PwaRuntime } from "@/components/pwa";
import { MutationFeedback } from "@/components/mutation-status";

export function Providers({ children, initialConfig, initialLocal }: { children: React.ReactNode; initialConfig?: PublicConfig; initialLocal?: LocalSnapshot }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { networkMode: "always", staleTime: 30_000, retry: 1, refetchOnWindowFocus: false }, mutations: { networkMode: "always", retry: false } } }));
  return <QueryClientProvider client={client}><LocalizationProvider initialConfig={initialConfig} initialLocal={initialLocal}><PwaRuntime />{children}<MutationFeedback /></LocalizationProvider></QueryClientProvider>;
}
