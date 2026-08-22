"use client";

/**
 * The vendor-assistant surface — self-contained and hidden at session
 * start: a floating opener, then ONE always-mounted host rendered as a
 * fixed slide-in drawer (the portal is a centered column, so a drawer fits
 * every breakpoint). Single host = the chat (and its live stream) survives
 * collapsing and reopening; `inert` removes the collapsed panel from the
 * tab order and assistive tech.
 */
import { useEffect, useRef, useState } from "react";
import { BotIcon, ChevronsRightIcon, MessageCircleIcon } from "lucide-react";

import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

import { AssistantChat } from "./assistant-chat";

function PanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border/60 bg-gradient-to-b from-agent/5 to-transparent px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-agent/10 text-agent">
          <BotIcon className="h-4 w-4" />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-foreground">Asistente</p>
          <p className="text-xs text-muted-foreground">
            Con acceso a su registro de cumplimiento
          </p>
        </div>
      </div>
      <Button
        aria-label="Contraer el asistente"
        className="h-8 w-8 p-0"
        onClick={onClose}
        size="sm"
        type="button"
        variant="ghost"
      >
        <ChevronsRightIcon className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function AssistantPanel() {
  // Hidden at the start of every session — deliberately not persisted.
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  const show = () => {
    setEverOpened(true);
    setOpen(true);
  };

  const close = () => setOpen(false);

  // Symmetric to the focus-in on open: `inert` force-blurs whatever is
  // focused inside the drawer, so closing would dump keyboard focus on
  // <body>. Runs AFTER the close re-render — focusing synchronously would
  // target the opener while it still carries aria-hidden/tabIndex=-1, and
  // SRs would miss the move.
  useEffect(() => {
    if (!open && everOpened) openerRef.current?.focus();
  }, [open, everOpened]);

  // Move focus into the drawer on open — the Escape handler lives on the
  // <aside>, so without this the key does nothing until the user clicks in.
  // On FIRST open the chat (and its textarea) mounts a beat after the panel,
  // so retry briefly — but never steal focus once the user moved it.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusComposer = () => {
      const textarea = panel.querySelector<HTMLElement>("textarea");
      if (!textarea) return false;
      textarea.focus();
      return true;
    };
    if (focusComposer()) return;
    panel.focus();
    const started = Date.now();
    const timer = window.setInterval(() => {
      const active = document.activeElement;
      const focusStillOurs = active === panel || active === document.body;
      if (!focusStillOurs || focusComposer() || Date.now() - started > 600) {
        window.clearInterval(timer);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [open]);

  return (
    <>
      {/* Floating opener — always mounted (the assistant's discovery
          affordance) and faded/scaled out while the panel is open;
          pointer-events + tabIndex keep the hidden state inert. */}
      <Button
        aria-hidden={open || undefined}
        aria-label="Abrir el asistente de cumplimiento"
        className={cn(
          "fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] right-4 z-30 gap-2 rounded-full shadow-glow transition-all duration-300 lg:right-6",
          open ? "pointer-events-none scale-90 opacity-0" : "scale-100 opacity-100",
        )}
        onClick={show}
        ref={openerRef}
        tabIndex={open ? -1 : undefined}
        type="button"
      >
        <MessageCircleIcon className="h-4 w-4" />
        <span className="hidden sm:inline">Asistente</span>
      </Button>

      {/* NO backdrop (SPEC §17 C12): the assistant is a NON-modal panel —
          the vendor keeps inspecting and interacting with the portal
          (doc cards, toggles, the gate) while chatting. Closing is the
          Collapse button or Escape; the frost lives only on the drawer's
          own surface, never over the page. */}

      {/* The ONE chat host: a fixed slide-in drawer. Never unmounts once
          opened, so the live stream survives collapse/reopen. */}
      <aside
        ref={panelRef}
        aria-label="Asistente de cumplimiento"
        tabIndex={-1}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border/60 bg-background/95 shadow-lift outline-none backdrop-blur-xl transition-transform duration-300 ease-in-out xl:max-w-lg",
          open ? "translate-x-0" : "translate-x-full",
        )}
        inert={!open || undefined}
        onKeyDown={(e) => {
          // isComposing: Escape cancelling an IME composition in the
          // composer must not collapse the whole drawer.
          if (e.key === "Escape" && !e.nativeEvent.isComposing) close();
        }}
      >
        <div className="flex h-full w-full min-w-0 flex-col">
          <PanelHeader onClose={close} />
          {everOpened && <AssistantChat />}
        </div>
      </aside>
    </>
  );
}
