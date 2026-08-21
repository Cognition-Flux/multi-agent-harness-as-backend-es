/**
 * The requirement-profile presets a new company starts from (SPEC §19.5).
 *
 * These were inline in `seed-demo.ts`; provisioning a company needs the same
 * values, and two copies of a compliance profile is exactly the kind of drift
 * that produces a company whose vendors are judged by rules nobody chose. One
 * definition, used by the seed and by the superadmin console.
 *
 * Threshold keys are snake_case because that is what `toThresholds` reads off
 * the jsonb column.
 */
import { RequirementCategory } from "@vendra/workflow/vendor";

export interface RequirementPreset {
  /** Stable id used by the API and the console. */
  id: string;
  /** Row name, and the label the console shows. */
  name: string;
  description: string;
  required: string[];
  mandatory: string[];
  dismissible: string[];
  maxManualDismissable: number;
  thresholds: Record<string, number | boolean>;
}

export const REQUIREMENT_PRESETS: RequirementPreset[] = [
  {
    id: "construction-sub",
    name: "construction-sub",
    description:
      "Subcontratista de construcción: seguros completos, licencia, historial de seguridad y acuerdos firmados.",
    required: [
      RequirementCategory.TAX_IDENTITY,
      RequirementCategory.INSURANCE_GENERAL_LIABILITY,
      RequirementCategory.INSURANCE_WORKERS_COMP,
      RequirementCategory.INSURANCE_AUTO,
      RequirementCategory.BUSINESS_LICENSE,
      RequirementCategory.SAFETY_RECORD,
      RequirementCategory.BANKING_VERIFICATION,
      RequirementCategory.SIGNED_AGREEMENTS,
      RequirementCategory.DIVERSITY_CERTIFICATION,
    ],
    mandatory: [
      RequirementCategory.TAX_IDENTITY,
      RequirementCategory.INSURANCE_GENERAL_LIABILITY,
    ],
    dismissible: [
      RequirementCategory.DIVERSITY_CERTIFICATION,
      RequirementCategory.INSURANCE_AUTO,
      RequirementCategory.INSURANCE_WORKERS_COMP,
      RequirementCategory.SAFETY_RECORD,
    ],
    maxManualDismissable: 2,
    thresholds: {
      gl_occurrence_usd: 1_000_000,
      gl_aggregate_usd: 2_000_000,
      auto_limit_usd: 1_000_000,
      wc_limit_usd: 500_000,
      emr_max: 1.0,
      soc2_max_age_months: 12,
      require_additional_insured: true,
    },
  },
  {
    id: "general-supplier",
    name: "general-supplier",
    description:
      "Proveedor general: identidad fiscal, datos bancarios, acuerdos y seguridad de datos.",
    required: [
      RequirementCategory.TAX_IDENTITY,
      RequirementCategory.BANKING_VERIFICATION,
      RequirementCategory.SIGNED_AGREEMENTS,
      RequirementCategory.INSURANCE_GENERAL_LIABILITY,
      RequirementCategory.DATA_SECURITY,
    ],
    mandatory: [RequirementCategory.TAX_IDENTITY],
    dismissible: [RequirementCategory.DATA_SECURITY],
    maxManualDismissable: 1,
    thresholds: {
      gl_occurrence_usd: 1_000_000,
      gl_aggregate_usd: 2_000_000,
      require_additional_insured: false,
    },
  },
];

export function findPreset(id: string): RequirementPreset | null {
  return REQUIREMENT_PRESETS.find((preset) => preset.id === id) ?? null;
}
