"use client";

/**
 * The superadmin console configuring a company from scratch: minting the
 * officer account that gives the company anyone who can review at all,
 * choosing the vendor assistant's privilege tier, narrowing a document type's
 * extracted fields and counted validations, and setting which requirement
 * categories the system may approve on its own — ending on the OPA
 * admissibility gate's verdict over that configuration.
 *
 * It deliberately stops *before* activation: PolicyScene (the "Consola de
 * gobernanza" showcase tab) owns the activate → re-pin → version-history
 * beat. All copy is verbatim from policy-builder.tsx / dialogs.tsx, the
 * validator and category label maps, and the gate's finding translations.
 */

import {
  AlertTriangleIcon,
  BotIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  LockIcon,
  ShieldCheckIcon,
  UserCheckIcon,
  UsersIcon,
} from "lucide-react";
import { AnimatePresence, m } from "motion/react";

import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

import { useSceneLoop } from "../motion";
import { MockFrame, MockSpinner, STACK } from "./mock-frame";

const DURATIONS = [900, 1400, 1000, 1400, 1300, 1100, 1400, 3200] as const;
// 0 sin oficiales · 1 diálogo de alta · 2 cuenta creada · 3 privilegio del
// asistente · 4 documento configurado · 5 validación añadida · 6 poder de
// árbitro · 7 veredicto de la puerta OPA (asentado)
const SETTLED = DURATIONS.length - 1;

/** Left rail: the four knobs, each resolving to the value the beats set. */
const STEPS = [
  { icon: UsersIcon, label: "Oficiales de cumplimiento", value: "1 cuenta", from: 0, to: 2 },
  { icon: BotIcon, label: "Privilegios del asistente", value: "Delegado", from: 3, to: 3 },
  { icon: ShieldCheckIcon, label: "Documentos aceptados", value: "4 tipos", from: 4, to: 5 },
  { icon: UserCheckIcon, label: "Aprobación automática", value: "2 de 3", from: 6, to: 6 },
] as const;

/** ACORD 25's validator set, in VALIDATORS_BY_DOCUMENT_TYPE order. */
const ACORD_VALIDATORS = [
  { label: "El nombre de la empresa coincide", on: true },
  { label: "La vigencia cubre la fecha actual", on: true },
  { label: "El límite alcanza el mínimo exigido", on: true },
  { label: "Endosos requeridos presentes", on: false },
  { label: "El titular del certificado es correcto", on: false },
  { label: "El documento está firmado", on: false },
  { label: "Campos obligatorios presentes", on: true },
] as const;

/** ACORD 25's structural fields are locked — the platform derives from them. */
const ACORD_FIELDS = [
  { name: "insured_name", locked: true },
  { name: "coverage_lines", locked: true },
  { name: "additional_insured", locked: true },
  { name: "certificate_holder", locked: false },
] as const;

function Checkbox({ on, locked }: { on: boolean; locked?: boolean }) {
  return (
    <span
      className={cn(
        "flex h-3 w-3 shrink-0 items-center justify-center rounded-sm border transition-colors duration-200",
        on
          ? locked
            ? "border-muted-foreground/60 bg-muted"
            : "border-agent bg-agent/10"
          : "border-input bg-card",
      )}
    >
      {on ? (
        <CheckIcon className={cn("h-2.5 w-2.5", locked ? "text-muted-foreground" : "text-agent")} />
      ) : null}
    </span>
  );
}

function Radio({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center rounded-full border transition-colors duration-200",
        on ? "border-agent" : "border-input",
      )}
    >
      {on ? <span className="h-1.5 w-1.5 rounded-full bg-agent" /> : null}
    </span>
  );
}

function CardShell({
  icon: Icon,
  title,
  badge,
  children,
}: {
  icon: typeof UsersIcon;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <m.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5, transition: { duration: 0.1 } }}
      transition={{ duration: 0.2 }}
      className="rounded-md border border-border/60 bg-card p-2.5"
    >
      <p className="flex items-center gap-1.5 text-[11px] font-semibold">
        <Icon className="h-3.5 w-3.5 shrink-0 text-agent" />
        <span className="truncate">{title}</span>
        {badge}
      </p>
      <div className="mt-1.5">{children}</div>
    </m.div>
  );
}

export function GovernanceSetupScene() {
  const step = useSceneLoop(DURATIONS);
  const settled = step === SETTLED;
  const endorsementOn = step >= 5;

  return (
    <MockFrame
      title="Plataforma · Acme Constructora SpA"
      badge={
        <Badge variant="warning" className="text-[10px]">
          v4
        </Badge>
      }
    >
      <div className="grid gap-3 sm:grid-cols-[9.75rem_minmax(0,1fr)]">
        {/* Rail: each knob lights while its beats run, then holds its value. */}
        <ul className="space-y-1.5">
          {STEPS.map((s) => {
            const active = step >= s.from && step <= s.to;
            const done = settled || step > s.to;
            return (
              <li
                key={s.label}
                className={cn(
                  "rounded-md border px-2 py-1.5 transition-colors duration-200",
                  active
                    ? "border-agent/40 bg-agent/5"
                    : done
                      ? "border-success/25 bg-success/5"
                      : "border-border/50 bg-card",
                )}
              >
                <p className="flex items-center gap-1.5 text-[9px] font-medium leading-tight">
                  {done ? (
                    <CheckIcon className="h-3 w-3 shrink-0 text-success" />
                  ) : (
                    <s.icon
                      className={cn(
                        "h-3 w-3 shrink-0",
                        active ? "text-agent" : "text-muted-foreground",
                      )}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                </p>
                {/* No opacity dimming: 9px text under an alpha drops below
                    AA. Pending vs resolved is carried by italics and weight. */}
                <p
                  className={cn(
                    "mt-0.5 pl-4 text-[9px] tabular-nums transition-colors duration-200",
                    done ? "font-medium text-foreground" : "italic text-muted-foreground",
                  )}
                >
                  {done ? s.value : "sin definir"}
                </p>
              </li>
            );
          })}
        </ul>

        {/* Theater. Reserved to the tallest beat per breakpoint (measured:
            335px at 320w, 253px at ≥640w) — the expanded document panel is the
            tallest, the officer dialog the next. */}
        <div className={cn(STACK, "min-h-[22rem] sm:min-h-[16.5rem]")}>
          <AnimatePresence initial={false}>
            {step === 0 ? (
              <CardShell
                key="officers-empty"
                icon={UsersIcon}
                title="Oficiales de cumplimiento"
                badge={
                  <Badge variant="warning" className="ml-auto shrink-0 text-[8px]">
                    0
                  </Badge>
                }
              >
                <p className="text-[10px] leading-relaxed text-warning">
                  Nadie de esta empresa puede revisar proveedores todavía. Cree al menos una cuenta
                  de oficial.
                </p>
                <span className="mt-2 inline-flex items-center gap-1 rounded-md border border-input bg-card px-2 py-1 text-[10px] font-medium">
                  <UsersIcon className="h-3 w-3" />
                  Añadir oficial
                </span>
              </CardShell>
            ) : null}

            {step === 1 ? (
              <m.div
                key="officer-dialog"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
                transition={{ duration: 0.2 }}
                className="rounded-md border border-border/60 bg-card p-2.5 shadow-lift"
              >
                <p className="text-[11px] font-semibold">Añadir oficial de cumplimiento</p>
                <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">
                  La cuenta podrá revisar y aprobar a los proveedores de esta empresa — y de ninguna
                  otra.
                </p>
                <div className="mt-2 space-y-1.5">
                  {[
                    ["Nombre", "Nora Officer"],
                    ["Correo", "oficial@empresa.test"],
                    ["Contraseña temporal", "••••••••"],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[9px] text-muted-foreground">{label}</p>
                      <div className="mt-0.5 flex h-6 items-center rounded border border-input bg-card px-2 text-[10px]">
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex justify-end">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[10px] font-medium text-primary-foreground">
                    <MockSpinner className="border-primary-foreground/60 border-t-transparent" />
                    Crear cuenta
                  </span>
                </div>
              </m.div>
            ) : null}

            {step === 2 ? (
              <CardShell
                key="officers-one"
                icon={UsersIcon}
                title="Oficiales de cumplimiento"
                badge={
                  <Badge variant="muted" className="ml-auto shrink-0 text-[8px]">
                    1
                  </Badge>
                }
              >
                <p className="flex items-center gap-1.5 rounded border border-success/25 bg-success/10 px-2 py-1 text-[10px] font-medium text-success">
                  <CheckCircle2Icon className="h-3 w-3 shrink-0" />
                  Cuenta de oficial creada.
                </p>
                <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 text-[10px]">
                  <span>Nora Officer</span>
                  <span className="text-muted-foreground">oficial@empresa.test</span>
                  <span className="ml-auto text-[9px] tabular-nums text-muted-foreground">
                    desde 23 ago 2026
                  </span>
                </p>
              </CardShell>
            ) : null}

            {step === 3 ? (
              <CardShell key="privilege" icon={BotIcon} title="Privilegios del asistente">
                <p className="text-[9px] leading-relaxed text-muted-foreground">
                  Qué puede hacer el asistente del proveedor bajo esta política. En cualquier nivel,
                  nada cambia sin la aprobación de esta consola.
                </p>
                <ul className="mt-1.5 space-y-1.5">
                  <li className="flex items-start gap-1.5">
                    <Radio on={false} />
                    <span className="min-w-0">
                      <span className="block text-[10px]">Conversacional — solo explica</span>
                      <span className="block text-[9px] leading-relaxed text-muted-foreground">
                        El asistente solo explica el expediente del proveedor. Es el comportamiento
                        de siempre.
                      </span>
                    </span>
                  </li>
                  <li className="flex items-start gap-1.5 rounded bg-agent/5 p-1">
                    <Radio on />
                    <span className="min-w-0">
                      <span className="block text-[10px] font-medium">
                        Delegado — puede proponer directivas
                      </span>
                      <span className="block text-[9px] leading-relaxed text-muted-foreground">
                        El asistente puede PROPONER cambios de directivas (documentos, campos,
                        validaciones, aprobación automática).
                      </span>
                    </span>
                  </li>
                </ul>
              </CardShell>
            ) : null}

            {step === 4 || step === 5 ? (
              <CardShell
                key="documents"
                icon={ShieldCheckIcon}
                title="Documentos aceptados"
                badge={
                  <Badge variant="muted" className="ml-auto shrink-0 text-[8px]">
                    4
                  </Badge>
                }
              >
                <p className="text-[9px] leading-relaxed text-muted-foreground">
                  Solo los tipos marcados pueden subirse. Para cada uno puede elegir qué campos se
                  extraen y qué validaciones cuentan.
                </p>
                <div className="mt-1.5 rounded border border-border bg-card">
                  <div className="flex items-center gap-1.5 px-1.5 py-1">
                    <Checkbox on />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[10px]">
                        Certificado de seguro (ACORD 25)
                      </span>
                      <span className="block truncate text-[9px] text-muted-foreground">
                        Acredita: Seguro de responsabilidad civil general
                      </span>
                    </span>
                    <Badge variant="muted" className="shrink-0 tabular-nums text-[8px]">
                      {endorsementOn ? "5/7 checks" : "4/7 checks"}
                    </Badge>
                    <span className="hidden shrink-0 items-center gap-0.5 text-[9px] text-muted-foreground sm:flex">
                      <ChevronDownIcon className="h-3 w-3" />
                      Configurar
                    </span>
                  </div>
                  <div className="grid gap-2 border-t border-border px-1.5 py-1.5 sm:grid-cols-2">
                    <div className="min-w-0">
                      <p className="text-[8px] font-medium uppercase tracking-wide text-muted-foreground">
                        Campos a extraer
                      </p>
                      <ul className="mt-0.5 space-y-0.5">
                        {ACORD_FIELDS.map((f) => (
                          <li key={f.name} className="flex items-center gap-1 text-[9px]">
                            <Checkbox on locked={f.locked} />
                            <span className="truncate font-mono">{f.name}</span>
                            {f.locked ? (
                              <span className="ml-auto flex shrink-0 items-center gap-0.5 whitespace-nowrap text-muted-foreground">
                                <LockIcon className="h-2.5 w-2.5" />
                                obligatorio
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[8px] font-medium uppercase tracking-wide text-muted-foreground">
                        Validaciones que cuentan
                      </p>
                      <ul className="mt-0.5 space-y-0.5">
                        {ACORD_VALIDATORS.map((v) => {
                          const on =
                            v.label === "Endosos requeridos presentes" ? endorsementOn : v.on;
                          return (
                            <li
                              key={v.label}
                              className={cn(
                                "flex items-center gap-1 text-[9px] transition-colors duration-200",
                                on ? "text-foreground" : "text-muted-foreground",
                              )}
                            >
                              <Checkbox on={on} />
                              <span className="truncate">{v.label}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                </div>
              </CardShell>
            ) : null}

            {step === 6 ? (
              <CardShell key="referee" icon={UserCheckIcon} title="Aprobación automática">
                <p className="text-[9px] leading-relaxed text-muted-foreground">
                  Marcada, el sistema aprueba la categoría por su cuenta cuando la documentación la
                  respalda.
                </p>
                <ul className="mt-1.5 space-y-1">
                  {[
                    ["Seguro de responsabilidad civil general", true, false],
                    ["Licencia comercial", true, false],
                    ["Identidad fiscal", false, true],
                  ].map(([label, on, mandatory]) => (
                    <li key={label as string} className="flex items-start gap-1.5">
                      <Checkbox on={on as boolean} />
                      <span className="min-w-0">
                        <span className="block truncate text-[10px]">{label as string}</span>
                        <span
                          className={cn(
                            "block text-[9px]",
                            on ? "text-muted-foreground" : "text-warning",
                          )}
                        >
                          {on ? "El sistema decide" : "Un oficial debe aprobarla"}
                          {mandatory ? " · requisito obligatorio" : ""}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardShell>
            ) : null}

            {settled ? (
              <m.div
                key="gate"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5, transition: { duration: 0.1 } }}
                transition={{ duration: 0.2 }}
                className="space-y-2"
              >
                <div className="rounded-md border border-success/25 bg-success/5 p-2.5">
                  {/* Admissible-with-warnings keeps the success border and
                      check in the real gate card — warnings never block. */}
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-success">
                    <CheckIcon className="h-3.5 w-3.5 shrink-0" />
                    Advertencias de esta configuración
                  </p>
                  <m.p
                    initial={{ opacity: 0, x: -5 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.14, duration: 0.22 }}
                    className="mt-1.5 flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground"
                  >
                    <AlertTriangleIcon className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                    Identidad fiscal es obligatorio y requerirá la decisión de un oficial en cada
                    proveedor.
                  </m.p>
                  <m.p
                    initial={{ opacity: 0, x: -5 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.28, duration: 0.22 }}
                    className="mt-1 flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground"
                  >
                    <AlertTriangleIcon className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                    Certificado de seguro (ACORD 25) ejecuta 5 de 7 validaciones disponibles.
                  </m.p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 py-1.5">
                  <span className="rounded-md border border-input bg-card px-2 py-1 text-[10px] font-medium">
                    Validar
                  </span>
                  <span className="rounded-md border border-input bg-card px-2 py-1 text-[10px] font-medium">
                    Guardar borrador
                  </span>
                  <span className="rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground">
                    Activar política…
                  </span>
                  <span className="ml-auto text-[9px] text-muted-foreground">
                    Borrador v4 sin activar
                  </span>
                </div>
              </m.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </MockFrame>
  );
}
