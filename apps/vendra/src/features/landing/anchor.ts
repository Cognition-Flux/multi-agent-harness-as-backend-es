import type { MouseEvent } from "react";

/**
 * In-page anchor navigation. Left to the Next router, a `#section` click on
 * this force-dynamic route triggers an RSC round-trip (~1s in dev) and then
 * an instant jump. Scrolling directly is immediate, honors the global
 * `scroll-behavior: smooth` (and its reduced-motion override) plus each
 * section's scroll-margin, and keeps the hash shareable via replaceState.
 */
export function onAnchorClick(e: MouseEvent<HTMLAnchorElement>) {
  // Modified or non-primary clicks keep their native behavior (new tab/window).
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
    return;
  }
  const href = e.currentTarget.getAttribute("href");
  if (!href?.startsWith("#")) return;
  const target = document.getElementById(href.slice(1));
  if (!target) return;
  e.preventDefault();
  target.scrollIntoView({ block: "start" });
  // Restore what preventDefault suppressed: fragment navigation moves focus
  // (and the sequential-focus starting point) to the target — without this
  // the skip link scrolls but the next Tab still lands on the nav.
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  history.replaceState(null, "", href);
}
