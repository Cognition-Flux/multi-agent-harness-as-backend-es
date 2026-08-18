import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { createTrpcContext } from "@/server/trpc/init";
import { appRouter } from "@/server/trpc/router";

export const runtime = "nodejs";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTrpcContext({ headers: req.headers }),
  });

export { handler as GET, handler as POST };
