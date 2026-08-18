"use client";

/**
 * tRPC v11 + TanStack Query client wiring (the officer dashboard's data
 * layer). `createTRPCContext` is the documented @trpc/tanstack-react-query
 * integration: `useTRPC()` yields typed queryOptions/mutationOptions.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { useState, type ReactNode } from "react";
import superjson from "superjson";

import type { AppRouter } from "@/server/trpc/router";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

export function TrpcQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5_000, retry: 1 } },
      }),
  );
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: "/api/trpc", transformer: superjson })],
    }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
