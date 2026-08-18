"use client";

/**
 * The compliance-officer roster (SPEC §8.1): 7-state badge,
 * next-expiry-first sort, debounced search, status + expiring-within
 * filters, tags. Fed by vendorCompliance.listVendors.
 */
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, SearchXIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Loader, Shimmer } from "@/components/ui/primitives";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/lib/trpc-client";
import { formatDate } from "@/lib/utils";

import { VendorStatusBadge, vendorStatusLabel } from "../vendor-status-badge";

const STATUS_OPTIONS = [
  "",
  "NOT_STARTED",
  "IN_PROGRESS",
  "PRE_APPROVED",
  "NEED_REVIEW",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
] as const;

type StatusFilter = Exclude<(typeof STATUS_OPTIONS)[number], "">;

/** Native-select styling matched to the Input primitive (one control vocabulary). */
const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-card px-2 text-sm shadow-sm transition-[border-color,box-shadow] focus-visible:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto";

export function VendorsRoster() {
  const trpc = useTRPC();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [expiringOnly, setExpiringOnly] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const vendorsQuery = useQuery(
    trpc.listVendors.queryOptions(
      {
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(status ? { status: status as StatusFilter } : {}),
        ...(expiringOnly ? { expiringWithinDays: 30 } : {}),
      },
      { refetchInterval: 15_000 },
    ),
  );
  // First paint: data undefined and no error yet → shimmer skeleton rows.
  const isInitialLoading = vendorsQuery.data === undefined && !vendorsQuery.isError;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <div className="glass sticky top-0 z-10 -mx-4 flex flex-col gap-3 rounded-b-lg px-4 py-3 md:-mx-6 md:px-6">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Vendor compliance</h1>
            <p className="text-sm text-muted-foreground">
              The officer roster — expiring vendors first.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="self-start sm:self-auto"
            onClick={() =>
              void authClient
                .signOut()
                .catch(() => undefined)
                .then(() => {
                  router.push("/login");
                  router.refresh();
                })
            }
          >
            Sign out
          </Button>
        </header>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Input
            placeholder="Search vendors…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:max-w-xs"
          />
          <select
            aria-label="Filter by status"
            className={SELECT_CLASS}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === "" ? "All statuses" : vendorStatusLabel(option)}
              </option>
            ))}
          </select>
          <label className="flex h-9 items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input accent-primary"
              checked={expiringOnly}
              onChange={(e) => setExpiringOnly(e.target.checked)}
            />
            Expiring within 30 days
          </label>
          {vendorsQuery.isFetching ? (
            <span className="animate-fade-in">
              <Loader />
            </span>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Roster</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-2 py-2">Vendor</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="hidden px-2 py-2 sm:table-cell">Granted</th>
                  <th className="px-2 py-2">Next expiry</th>
                  <th className="hidden px-2 py-2 md:table-cell">Tags</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {isInitialLoading
                  ? [0, 1, 2, 3, 4].map((i) => (
                      <tr key={i} aria-hidden className="border-b last:border-b-0">
                        <td className="px-2 py-3">
                          <Shimmer className="h-4 w-40 max-w-full" />
                          <Shimmer className="mt-1.5 h-3 w-24 max-w-full" />
                        </td>
                        <td className="px-2 py-3">
                          <Shimmer className="h-5 w-24 rounded-full" />
                        </td>
                        <td className="hidden px-2 py-3 sm:table-cell">
                          <Shimmer className="h-4 w-20" />
                        </td>
                        <td className="px-2 py-3">
                          <Shimmer className="h-4 w-24" />
                        </td>
                        <td className="hidden px-2 py-3 md:table-cell">
                          <Shimmer className="h-4 w-16" />
                        </td>
                        <td className="px-2 py-3" />
                      </tr>
                    ))
                  : null}
                {(vendorsQuery.data ?? []).map((vendor) => (
                  <tr
                    key={vendor.uuid}
                    className="group animate-fade-in border-b transition-colors last:border-b-0 hover:bg-primary/5"
                  >
                    <td className="px-2 py-2">
                      <p className="font-medium">{vendor.legalName}</p>
                      {vendor.dbaName ? (
                        <p className="text-xs text-muted-foreground">dba {vendor.dbaName}</p>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        <VendorStatusBadge status={vendor.complianceStatus} />
                        {vendor.coverageDetermining ? (
                          <span className="animate-fade-in">
                            <Loader className="h-3 w-3 text-agent" />
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="hidden px-2 py-2 tabular-nums sm:table-cell">
                      {vendor.grantedCount} categories
                    </td>
                    <td className="px-2 py-2 tabular-nums">
                      {vendor.nextExpiryAt ? formatDate(vendor.nextExpiryAt) : "—"}
                    </td>
                    <td className="hidden px-2 py-2 md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {vendor.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[11px]">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Link
                        href={`/vendors/${vendor.uuid}`}
                        className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        Open
                        <ChevronRightIcon
                          aria-hidden
                          className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                        />
                      </Link>
                    </td>
                  </tr>
                ))}
                {vendorsQuery.isError ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-center">
                      <p role="alert" className="text-destructive">
                        The roster could not be loaded.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={() => void vendorsQuery.refetch()}
                      >
                        Try again
                      </Button>
                    </td>
                  </tr>
                ) : vendorsQuery.data?.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-10 text-center">
                      <div className="animate-fade-in flex flex-col items-center gap-2">
                        <SearchXIcon aria-hidden className="h-8 w-8 text-muted-foreground/50" />
                        <p className="text-sm text-muted-foreground">No vendors match.</p>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
