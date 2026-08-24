/**
 * Landing-page copy. Every claim here mirrors real behavior in this repo —
 * feature copy is drawn from the portal, officer, platform and assistant
 * surfaces (and SPEC), not aspirational marketing. es-419, formal register.
 */
import {
  BotIcon,
  BrainIcon,
  ClockIcon,
  CpuIcon,
  DatabaseIcon,
  FileCheck2Icon,
  FingerprintIcon,
  HistoryIcon,
  ScaleIcon,
  ShieldCheckIcon,
  TerminalIcon,
  UploadCloudIcon,
  UserCheckIcon,
  type LucideIcon,
} from "lucide-react";

export const NAV_LINKS = [
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#casos", label: "Casos" },
  { href: "#paneles", label: "Paneles" },
  { href: "#asistente", label: "Asistente" },
  { href: "#adjudicacion", label: "Oficial" },
  { href: "#gobernanza", label: "Gobernanza" },
  { href: "#funcionalidades", label: "Funciones" },
  { href: "#arquitectura", label: "Arquitectura" },
] as const;

/** The 16 accepted document types, verbatim from VENDOR_DOCUMENT_TYPE_TITLES
 *  (the 17th entry, UNKNOWN, is the classifier's rejection bucket). */
export const DOCUMENT_TYPE_TITLES = [
  "Certificado de seguro (ACORD 25)",
  "Página de declaraciones de la póliza de seguro",
  "Póliza umbrella / de exceso de responsabilidad",
  "Formulario W-9 del IRS",
  "Formulario W-8BEN-E del IRS",
  "Licencia comercial",
  "Certificación de diversidad",
  "Carta de EMR (tasa de modificación por experiencia)",
  "Resumen del Formulario 300A de OSHA",
  "Informe SOC 2",
  "Certificado ISO 27001",
  "Póliza de responsabilidad cibernética",
  "Carta de verificación bancaria",
  "Cheque anulado",
  "Contrato marco de servicios firmado",
  "Acuerdo de confidencialidad firmado",
] as const;

/** Verified against the source: VENDOR_DOCUMENT_TYPE_TITLES minus the UNKNOWN
 *  rejection bucket (16), REQUIREMENT_CATEGORY_LABELS (11), TOTAL_STAGES (8),
 *  vendor-status-badge (7). */
export const STATS = [
  { value: 16, label: "tipos de documento", detail: "del W-9 al ACORD 25 y SOC 2" },
  { value: 11, label: "categorías de requisitos", detail: "con trazabilidad documento a documento" },
  { value: 8, label: "etapas de revisión en vivo", detail: "transmitidas a su navegador" },
  { value: 7, label: "estados de cumplimiento", detail: "de «No iniciado» a «Aprobado»" },
] as const;

export interface PipelineStep {
  icon: LucideIcon;
  title: string;
  description: string;
}

export const PIPELINE_STEPS: PipelineStep[] = [
  {
    icon: UploadCloudIcon,
    title: "Suba sus documentos",
    description:
      "Arrastre COIs, W-9, licencias y pólizas — PNG, JPEG, WebP o PDF de hasta 10 MB, con carga múltiple y reintentos.",
  },
  {
    icon: BotIcon,
    title: "Un agente por documento",
    description:
      "Cada archivo recibe su propia sesión de Claude en una MicroVM aislada, transmitida en vivo: clasificación, extracción y razonamiento a la vista.",
  },
  {
    icon: ScaleIcon,
    title: "El motor determinista decide",
    description:
      "Validación, trazabilidad de requisitos y matemática de cobertura son código puro y reproducible — la IA nunca aprueba por sí sola.",
  },
  {
    icon: UserCheckIcon,
    title: "Una persona adjudica",
    description:
      "Exenciones, otorgamientos, revocaciones y la decisión final quedan en manos de su oficial de cumplimiento, con auditoría inmutable.",
  },
];

export interface ShowcasePanel {
  id: string;
  tab: string;
  title: string;
  description: string;
  bullets: string[];
}

export const SHOWCASE_PANELS: ShowcasePanel[] = [
  {
    id: "portal",
    tab: "Portal del proveedor",
    title: "Incorporación con agentes a la vista",
    description:
      "El proveedor arrastra sus documentos y ve trabajar a cada agente en vivo, con la lista de requisitos y la puerta de activación siempre al lado.",
    bullets: [
      "Zona de carga con verificación en vivo: barra «Etapa X de 8», narración del agente y razonamiento visible.",
      "Confirmaciones humano-en-el-circuito con cuenta regresiva cuando el agente duda de verdad.",
      "Lista de requisitos del perfil del proveedor con medidor de avance, descartes «No aplica» y aviso de renovación a 30 días.",
      "Activación con compuerta determinista: el botón explica exactamente qué falta para habilitarse.",
    ],
  },
  {
    id: "oficial",
    tab: "Panel del oficial",
    title: "Adjudicación con herramientas de rescate",
    description:
      "Un directorio ordenado por próximo vencimiento y un expediente por proveedor con todo el kit: eximir, recategorizar, otorgar, revocar y reintentar.",
    bullets: [
      "Directorio con búsqueda, filtros por estado y auto-refresco — lo próximo a vencer, primero.",
      "Trazabilidad de requisitos: qué documento otorga cada categoría, cuál falló y por qué regla.",
      "Exenciones acotadas con vencimiento y justificación obligatoria que queda en el registro de auditoría.",
      "Determinación de cobertura por línea de póliza: límites efectivos contra los exigidos, en vivo.",
    ],
  },
  {
    id: "gobernanza",
    tab: "Consola de gobernanza",
    title: "Administración de políticas del agente",
    description:
      "Cada empresa define qué documentos acepta, qué campos se extraen, qué validaciones cuentan y qué puede aprobar el sistema sin una persona.",
    bullets: [
      "Poder de árbitro por categoría: «El sistema decide» o «Un oficial debe aprobarla» — la frontera exacta de la IA.",
      "Puerta de admisibilidad OPA compilada a Wasm y evaluada localmente antes de activar cualquier política.",
      "Versionado borrador → activa → archivada, con anclaje por proveedor: a nadie se le cambian las reglas a mitad del proceso.",
      "Propuestas del asistente delegado revisadas por humanos: nada se aplica sin aprobación explícita.",
    ],
  },
  {
    id: "asistente",
    tab: "Asistente con memoria",
    title: "Un asistente que conoce el expediente",
    description:
      "Chat en español con acceso al expediente de cumplimiento del proveedor y memoria semántica entre sesiones — todo autoalojado.",
    bullets: [
      "Responde sobre cobertura, requisitos y vencimientos leyendo el expediente real, no un resumen.",
      "Memoria local y privada: mem0 OSS + Qdrant + Ollama en contenedores propios, con PII redactada antes de almacenar.",
      "Dos niveles de privilegio: «Conversacional — solo explica» o «Delegado — puede proponer directivas».",
      "Si el índice no responde, degrada a recencia: el asistente nunca se cae con su memoria.",
    ],
  },
];

/**
 * The three deep-dive sections that follow the showcase tabs. The tabs answer
 * "what is each surface"; these answer "watch one hard job get done end to
 * end" — the assistant's multi-tool turn, the officer's rescue toolkit, and
 * the platform console configuring roles and policies. Marketing prose lives
 * here (not in the scene files) so the scene-copy recall check stays focused
 * on strings that depict product UI.
 */
export interface DeepDive {
  eyebrow: string;
  title: string;
  subtitle: string;
  bullets: string[];
}

export const ASSISTANT_DEEP_DIVE: DeepDive = {
  eyebrow: "Asistente con memoria",
  title: "Una pregunta difícil, resuelta en un solo turno",
  subtitle:
    "El proveedor pregunta en español. El asistente lee el expediente real, abre el documento que falló, deja una nota para la próxima vez y redacta una propuesta de directiva que solo una persona puede aprobar.",
  bullets: [
    "Cuatro herramientas encadenadas en el mismo turno: consultar el expediente, revisar un documento, tomar nota y redactar una propuesta.",
    "El razonamiento del modelo queda a la vista, plegado — se abre cuando usted quiere verlo, y el texto llega transmitido token a token.",
    "Memoria semántica local: mem0 OSS, Qdrant y Ollama en contenedores propios, con la PII redactada antes de almacenar.",
    "En el nivel «Delegado — puede proponer directivas» la propuesta aterriza en la consola de gobernanza y espera una decisión humana.",
  ],
};

export const OFFICER_ACTIONS: DeepDive = {
  eyebrow: "Panel del oficial",
  title: "Cinco acciones de rescate, cada una con su rastro",
  subtitle:
    "Cuando el motor determinista se detiene, su oficial de cumplimiento tiene herramientas — y cada una escribe su propia línea en el registro de auditoría antes de tocar nada.",
  bullets: [
    "Eximir, recategorizar, otorgar, revocar y reintentar: el kit completo sobre el documento, sin salir del expediente del proveedor.",
    "Las cuatro acciones que cambian el veredicto exigen una justificación escrita; las cinco dejan su línea en el registro de auditoría — no hay atajos silenciosos.",
    "El servidor vuelve a acotar el alcance de cada exención: una falla nunca puede eximir más de lo que realmente bloquea.",
    "El estado final es una decisión aparte y explícita: otorgar cierra una categoría, no aprueba al proveedor.",
  ],
};

export const GOVERNANCE_SETUP: DeepDive = {
  eyebrow: "Consola de plataforma",
  title: "Roles y políticas, configurados a la vista",
  subtitle:
    "Cada empresa define quién revisa, qué puede hacer el asistente, qué documentos se aceptan y qué requisitos aprueba el sistema por su cuenta — todo antes de que un proveedor suba su primer archivo.",
  bullets: [
    "Cuentas de oficial creadas desde la consola, con alcance exacto a una empresa y a ninguna otra.",
    "Dos niveles de privilegio para el asistente del proveedor: solo explicar, o proponer cambios que una persona aprueba.",
    "Por tipo de documento: qué campos se extraen —con los estructurales bloqueados— y qué validaciones cuentan de verdad.",
    "Poder de árbitro por categoría, y una puerta de admisibilidad OPA que revisa la configuración antes de dejar activarla.",
  ],
};

export interface BentoTile {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Tailwind col-span classes for the bento layout. */
  span?: string;
}

export const BENTO_TILES: BentoTile[] = [
  {
    icon: ShieldCheckIcon,
    title: "Políticas del agente, gobernadas",
    description:
      "Un gate OPA/Rego compilado a Wasm admite cada política antes de activarla: documentos aceptados, campos extraídos, validaciones que cuentan y qué categorías aprueba el sistema solo.",
    span: "md:col-span-2",
  },
  {
    icon: FileCheck2Icon,
    title: "Documentos y extracción",
    description:
      "16 tipos de documento con campos estructurales bloqueados, identificadores fiscales siempre enmascarados y una versión de extracción por cada revisión.",
  },
  {
    icon: BrainIcon,
    title: "Memoria semántica local",
    description:
      "El asistente recuerda hechos entre sesiones con búsqueda semántica en español — mem0 OSS, Qdrant y Ollama, autoalojados.",
  },
  {
    icon: UserCheckIcon,
    title: "Humano en el circuito",
    description:
      "Confirmaciones con cuenta regresiva, derivaciones por política de empresa y propuestas de directivas que solo una persona puede aprobar.",
  },
  {
    icon: HistoryIcon,
    title: "Auditoría inmutable",
    description:
      "Libro de actividad transaccional y trazabilidad por requisito: el artefacto que se le entrega a un auditor, siempre al día.",
  },
  {
    icon: ClockIcon,
    title: "Cumplimiento continuo",
    description:
      "El tiempo es un disparador de primera clase: expiración automática, aviso de renovación en el portal a 30 días y restauración sin fricción al renovar.",
    span: "md:col-span-2",
  },
];

export interface ArchitectureCard {
  icon: LucideIcon;
  title: string;
  description: string;
}

export const ARCHITECTURE_CARDS: ArchitectureCard[] = [
  {
    icon: CpuIcon,
    title: "La IA nunca decide sola",
    description:
      "El agente solo clasifica y extrae. Validación, mapeo de requisitos, apilamiento de coberturas y compuertas de activación son código determinista: cada veredicto es reproducible.",
  },
  {
    icon: TerminalIcon,
    title: "Agentes aislados y visibles",
    description:
      "Cada documento corre en su propia sesión de Claude Code dentro de una MicroVM (Vercel Sandbox), transmitida en vivo al navegador — sin cajas negras.",
  },
  {
    icon: DatabaseIcon,
    title: "Sus datos, en sus contenedores",
    description:
      "Postgres, MinIO, Qdrant y Ollama autoalojados. Las únicas salidas a internet son la API de Anthropic y Vercel Sandbox — nada más.",
  },
  {
    icon: FingerprintIcon,
    title: "Acceso local y auditable",
    description:
      "Autenticación de correo y contraseña resuelta en el servidor, roles separados para proveedor, oficial y plataforma, y límites de tasa siempre activos.",
  },
];
