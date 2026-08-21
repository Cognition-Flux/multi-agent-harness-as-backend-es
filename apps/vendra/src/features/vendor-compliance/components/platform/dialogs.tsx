"use client";

/**
 * The platform-console dialogs (SPEC §19.5), split out the way the officer
 * surface splits `mutation-dialogs.tsx`: provisioning a company, activating a
 * policy version, and adding an officer to an existing company.
 *
 * Each one exists because its action is consequential enough to deserve a
 * deliberate step — creating a tenant, changing what a company's agents may
 * decide, or minting a login that can approve vendors.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  Button,
  Dialog,
  Input,
  Label,
  Loader,
} from "@/components/ui/primitives";
import { useTRPC } from "@/lib/trpc-client";

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-card px-2 text-sm shadow-sm transition-[border-color,box-shadow] focus-visible:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50";

/** Derive a URL-safe slug as the operator types the name. */
function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 49);
}

export function ProvisionCompanyDialog({ onClose }: { onClose: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const catalogQuery = useQuery(trpc.platform.catalog.queryOptions());

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [presetId, setPresetId] = useState("construction-sub");
  const [withOfficer, setWithOfficer] = useState(true);
  const [officerName, setOfficerName] = useState("");
  const [officerEmail, setOfficerEmail] = useState("");
  const [officerPassword, setOfficerPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const effectiveSlug = slugTouched ? slug : slugify(name);

  const provision = useMutation(
    trpc.platform.provisionCompany.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.platform.listCompanies.pathFilter());
        onClose();
      },
      onError: (err) => setError(err.message),
    }),
  );

  const slugValid = /^[a-z0-9][a-z0-9-]{1,48}$/.test(effectiveSlug);
  const officerValid =
    !withOfficer ||
    (officerName.trim().length >= 2 &&
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(officerEmail) &&
      officerPassword.length >= 8);
  const canSubmit = name.trim().length >= 2 && slugValid && officerValid;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Nueva empresa"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Se crea la empresa, su perfil de requisitos y una política inicial
          equivalente al comportamiento actual del sistema.
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-name">Nombre</Label>
          <Input
            id="company-name"
            value={name}
            autoFocus
            placeholder="Northwind Utilities LLC"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-slug">Identificador</Label>
          <Input
            id="company-slug"
            value={effectiveSlug}
            placeholder="northwind-utilities"
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Minúsculas, números y guiones. Se usa para identificar a la empresa
            internamente; no otorga acceso a nada.
          </p>
          {effectiveSlug && !slugValid ? (
            <p className="text-xs text-destructive">
              Entre 2 y 49 caracteres: minúsculas, números y guiones.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-preset">Perfil de requisitos inicial</Label>
          <select
            id="company-preset"
            className={SELECT_CLASS}
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
          >
            {(catalogQuery.data?.presets ?? []).map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name} — {preset.requiredCount} requisitos
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {catalogQuery.data?.presets.find((p) => p.id === presetId)?.description ??
              "Define qué requisitos debe cumplir un proveedor de esta empresa."}
          </p>
        </div>

        <div className="rounded-md border border-border p-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={withOfficer}
              onChange={(e) => setWithOfficer(e.target.checked)}
            />
            <span>
              Crear el primer oficial de cumplimiento
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Sin al menos un oficial, nadie de la empresa puede revisar
                proveedores.
              </span>
            </span>
          </label>

          {withOfficer ? (
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="officer-name">Nombre del oficial</Label>
                <Input
                  id="officer-name"
                  value={officerName}
                  placeholder="Nora Officer"
                  onChange={(e) => setOfficerName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="officer-email">Correo</Label>
                <Input
                  id="officer-email"
                  type="email"
                  value={officerEmail}
                  placeholder="oficial@empresa.test"
                  onChange={(e) => setOfficerEmail(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="officer-password">Contraseña temporal</Label>
                <Input
                  id="officer-password"
                  type="password"
                  value={officerPassword}
                  placeholder="Mínimo 8 caracteres"
                  onChange={(e) => setOfficerPassword(e.target.value)}
                />
                {officerPassword && officerPassword.length < 8 ? (
                  <p className="text-xs text-destructive">
                    Mínimo 8 caracteres.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={provision.isPending}>
            Cancelar
          </Button>
          <Button
            disabled={!canSubmit || provision.isPending}
            onClick={() => {
              setError(null);
              provision.mutate({
                name: name.trim(),
                slug: effectiveSlug,
                presetId,
                ...(withOfficer
                  ? {
                      officer: {
                        name: officerName.trim(),
                        email: officerEmail.trim(),
                        password: officerPassword,
                      },
                    }
                  : {}),
              });
            }}
          >
            {provision.isPending ? <Loader className="mr-1.5 h-4 w-4" /> : null}
            Crear empresa
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * The activation confirmation. States the consequences in the operator's terms
 * — who gets judged by this, what the system will decide alone, what lands on
 * an officer's desk — and asks the re-pin question here, at the moment it
 * matters, rather than as a checkbox that sits armed in the action bar.
 */
export function ActivateDialog({
  companyName,
  vendorCount,
  nextVersion,
  acceptedCount,
  automaticCategories,
  manualCategories,
  pending,
  onClose,
  onConfirm,
}: {
  companyName: string;
  vendorCount: number;
  nextVersion: number;
  acceptedCount: number;
  automaticCategories: string[];
  manualCategories: string[];
  pending: boolean;
  onClose: () => void;
  onConfirm: (applyToExistingVendors: boolean) => void;
}) {
  const [repin, setRepin] = useState(false);
  return (
    <Dialog open onClose={onClose} title={`Activar la política v${nextVersion}`}>
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-muted-foreground">
          {companyName} aceptará {acceptedCount} tipo(s) de documento.
        </p>
        <dl className="flex flex-col gap-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Aprueba el sistema ({automaticCategories.length})
            </dt>
            <dd>
              {automaticCategories.length > 0
                ? automaticCategories.join(", ")
                : "Nada — todo requisito pasará por un oficial."}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Requiere un oficial ({manualCategories.length})
            </dt>
            <dd>
              {manualCategories.length > 0
                ? manualCategories.join(", ")
                : "Ninguno."}
            </dd>
          </div>
        </dl>

        {vendorCount > 0 ? (
          <label className="flex items-start gap-2 rounded-md border border-border p-3">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={repin}
              onChange={(e) => setRepin(e.target.checked)}
            />
            <span>
              Aplicar también a los {vendorCount} proveedor(es) existentes
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Por defecto la política nueva rige solo para proveedores nuevos:
                a nadie se le cambian las reglas a mitad de su proceso.
              </span>
            </span>
          </label>
        ) : (
          <p className="text-xs text-muted-foreground">
            Esta empresa no tiene proveedores todavía, así que la política rige
            desde el primero que se registre.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={() => onConfirm(repin)} disabled={pending}>
            {pending ? <Loader className="mr-1.5 h-4 w-4" /> : null}
            Activar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Add a compliance officer to an existing company. Deliberately the same shape
 * as the provisioning dialog's officer block, because it is the same act.
 */
export function AddOfficerDialog({
  uuid,
  onClose,
  onCreated,
}: {
  uuid: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const trpc = useTRPC();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation(
    trpc.platform.createOfficer.mutationOptions({
      onSuccess: () => onCreated(),
      onError: (err) => setError(err.message),
    }),
  );

  const valid =
    name.trim().length >= 2 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) &&
    password.length >= 8;

  return (
    <Dialog open onClose={onClose} title="Añadir oficial de cumplimiento">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          La cuenta podrá revisar y aprobar a los proveedores de esta empresa —
          y de ninguna otra.
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-officer-name">Nombre</Label>
          <Input
            id="new-officer-name"
            value={name}
            autoFocus
            placeholder="Nora Officer"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-officer-email">Correo</Label>
          <Input
            id="new-officer-email"
            type="email"
            value={email}
            placeholder="oficial@empresa.test"
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-officer-password">Contraseña temporal</Label>
          <Input
            id="new-officer-password"
            type="password"
            value={password}
            placeholder="Mínimo 8 caracteres"
            onChange={(e) => setPassword(e.target.value)}
          />
          {password && password.length < 8 ? (
            <p className="text-xs text-destructive">Mínimo 8 caracteres.</p>
          ) : null}
        </div>
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button
            disabled={!valid || create.isPending}
            onClick={() => {
              setError(null);
              create.mutate({
                uuid,
                name: name.trim(),
                email: email.trim(),
                password,
              });
            }}
          >
            {create.isPending ? <Loader className="mr-1.5 h-4 w-4" /> : null}
            Crear cuenta
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
