"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { PwaRuntime } from "@/components/pwa";
import { MutationFeedback } from "@/components/mutation-status";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { networkMode: "always", staleTime: 30_000, retry: 1, refetchOnWindowFocus: false }, mutations: { networkMode: "always", retry: false } } }));
  return <QueryClientProvider client={client}><PwaRuntime />{children}<MutationFeedback /></QueryClientProvider>;
}
