/**
 * Minimal UI primitives (button / card / input / badge / …) — the standalone
 * repo's stand-in for the monorepo's design-system package. Tailwind theme
 * tokens only; no hardcoded colors.
 */
"use client";

import { XIcon } from "lucide-react";
import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

// ── Button ───────────────────────────────────────────────────────────────────

type ButtonVariant = "default" | "secondary" | "destructive" | "outline" | "ghost" | "success";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  default:
    "bg-primary text-primary-foreground shadow-sm shadow-primary/25 hover:bg-primary/90 hover:shadow-md hover:shadow-primary/25",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  destructive:
    "bg-destructive text-destructive-foreground shadow-sm shadow-destructive/20 hover:bg-destructive/90",
  success:
    "bg-success text-success-foreground shadow-sm shadow-success/20 hover:bg-success/90",
  outline: "border border-input bg-card hover:border-ring/40 hover:bg-accent hover:text-accent-foreground",
  ghost: "hover:bg-accent hover:text-accent-foreground",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "default" | "sm" | "lg";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        size === "sm" ? "h-8 px-3 text-xs" : size === "lg" ? "h-11 px-6" : "h-9 px-4",
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";

// ── Card ─────────────────────────────────────────────────────────────────────

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border/80 bg-card text-card-foreground shadow-soft transition-shadow",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex flex-col gap-1.5 p-4", className)}>{children}</div>;
}

export function CardTitle({ className, children }: { className?: string; children: ReactNode }) {
  // h2, not h3: every page's only ancestor heading is its h1, so h3 card
  // titles skipped a level (flagged by the accessibility audit).
  return <h2 className={cn("font-semibold leading-none tracking-tight", className)}>{children}</h2>;
}

export function CardContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("p-4 pt-0", className)}>{children}</div>;
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[60px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export function Label({ className, children, htmlFor }: { className?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("text-sm font-medium leading-none", className)}>
      {children}
    </label>
  );
}

// ── Badge ────────────────────────────────────────────────────────────────────

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "warning"
  | "success"
  | "info"
  | "agent"
  | "outline"
  | "muted";

const BADGE_VARIANTS: Record<BadgeVariant, string> = {
  default: "border-primary/30 bg-primary/10 text-primary",
  secondary: "border-transparent bg-secondary text-secondary-foreground",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
  warning: "border-warning/30 bg-warning/10 text-warning",
  success: "border-success/30 bg-success/10 text-success",
  info: "border-info/30 bg-info/10 text-info",
  agent: "border-agent/30 bg-agent/10 text-agent",
  outline: "text-foreground",
  muted: "border-dashed border-muted-foreground/40 bg-muted text-muted-foreground",
};

export function Badge({
  className,
  variant = "default",
  dot = false,
  children,
}: {
  className?: string;
  variant?: BadgeVariant;
  /** Renders a leading status dot in the variant's text color. */
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors duration-300",
        BADGE_VARIANTS[variant],
        className,
      )}
    >
      {dot ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

// ── Shimmer / Loader ────────────────────────────────────────────────────────

export function Shimmer({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-shimmer rounded bg-gradient-to-r from-muted via-accent to-muted bg-[length:200%_100%]",
        className,
      )}
    />
  );
}

export function Loader({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-4 w-4 animate-spin text-muted-foreground", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Cargando"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

// ── Dialog (minimal modal) ──────────────────────────────────────────────────

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Callers pass inline arrows — a ref keeps the trap effect from re-running
  // (and yanking focus mid-typing) on every parent re-render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Modal behavior while open: Escape closes, Tab cycles inside the panel,
  // the page behind stops scrolling, and focus returns where it came from.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () =>
      panel ? [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)] : [];
    (focusables()[0] ?? panel)?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === panel)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "animate-scale-in max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border/60 bg-card p-5 shadow-lift outline-none",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Cerrar">
            <XIcon className="h-4 w-4" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
