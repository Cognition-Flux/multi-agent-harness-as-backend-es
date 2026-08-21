"use client";

/**
 * The company configuration console (SPEC §19.5) — where a superadmin chooses
 * what a company accepts, how it is checked, and what the system may approve on
 * its own.
 *
 * Four UX decisions worth stating, because each one prevents a specific
 * mistake:
 *
 *  1. The referee direction is spelled out in words, not implied by a checkbox.
 *     A checked category means "the system decides"; unchecked means "an officer
 *     must approve every time". The implementation had this backwards once, and
 *     an operator reading only the label would make the same error.
 *  2. Structural fields render as LOCKED with the reason, rather than being
 *     hidden. Hiding them would make the field list look arbitrary; locking them
 *     teaches which fields the platform itself depends on.
 *  3. Nothing activates without the gate. "Validar" runs the same admissibility
 *     policy the server enforces, so the operator sees every violation before
 *     committing rather than one error at a time.
 *  4. Activation goes through a confirmation that states the consequences and
 *     asks the re-pin question there. The action bar floats over a long list of
 *     checkboxes, so a stray click lands on it — and "activate a policy" must
 *     never be one stray click. Browser-testing this page hit exactly that.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LockIcon,
  PlusIcon,
  ShieldCheckIcon,
  UserCheckIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Loader,
  Shimmer,
} from "@/components/ui/primitives";
import { useTRPC } from "@/lib/trpc-client";
import { cn, formatDate } from "@/lib/utils";

import { ActivateDialog, AddOfficerDialog } from "./dialogs";

interface DraftDocument {
  documentType: string;
  extractFields: string[];
  validators: string[];
}

interface WorkingPolicy {
  refereeable: string[];
  documents: DraftDocument[];
}

/** The wire shape for a draft save — identical for save, check and activate. */
function toPayload(working: WorkingPolicy) {
  return {
    refereeableCategories: working.refereeable,
    documents: working.documents.map((d) => ({
      documentType: d.documentType,
      extractFields: d.extractFields,
      validators: d.validators,
    })),
  };
}

interface AdmissionFinding {
  rule: string;
  detail: string;
}

interface FindingVocabulary {
  documentTitle: (type: string) => string | undefined;
  categoryLabel: (category: string) => string | undefined;
  validatorLabel: (id: string) => string | undefined;
}

/**
 * Render one admission finding in the operator's language.
 *
 * `detail` comes from `policy/company-policy.rego` and is deliberately English
 * and enum-precise — it is the audit text, and the Rego tests assert on it. So
 * the console translates rather than asking the policy to speak Spanish.
 *
 * Only the rules a console user can actually trigger are translated; the rest
 * (unknown document type / field / category, inapplicable validator) can only
 * fire for a hand-built API call, and fall through to the raw detail rather
 * than to a guess. Subjects are recovered by KIND, not by position, so a
 * reworded sprintf format degrades to English instead of mislabelling.
 */
function describeFinding(
  finding: AdmissionFinding,
  vocab: FindingVocabulary,
): string {
  const tokens = finding.detail.match(/[A-Za-z_][A-Za-z0-9_.]*/g) ?? [];
  const documentType = tokens.find((t) => vocab.documentTitle(t) !== undefined);
  const category = tokens.find((t) => vocab.categoryLabel(t) !== undefined);
  const validator = tokens.find((t) => vocab.validatorLabel(t) !== undefined);
  const dotted = tokens.find((t) => t.includes("."));
  const field = dotted?.split(".").slice(1).join(".");
  // Strip the identifiers first: several document types carry digits of their
  // own (SOC2_REPORT, ISO_27001_CERT, ACORD_25_COI).
  const numbers = (
    tokens
      .reduce((text, token) => text.split(token).join(" "), finding.detail)
      .match(/\d+/g) ?? []
  ).map(Number);

  const doc = documentType ? vocab.documentTitle(documentType) : undefined;
  const cat = category ? vocab.categoryLabel(category) : undefined;
  const check = validator ? vocab.validatorLabel(validator) : undefined;

  switch (finding.rule) {
    case "no_documents_accepted":
      return "Una política que no acepta ningún documento nunca podría aprobar a un proveedor.";
    case "document_without_validators":
      return `${doc ?? "Un tipo aceptado"} no tiene validaciones: cualquier documento de ese tipo pasaría sin revisión.`;
    case "threshold_makes_validator_unsatisfiable":
      return `${doc ?? "Un tipo aceptado"} usa «${check ?? "una validación"}», pero su umbral es ${numbers[0] ?? 0}: todo documento de ese tipo fallaría.`;
    case "structural_field_deselected":
      return `El campo ${field ?? "estructural"} de ${doc ?? "ese documento"} alimenta un cálculo de la plataforma y no puede desactivarse.`;
    case "required_category_ungrantable":
      // "requisito", not "obligatorio": this console already uses "requisito
      // obligatorio" for the MANDATORY subset, and the rule fires for anything
      // merely REQUIRED — saying "es obligatorio" claims something stronger
      // than the policy checked.
      return `${cat ?? "Un requisito"} es un requisito de esta empresa, pero ningún documento aceptado puede acreditarlo.`;
    case "refereeable_not_required":
      return `${cat ?? "Ese requisito"} está marcado para aprobación automática, pero ningún perfil lo exige: la marca no tiene efecto.`;
    case "mandatory_category_referred":
      return `${cat ?? "Un requisito obligatorio"} es obligatorio y requerirá la decisión de un oficial en cada proveedor.`;
    case "validators_reduced":
      return `${doc ?? "Un tipo aceptado"} ejecuta ${numbers[0] ?? 0} de ${numbers[1] ?? 0} validaciones disponibles.`;
    default:
      return finding.detail;
  }
}

export function PolicyBuilder({ uuid }: { uuid: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const companyQuery = useQuery(trpc.platform.getCompany.queryOptions({ uuid }));
  const catalogQuery = useQuery(trpc.platform.catalog.queryOptions());

  const [draft, setDraft] = useState<WorkingPolicy | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<{
    admissible: boolean;
    violations: AdmissionFinding[];
    warnings: AdmissionFinding[];
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [addingOfficer, setAddingOfficer] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const company = companyQuery.data;
  const catalog = catalogQuery.data;

  // The working copy starts from the draft when one exists, otherwise from the
  // active version — never from an empty form, which would look like "this
  // company accepts nothing".
  const baseline = company?.draft ?? company?.active ?? null;
  const working: WorkingPolicy =
    draft ??
    (baseline
      ? {
          refereeable: [...baseline.refereeableCategories],
          documents: baseline.documents.map((d) => ({
            documentType: d.documentType,
            extractFields: [...d.extractFields],
            validators: [...d.validators],
          })),
        }
      : { refereeable: [], documents: [] });

  const requiredCategories = useMemo(
    () =>
      [...new Set((company?.profiles ?? []).flatMap((p) => p.required))].sort(),
    [company],
  );
  const mandatoryCategories = useMemo(
    () => new Set((company?.profiles ?? []).flatMap((p) => p.mandatory)),
    [company],
  );

  const mutate = (next: WorkingPolicy) => {
    setDraft(next);
    setCheckResult(null);
    setBanner(null);
    setFailure(null);
  };

  const acceptedTypes = new Set(working.documents.map((d) => d.documentType));

  const toggleType = (type: string) => {
    const entry = catalog?.documentTypes.find((t) => t.type === type);
    if (!entry) return;
    if (acceptedTypes.has(type)) {
      mutate({
        ...working,
        documents: working.documents.filter((d) => d.documentType !== type),
      });
    } else {
      // A newly accepted type starts with everything on — the permissive
      // default is also the behaviour-preserving one.
      mutate({
        ...working,
        documents: [
          ...working.documents,
          {
            documentType: type,
            extractFields: [...entry.fields],
            validators: [...entry.validators],
          },
        ],
      });
      setExpanded(type);
    }
  };

  const updateDoc = (type: string, patch: Partial<DraftDocument>) =>
    mutate({
      ...working,
      documents: working.documents.map((d) =>
        d.documentType === type ? { ...d, ...patch } : d,
      ),
    });

  const invalidate = () => {
    void queryClient.invalidateQueries(trpc.platform.getCompany.pathFilter());
    void queryClient.invalidateQueries(trpc.platform.listCompanies.pathFilter());
  };

  const check = useMutation(
    trpc.platform.checkPolicyDraft.mutationOptions({
      onSuccess: (data) => {
        setCheckResult(data);
        setFailure(null);
      },
      onError: (err) => setFailure(err.message),
    }),
  );
  const save = useMutation(
    trpc.platform.savePolicyDraft.mutationOptions({
      onSuccess: () => {
        setDraft(null);
        setBanner("Borrador guardado. La empresa sigue con la política activa.");
        invalidate();
      },
      onError: (err) => setFailure(err.message),
    }),
  );
  const activate = useMutation(
    trpc.platform.activatePolicy.mutationOptions({
      onSuccess: (data) => {
        setDraft(null);
        setConfirming(false);
        setFailure(null);
        // The gate's warnings are the consequences of what was just activated —
        // "this mandatory requirement now needs an officer every time". Clearing
        // the result here would swallow them at the one moment they matter.
        setCheckResult(
          data.warnings.length > 0
            ? { admissible: true, violations: [], warnings: data.warnings }
            : null,
        );
        setBanner(
          `Política v${data.version} activada${
            data.repinnedVendors > 0
              ? ` y aplicada a ${data.repinnedVendors} proveedor(es) existente(s)`
              : ". Rige para proveedores nuevos"
          }.`,
        );
        invalidate();
      },
      onError: (err) => {
        setConfirming(false);
        setBanner(null);
        // The gate's refusal arrives as a JSON array of findings — render it as
        // violations. Anything else is a plain message.
        try {
          const parsed: unknown = JSON.parse(err.message);
          if (Array.isArray(parsed)) {
            setCheckResult({
              admissible: false,
              violations: parsed as AdmissionFinding[],
              warnings: [],
            });
            return;
          }
        } catch {
          /* not a findings payload */
        }
        setFailure(err.message);
      },
    }),
  );
  const discard = useMutation(
    trpc.platform.discardPolicyDraft.mutationOptions({
      onSuccess: () => {
        setDraft(null);
        setCheckResult(null);
        setFailure(null);
        setBanner("Borrador descartado.");
        invalidate();
      },
      onError: (err) => setFailure(err.message),
    }),
  );

  if (companyQuery.isPending || catalogQuery.isPending) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 sm:px-6">
        <Shimmer className="h-8 w-64" />
        <Shimmer className="h-40 w-full" />
      </main>
    );
  }
  if (companyQuery.isError || !company || !catalog) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No se pudo cargar esta empresa.{" "}
            <Link href="/platform" className="underline">
              Volver
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  const dirty = draft !== null;
  const manualCategories = requiredCategories.filter(
    (category) => !working.refereeable.includes(category),
  );
  const categoryLabel = (category: string) =>
    catalog.categories.find((c) => c.category === category)?.label ?? category;
  const vocabulary: FindingVocabulary = {
    documentTitle: (type) =>
      catalog.documentTypes.find((t) => t.type === type)?.title,
    categoryLabel: (category) =>
      catalog.categories.find((c) => c.category === category)?.label,
    validatorLabel: (id) => catalog.validators.find((v) => v.id === id)?.label,
  };

  /** Save-then-activate: activation reads the draft from the database, so
   *  activating an unsaved form would silently publish the PREVIOUS draft. */
  const handleActivate = async (applyToExistingVendors: boolean) => {
    if (dirty) {
      try {
        await save.mutateAsync({ uuid, ...toPayload(working) });
      } catch {
        setConfirming(false);
        return; // save.onError already reported it
      }
    }
    activate.mutate({ uuid, applyToExistingVendors });
  };

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <Link
          href="/platform"
          className="w-fit text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          ← Empresas
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
          <Badge variant="muted">{company.slug}</Badge>
          {company.active ? (
            <Badge variant="secondary">
              Política v{company.active.version} activa
            </Badge>
          ) : (
            <Badge variant="destructive">Sin política activa</Badge>
          )}
          {company.draft ? <Badge variant="warning">Borrador guardado</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {company.vendorCount} proveedor(es) ·{" "}
          {company.active?.activatedAt
            ? `activada el ${formatDate(company.active.activatedAt)}`
            : "nunca activada"}{" "}
          · {working.documents.length} tipo(s) de documento ·{" "}
          {working.refereeable.length} de {requiredCategories.length} requisito(s)
          con aprobación automática
        </p>
      </header>

      {banner ? (
        <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/5 p-3 text-sm">
          <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <span>{banner}</span>
        </div>
      ) : null}
      {failure ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>{failure}</span>
        </div>
      ) : null}

      {/* ── Automatic approval ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCheckIcon className="h-4 w-4" />
            Aprobación automática
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="max-w-prose text-sm text-muted-foreground">
            Marcada, el sistema aprueba la categoría por su cuenta cuando la
            documentación la respalda. <strong>Sin marcar</strong>, el sistema
            deja de aprobarla y un oficial de cumplimiento debe revisarla
            manualmente en cada proveedor.
          </p>
          {requiredCategories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Esta empresa no tiene requisitos configurados.
            </p>
          ) : (
            <>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {requiredCategories.map((category) => {
                  const on = working.refereeable.includes(category);
                  return (
                    <li key={category}>
                      <label className="flex items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/40">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          id={`ref-${category}`}
                          checked={on}
                          onChange={(e) =>
                            mutate({
                              ...working,
                              refereeable: e.target.checked
                                ? [...working.refereeable, category]
                                : working.refereeable.filter((c) => c !== category),
                            })
                          }
                        />
                        <span className="min-w-0">
                          <span className="block truncate">
                            {categoryLabel(category)}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {on ? (
                              "El sistema decide"
                            ) : (
                              <span className="text-warning">
                                Un oficial debe aprobarla
                              </span>
                            )}
                            {mandatoryCategories.has(category)
                              ? " · requisito obligatorio"
                              : ""}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {manualCategories.length === requiredCategories.length ? (
                <p className="text-xs text-warning">
                  Ningún requisito se aprobará automáticamente: cada proveedor
                  necesitará que un oficial apruebe los{" "}
                  {requiredCategories.length} requisitos a mano.
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Documents ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="h-4 w-4" />
            Documentos aceptados
            <Badge variant="muted">{working.documents.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <p className="mb-2 max-w-prose text-sm text-muted-foreground">
            Solo los tipos marcados pueden subirse. Para cada uno puede elegir
            qué campos se extraen y qué validaciones cuentan.
          </p>
          {catalog.documentTypes.map((type) => {
            const accepted = acceptedTypes.has(type.type);
            const doc = working.documents.find((d) => d.documentType === type.type);
            const isOpen = expanded === type.type;
            return (
              <div
                key={type.type}
                className={cn(
                  "rounded-md border transition-colors",
                  accepted ? "border-border bg-card" : "border-transparent",
                )}
              >
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <input
                    type="checkbox"
                    id={`type-${type.type}`}
                    checked={accepted}
                    onChange={() => toggleType(type.type)}
                  />
                  <label
                    htmlFor={`type-${type.type}`}
                    className="min-w-0 flex-1 cursor-pointer text-sm"
                  >
                    <span className="block truncate">{type.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {type.grants.length > 0
                        ? `Acredita: ${type.grants.map(categoryLabel).join(", ")}`
                        : "No acredita requisitos por sí solo"}
                    </span>
                  </label>
                  {accepted ? (
                    <>
                      <Badge variant="muted">
                        {doc?.validators.length ?? 0}/{type.validators.length} checks
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setExpanded(isOpen ? null : type.type)}
                        aria-expanded={isOpen}
                      >
                        {isOpen ? (
                          <ChevronDownIcon className="h-4 w-4" />
                        ) : (
                          <ChevronRightIcon className="h-4 w-4" />
                        )}
                        Configurar
                      </Button>
                    </>
                  ) : null}
                </div>

                {accepted && isOpen && doc ? (
                  <div className="grid gap-4 border-t border-border px-3 py-3 sm:grid-cols-2">
                    <div>
                      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Campos a extraer
                      </p>
                      <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto pr-1">
                        {type.fields.map((field) => {
                          const locked = type.structuralFields.includes(field);
                          const on = locked || doc.extractFields.includes(field);
                          return (
                            <li key={field}>
                              <label
                                className={cn(
                                  "flex items-center gap-2 rounded px-1 py-0.5 text-xs",
                                  locked
                                    ? "text-muted-foreground"
                                    : "hover:bg-muted/40",
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={on}
                                  disabled={locked}
                                  onChange={(e) =>
                                    updateDoc(type.type, {
                                      extractFields: e.target.checked
                                        ? [...doc.extractFields, field]
                                        : doc.extractFields.filter((f) => f !== field),
                                    })
                                  }
                                />
                                <span className="truncate font-mono">{field}</span>
                                {locked ? (
                                  <span
                                    className="flex items-center gap-1 whitespace-nowrap"
                                    title="La plataforma lee este campo para calcular vencimientos, identidad o cobertura."
                                  >
                                    <LockIcon className="h-3 w-3" />
                                    obligatorio
                                  </span>
                                ) : null}
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Validaciones que cuentan
                      </p>
                      <ul className="flex flex-col gap-0.5">
                        {type.validators.map((validator) => {
                          const on = doc.validators.includes(validator);
                          const label =
                            catalog.validators.find((v) => v.id === validator)?.label ??
                            validator;
                          return (
                            <li key={validator}>
                              <label className="flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted/40">
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={(e) =>
                                    updateDoc(type.type, {
                                      validators: e.target.checked
                                        ? [...doc.validators, validator]
                                        : doc.validators.filter((v) => v !== validator),
                                    })
                                  }
                                />
                                <span className="truncate">{label}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                      {doc.validators.length === 0 ? (
                        <p className="mt-1.5 text-xs text-destructive">
                          Sin validaciones, cualquier documento de este tipo
                          pasaría sin revisión. No se puede activar así.
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ── Company accounts ───────────────────────────────────────────── */}
      <Card className={company.officers.length === 0 ? "border-warning/40" : undefined}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UsersIcon className="h-4 w-4" />
            Oficiales de cumplimiento
            <Badge variant={company.officers.length === 0 ? "warning" : "muted"}>
              {company.officers.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {company.officers.length === 0 ? (
            <p className="text-sm text-warning">
              Nadie de esta empresa puede revisar proveedores todavía. Cree al
              menos una cuenta de oficial.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {company.officers.map((officer) => (
                <li
                  key={officer.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/40 pb-1 last:border-b-0 last:pb-0"
                >
                  <span>
                    {officer.name}{" "}
                    <span className="text-muted-foreground">{officer.email}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    desde {formatDate(officer.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setAddingOfficer(true)}>
              <PlusIcon className="mr-1.5 h-4 w-4" />
              Añadir oficial
            </Button>
            <span className="text-xs text-muted-foreground">
              {company.vendorContactCount} cuenta(s) de proveedor
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── Gate result ────────────────────────────────────────────────── */}
      {checkResult ? (
        <Card
          className={
            checkResult.admissible ? "border-success/40" : "border-destructive/40"
          }
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {checkResult.admissible ? (
                <>
                  <CheckIcon className="h-4 w-4 text-success" />
                  {checkResult.warnings.length > 0
                    ? "Advertencias de esta configuración"
                    : "La configuración es válida"}
                </>
              ) : (
                <>
                  <AlertTriangleIcon className="h-4 w-4 text-destructive" />
                  No se puede activar todavía
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {checkResult.violations.map((v) => (
              <p key={`${v.rule}-${v.detail}`} className="text-destructive">
                {describeFinding(v, vocabulary)}
              </p>
            ))}
            {checkResult.warnings.map((w) => (
              <p key={`${w.rule}-${w.detail}`} className="text-warning">
                {describeFinding(w, vocabulary)}
              </p>
            ))}
            {checkResult.admissible && checkResult.warnings.length === 0 ? (
              <p className="text-muted-foreground">Sin advertencias.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {company.versions.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Historial</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {[...company.versions].reverse().map((v) => (
                <li key={v.version} className="flex items-center gap-2">
                  <Badge
                    variant={
                      v.status === "ACTIVE"
                        ? "success"
                        : v.status === "DRAFT"
                          ? "warning"
                          : "muted"
                    }
                  >
                    v{v.version}
                  </Badge>
                  <span className="text-muted-foreground">
                    {v.status === "ACTIVE"
                      ? `activa desde ${v.activatedAt ? formatDate(v.activatedAt) : "—"}`
                      : v.status === "DRAFT"
                        ? "borrador"
                        : `archivada${v.activatedAt ? ` (activada el ${formatDate(v.activatedAt)})` : ""}`}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Actions ────────────────────────────────────────────────────────
          Sticky so it stays reachable down a long list. It therefore floats
          over the checkboxes above it, which is exactly why activation is
          behind a confirmation instead of being one click. */}
      <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/95 p-3 shadow-lift backdrop-blur">
        <Button
          variant="outline"
          disabled={check.isPending}
          onClick={() => check.mutate({ uuid, ...toPayload(working) })}
        >
          {check.isPending ? <Loader className="mr-1.5 h-4 w-4" /> : null}
          Validar
        </Button>
        <Button
          variant="secondary"
          disabled={save.isPending || !dirty}
          onClick={() => save.mutate({ uuid, ...toPayload(working) })}
        >
          {save.isPending ? <Loader className="mr-1.5 h-4 w-4" /> : null}
          Guardar borrador
        </Button>
        <Button
          disabled={activate.isPending || (!company.draft && !dirty)}
          onClick={() => setConfirming(true)}
        >
          {activate.isPending ? <Loader className="mr-1.5 h-4 w-4" /> : null}
          Activar política…
        </Button>
        {company.draft ? (
          <Button
            variant="ghost"
            disabled={discard.isPending}
            onClick={() => discard.mutate({ uuid })}
          >
            Descartar borrador
          </Button>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">
          {dirty
            ? "Cambios sin guardar"
            : company.draft
              ? `Borrador v${company.draft.version} sin activar`
              : "Sin cambios pendientes"}
        </span>
      </div>

      {addingOfficer ? (
        <AddOfficerDialog
          uuid={uuid}
          onClose={() => setAddingOfficer(false)}
          onCreated={() => {
            setAddingOfficer(false);
            setBanner("Cuenta de oficial creada.");
            invalidate();
          }}
        />
      ) : null}

      {confirming ? (
        <ActivateDialog
          companyName={company.name}
          vendorCount={company.vendorCount}
          nextVersion={company.draft?.version ?? (company.active?.version ?? 0) + 1}
          acceptedCount={working.documents.length}
          automaticCategories={working.refereeable.map(categoryLabel)}
          manualCategories={manualCategories.map(categoryLabel)}
          pending={activate.isPending || save.isPending}
          onClose={() => setConfirming(false)}
          onConfirm={(repin) => void handleActivate(repin)}
        />
      ) : null}
    </main>
  );
}
