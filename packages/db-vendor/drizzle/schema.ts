/**
 * The Vendra data model (SPEC §6.10) — the single schema source of truth.
 *
 * Migration protocol: edit THIS file, run `pnpm --filter @vendra/db-vendor
 * generate`, commit the generated trio (SQL + journal + snapshot) together.
 * Generated files under `drizzle/` are read-only artifacts — never hand-edit.
 *
 * Better-auth tables (user/session/account/verification) live in the same
 * database; application code never queries them directly — all auth CRUD
 * goes through the better-auth SDK.
 */
import {
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  index,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// =============================================================================
// Enums
// =============================================================================

export const uploadStatusEnum = pgEnum("vendor_upload_status", [
  "PENDING",
  "UPLOADING",
  "UPLOADED",
  "PROCESSING",
  "PROCESSED",
  "FAILED",
  "ERROR",
]);

export const complianceStatusEnum = pgEnum("vendor_compliance_status", [
  "NOT_STARTED",
  "IN_PROGRESS",
  "PRE_APPROVED",
  "NEED_REVIEW",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
]);

export const activityTypeEnum = pgEnum("vendor_activity_type", [
  "DOCUMENT_UPLOADED",
  "DOCUMENT_VERIFIED",
  "DOCUMENT_REJECTED",
  "DOCUMENT_WAIVED",
  "DOCUMENT_RECLASSIFIED",
  "DOCUMENT_DELETED",
  "MANUAL_REQUIREMENT_GRANTED",
  "MANUAL_REQUIREMENT_REVOKED",
  "RETRY_REQUESTED",
  "STATUS_CHANGED",
  "WAIVER_EXPIRED",
  "SWEEP_EXPIRED",
  "API_CHECK_RUN",
  "VENDOR_REGISTERED",
  "ACTIVATION_SUBMITTED",
  "POLICY_ACTIVATED",
  "REQUIREMENT_REFERRED",
  "REQUIREMENT_REFERRAL_RESOLVED",
]);

// =============================================================================
// Tenancy + profiles
// =============================================================================

export const organization = pgTable("organization", {
  id: serial("id").primaryKey(),
  uuid: uuid("uuid").defaultRandom().notNull().unique(),
  name: text("name").notNull(),
  /** Display/routing only — NEVER a permission input (spec §6.4). */
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const vendorRequirementProfile = pgTable("vendor_requirement_profile", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .references(() => organization.id)
    .notNull(),
  name: text("name").notNull(),
  /** RequirementCategory values. */
  required: text("required").array().notNull(),
  /** Never-dismissable core ⊆ required. */
  mandatory: text("mandatory").array().notNull().default(sql`'{}'::text[]`),
  dismissible: text("dismissible").array().notNull().default(sql`'{}'::text[]`),
  /** RequirementThresholds jsonb ({gl_occurrence_usd, emr_max, …}). */
  thresholds: jsonb("thresholds"),
  maxManualDismissable: integer("max_manual_dismissable").notNull().default(2),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// =============================================================================
// Governance: per-company document policy (SPEC §19)
// =============================================================================

/**
 * One activated policy VERSION per organization — COMPANY-scoped, not
 * profile-scoped, so a document type has exactly one rule set per company
 * (§19.3). An org may have several requirement profiles (vendor types); the
 * activation gate validates the policy against ALL of them.
 *
 * Versions are immutable:
 * activating a new one archives the previous, and a vendor pins the version it
 * is being judged under (`vendor.company_policy_id`) so activation never
 * retroactively re-judges an in-flight vendor.
 */
export const companyPolicy = pgTable(
  "company_policy",
  {
    id: serial("id").primaryKey(),
    uuid: uuid("uuid").defaultRandom().notNull().unique(),
    organizationId: integer("organization_id")
      .references(() => organization.id)
      .notNull(),
    version: integer("version").notNull(),
    /** "DRAFT" | "ACTIVE" | "ARCHIVED" — a TS union, not a pgEnum. */
    status: text("status").notNull().default("DRAFT"),
    /**
     * RequirementCategory values the AUTOMATED pipeline may keep settling
     * (§19.4). Anything outside this list is referred to an officer. Note the
     * direction: the pipeline has always decided everything, so the
     * behaviour-preserving default is EVERY required category — an empty list
     * means "refer everything", not "no autonomy yet".
     */
    refereeableCategories: text("refereeable_categories")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    activatedAt: timestamp("activated_at"),
    activatedByUserId: text("activated_by_user_id"),
  },
  (table) => [
    uniqueIndex("company_policy_org_version_uq").on(
      table.organizationId,
      table.version,
    ),
    // At most one ACTIVE policy per org — the partial-unique pattern already
    // used by manual_requirement_grant_active_uq.
    uniqueIndex("company_policy_active_uq")
      .on(table.organizationId)
      .where(sql`status = 'ACTIVE'`),
  ],
);

/**
 * The company's rule set for ONE document type (§19.3): which fields the agent
 * is asked to extract, and which validators' rules COUNT. Exactly one row per
 * (policy, document type) — the spec's "a single set of rules per document".
 */
export const companyPolicyDocument = pgTable(
  "company_policy_document",
  {
    id: serial("id").primaryKey(),
    companyPolicyId: integer("company_policy_id")
      .references(() => companyPolicy.id, { onDelete: "cascade" })
      .notNull(),
    /** A VendorDocumentType value; UNKNOWN is never selectable. */
    documentType: text("document_type").notNull(),
    /** Extraction field names; empty = every field in the type's schema. */
    extractFields: text("extract_fields")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** VendorValidatorId values whose rules count. Never empty (§19.5). */
    validators: text("validators")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (table) => [
    uniqueIndex("company_policy_document_uq").on(
      table.companyPolicyId,
      table.documentType,
    ),
  ],
);

// =============================================================================
// Vendors
// =============================================================================

export const vendor = pgTable("vendor", {
  id: serial("id").primaryKey(),
  uuid: uuid("uuid").defaultRandom().notNull().unique(),
  organizationId: integer("organization_id")
    .references(() => organization.id)
    .notNull(),
  legalName: text("legal_name").notNull(),
  dbaName: text("dba_name"),
  /** NEVER the full TIN — anywhere (spec §10). */
  tinLast4: varchar("tin_last4", { length: 4 }),
  entityType: text("entity_type"),
  naicsCode: text("naics_code"),
  contactEmail: text("contact_email"),
  /** {remoteOnly?, onSite?, states?: string[], foreignEntity?} → conditional dismissals. */
  workProfile: jsonb("work_profile"),
  /** Vendor-facing "Not applicable" toggles (RequirementCategory values). */
  dismissedCategories: text("dismissed_categories")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  complianceStatus: complianceStatusEnum("compliance_status")
    .notNull()
    .default("NOT_STARTED"),
  /**
   * coverage_determination + cross_document_requirements + audit arrays
   * (classification_overrides / manual_requirement_overrides / retry_events).
   */
  complianceStatusMetadata: jsonb("compliance_status_metadata"),
  requirementProfileId: integer("requirement_profile_id")
    .references(() => vendorRequirementProfile.id)
    .notNull(),
  /**
   * The governance policy version this vendor is judged under (§19.3). Pinned
   * exactly like requirementProfileId: activating a new version leaves
   * in-flight vendors on the version they started under. Nullable only for the
   * migration window; the backfill sets it for every existing row.
   */
  companyPolicyId: integer("company_policy_id").references(
    () => companyPolicy.id,
  ),
  signoffUserId: text("signoff_user_id"),
  signoffAt: timestamp("signoff_at"),
  /** Denormalized roster/sweep column, maintained by the recompute (§6.7). */
  nextExpiryAt: date("next_expiry_at"),
  registeredAt: timestamp("registered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// =============================================================================
// Documents + extractions
// =============================================================================

export const vendorDocument = pgTable(
  "vendor_document",
  {
    id: serial("id").primaryKey(),
    uuid: uuid("uuid").defaultRandom().notNull().unique(),
    vendorId: integer("vendor_id")
      .references(() => vendor.id)
      .notNull(),
    organizationId: integer("organization_id")
      .references(() => organization.id)
      .notNull(),
    /** CAS-transitioned (§6.1); terminal writes are compare-and-swap guarded. */
    uploadStatus: uploadStatusEnum("upload_status").notNull().default("PENDING"),
    fileKey: text("file_key").notNull(),
    /** {type, fileName, fileSizeBytes, batchId, fileId, failureReason, …} */
    fileMetadata: jsonb("file_metadata"),
    /** Resolved requirement-facing subtype, written at finalize. */
    uploadType: text("upload_type"),
    /** "vendor" in v1; "officer" RESERVED (officer uploads are a non-goal §4). */
    source: text("source").notNull().default("vendor"),
    /** The sweep's per-doc index, written at finalize (§6.8). */
    extractedExpirationDate: date("extracted_expiration_date"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("vendor_document_vendor_idx").on(table.vendorId)],
);

export const vendorDocumentExtraction = pgTable(
  "vendor_document_extraction",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
      .references(() => vendorDocument.id, { onDelete: "cascade" })
      .notNull(),
    /** Append-only — reclassify inserts version+1, never mutates (§8.3). */
    version: integer("version").notNull(),
    documentType: text("document_type").notNull(),
    documentSubtype: text("document_subtype"),
    classificationConfidence: real("classification_confidence"),
    classificationReasoning: text("classification_reasoning"),
    /** TIN pre-masked at persist time (§10 defense in depth). */
    extractedData: jsonb("extracted_data").notNull(),
    fieldConfidences: jsonb("field_confidences"),
    /**
     * The governance policy version that judged this extraction (SPEC §19.3).
     * `vendor.company_policy_id` can be repointed, so without this an officer
     * reading an old row cannot tell whether a validator is absent because the
     * document lacked it or because the then-active policy deselected it.
     * Nullable: rows written before the governance layer have no policy.
     */
    companyPolicyId: integer("company_policy_id").references(
      () => companyPolicy.id,
    ),
    /** ValidationRule[] */
    validationRules: jsonb("validation_rules"),
    validationValid: boolean("validation_valid"),
    requirementsGranted: text("requirements_granted")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Coverage-scoped categories on a FAILED doc ("Counted · coverage"). */
    scopedCategories: text("scoped_categories")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** {active, note, scopedCategories, expiresAt, actorUserId, at} */
    waiver: jsonb("waiver"),
    model: text("model"),
    source: text("source").notNull().default("harness"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("vendor_document_extraction_doc_version_uq").on(
      table.documentId,
      table.version,
    ),
  ],
);

export const manualRequirementGrant = pgTable(
  "manual_requirement_grant",
  {
    id: serial("id").primaryKey(),
    uuid: uuid("uuid").defaultRandom().notNull().unique(),
    documentId: integer("document_id")
      .references(() => vendorDocument.id, { onDelete: "cascade" })
      .notNull(),
    category: text("category").notNull(),
    justification: text("justification").notNull(),
    grantedByUserId: text("granted_by_user_id").notNull(),
    grantedAt: timestamp("granted_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
    revokedByUserId: text("revoked_by_user_id"),
    revokeJustification: text("revoke_justification"),
  },
  (table) => [
    // One ACTIVE grant per (document, category), enforced by the partial index.
    uniqueIndex("manual_requirement_grant_active_uq")
      .on(table.documentId, table.category)
      .where(sql`revoked_at IS NULL`),
  ],
);

// =============================================================================
// Activity / tags / transitions
// =============================================================================

export const vendorActivity = pgTable(
  "vendor_activity",
  {
    id: serial("id").primaryKey(),
    vendorId: integer("vendor_id")
      .references(() => vendor.id)
      .notNull(),
    organizationId: integer("organization_id")
      .references(() => organization.id)
      .notNull(),
    type: activityTypeEnum("type").notNull(),
    actorUserId: text("actor_user_id"),
    documentId: integer("document_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("vendor_activity_vendor_idx").on(table.vendorId)],
);

export const vendorTag = pgTable(
  "vendor_tag",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organization.id)
      .notNull(),
    name: text("name").notNull(),
  },
  (table) => [
    uniqueIndex("vendor_tag_org_name_uq").on(table.organizationId, table.name),
  ],
);

export const vendorTagAssignment = pgTable(
  "vendor_tag_assignment",
  {
    id: serial("id").primaryKey(),
    vendorId: integer("vendor_id")
      .references(() => vendor.id, { onDelete: "cascade" })
      .notNull(),
    tagId: integer("tag_id")
      .references(() => vendorTag.id, { onDelete: "cascade" })
      .notNull(),
  },
  (table) => [
    uniqueIndex("vendor_tag_assignment_uq").on(table.vendorId, table.tagId),
  ],
);

export const vendorStatusTransition = pgTable("vendor_status_transition", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id")
    .references(() => vendor.id)
    .notNull(),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  /** "gate" | "officer_decision" | "sweep" — a TS union, NOT a pgEnum, so new
   *  sources never need a migration. */
  source: text("source").notNull(),
  actorUserId: text("actor_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// =============================================================================
// HITL confirmations (durable windows)
// =============================================================================

export const documentConfirmation = pgTable(
  "document_confirmation",
  {
    id: serial("id").primaryKey(),
    uuid: uuid("uuid").notNull().unique(),
    documentId: integer("document_id")
      .references(() => vendorDocument.id, { onDelete: "cascade" })
      .notNull(),
    /** PARENT_POLICY_COVERS_SUBSIDIARY | DBA_SAME_ENTITY | BLANKET_ENDORSEMENT_APPLIES */
    kind: text("kind").notNull(),
    question: text("question").notNull(),
    entityName: text("entity_name"),
    defaultAnswer: boolean("default_answer"),
    raisedAt: timestamp("raised_at").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    answeredAt: timestamp("answered_at"),
    answer: boolean("answer"),
    /** "answered" | "default" | "timeout" — matches the confirmations writer. */
    outcome: text("outcome"),
  },
  (table) => [index("document_confirmation_doc_idx").on(table.documentId)],
);

/**
 * A requirement the harness was NOT allowed to settle (SPEC §19.4): the host
 * computed a verdict, policy withheld ratification, and an officer must decide.
 *
 * Deliberately NOT a document_confirmation. That table carries
 * `default_answer`/`expires_at` and the run FAILS OPEN on timeout — right for
 * "is this your company?", unacceptable for "may this category be granted?".
 * A referral has no expiry and no default: it waits for a human.
 */
export const requirementReferral = pgTable(
  "requirement_referral",
  {
    id: serial("id").primaryKey(),
    uuid: uuid("uuid").defaultRandom().notNull().unique(),
    vendorId: integer("vendor_id")
      .references(() => vendor.id, { onDelete: "cascade" })
      .notNull(),
    /** The document whose evidence prompted it; null for vendor-level referrals. */
    documentId: integer("document_id").references(() => vendorDocument.id, {
      onDelete: "cascade",
    }),
    /** A RequirementCategory value. */
    category: text("category").notNull(),
    /** "GRANT" | "REJECT" — the host verdict awaiting ratification. */
    proposedVerdict: text("proposed_verdict").notNull(),
    /** "AGENT" today; the column exists so a future proposer is auditable. */
    proposedBy: text("proposed_by").notNull().default("AGENT"),
    /** The validation rules / extraction facts behind the proposal. */
    evidence: jsonb("evidence"),
    raisedAt: timestamp("raised_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"),
    resolvedByUserId: text("resolved_by_user_id"),
    /**
     * "GRANTED" | "REJECTED" set by an officer; "SUPERSEDED" set by the fold
     * when the category stopped needing ratification (granted elsewhere, or the
     * evidence changed) — see reconcileRequirementReferrals.
     */
    resolution: text("resolution"),
    note: text("note"),
  },
  (table) => [
    index("requirement_referral_vendor_idx").on(table.vendorId),
    // One OPEN referral per (vendor, category) — a re-run must not queue a
    // second copy of a question nobody has answered yet.
    uniqueIndex("requirement_referral_open_uq")
      .on(table.vendorId, table.category)
      .where(sql`resolved_at IS NULL`),
  ],
);

// =============================================================================
// API-check evidence + renewal notifications (§6.9, §6.8)
// =============================================================================

export const apiCheckEvidence = pgTable("api_check_evidence", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id")
    .references(() => vendor.id)
    .notNull(),
  provider: text("provider").notNull(),
  category: text("category").notNull(),
  result: jsonb("result"),
  passed: boolean("passed").notNull(),
  checkedAt: timestamp("checked_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
});

export const renewalNotification = pgTable(
  "renewal_notification",
  {
    id: serial("id").primaryKey(),
    vendorId: integer("vendor_id")
      .references(() => vendor.id)
      .notNull(),
    category: text("category").notNull(),
    documentType: text("document_type"),
    horizonDays: integer("horizon_days").notNull(),
    dueAt: date("due_at").notNull(),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("renewal_notification_uq").on(
      table.vendorId,
      table.category,
      table.horizonDays,
      table.dueAt,
    ),
  ],
);

/**
 * Vendor assistant chat — one row per stored item across three thread
 * namespaces keyed by the vendor uuid: `vendor-chat:<uuid>` transcript
 * (one row per UIMessage), `vendor-session:<uuid>` a single parked-harness
 * resume-state row (fixed message_id), `vendor-memory:<uuid>` one row per
 * remembered fact. UNIQUE(thread_id, message_id) is the idempotency
 * boundary for every write; `id` is the monotonic tiebreaker for ordering
 * and pruning.
 */
export const assistantChatTurn = pgTable(
  "assistant_chat_turn",
  {
    id: serial("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    vendorId: integer("vendor_id")
      .references(() => vendor.id, { onDelete: "cascade" })
      .notNull(),
    messageId: text("message_id").notNull(),
    /** 'user' | 'assistant' | 'system' | 'memory' */
    role: text("role").notNull(),
    parts: jsonb("parts").notNull(),
    /** Opaque harness resume state on the session row; unused elsewhere. */
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("assistant_chat_turn_thread_message_uq").on(
      table.threadId,
      table.messageId,
    ),
    index("assistant_chat_turn_thread_created_idx").on(
      table.threadId,
      table.createdAt,
    ),
  ],
);

// =============================================================================
// better-auth tables (generated shape, better-auth 1.6.x drizzle adapter)
// =============================================================================

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  /** "VENDOR_CONTACT" | "COMPLIANCE_OFFICER" | "ADMIN" (additionalFields). */
  role: text("role"),
  organizationId: integer("organization_id"),
  vendorId: integer("vendor_id"),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    /** better-auth ≥1.7 scopes account identity by (issuer, accountId);
     *  email/password rows carry the synthetic issuer "local:credential"
     *  (SPEC §17 C11 — migration 0002 backfills existing rows). */
    issuer: text("issuer").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("account_user_idx").on(table.userId),
    // better-auth 1.7's account-identity key.
    uniqueIndex("account_issuer_account_id_uq").on(table.issuer, table.accountId),
  ],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
