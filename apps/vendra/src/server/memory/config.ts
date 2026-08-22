/**
 * Memory-layer configuration (SPEC §22) — one place for every value the
 * index depends on.
 *
 * The embedding dimension appears exactly ONCE here and is used for both the
 * embedder and the Qdrant collection. A mismatch between those two is the
 * single most common mem0 failure, and it fails at insert time with an opaque
 * error, so the literal is deliberately not repeated anywhere.
 *
 * Enablement follows the harness's optional-at-boot posture (§9.1): the layer
 * is live only when the index endpoints AND the extraction key are all present.
 * Missing any of them is not an error — recall falls back to the Postgres
 * recency list (exactly the pre-mem0 behaviour) and /api/health says so.
 */
import { env } from "@/env";

/**
 * `bge-m3`, 1024 dimensions.
 *
 * Chosen for language, not for leaderboard position: this portal's content is
 * Spanish, and the usual defaults (`nomic-embed-text`, `mxbai-embed-large`) are
 * English-centric and lose recall on it. bge-m3 is multilingual by design with
 * an 8192-token context. Changing the model means changing this constant AND
 * re-indexing — the collection's vector size is fixed at creation.
 */
export const EMBEDDING_DIMENSIONS = 1024;
export const DEFAULT_EMBED_MODEL = "bge-m3";

/**
 * Extraction model. Haiku is the right default for this job: fact extraction is
 * short, structured, and runs once per turn — the money is better spent on the
 * chat itself.
 */
export const DEFAULT_EXTRACTION_MODEL = "claude-haiku-4-5-20251001";

/** The Qdrant collection. Renaming it orphans the index; re-index after. */
export const MEMORY_COLLECTION = "vendra_assistant_memory";

/** mem0 scope: one agent, one memory space, vendors separated by `userId`. */
export const MEMORY_AGENT_ID = "vendra-assistant";

/** Recall budget — unchanged from the pre-mem0 caps so prompts stay bounded. */
export const RECALL_MAX_FACTS = 20;
export const RECALL_MAX_CHARS = 2_000;

/** How many candidates to ask the index for before applying the char budget. */
export const RECALL_SEARCH_LIMIT = 30;

export interface MemoryLayerConfig {
  qdrantUrl: string;
  ollamaUrl: string;
  anthropicApiKey: string;
  embedModel: string;
  extractionModel: string;
}

/**
 * The resolved config, or null when the layer is not configured.
 *
 * Callers treat null as "index unavailable" and fall back; they never throw.
 */
export function memoryConfig(): MemoryLayerConfig | null {
  const qdrantUrl = env.VENDOR_QDRANT_URL;
  const ollamaUrl = env.VENDOR_OLLAMA_URL;
  const anthropicApiKey = env.ANTHROPIC_API_KEY;
  if (!qdrantUrl || !ollamaUrl || !anthropicApiKey) return null;
  return {
    qdrantUrl,
    ollamaUrl,
    anthropicApiKey,
    embedModel: env.VENDOR_MEMORY_EMBED_MODEL ?? DEFAULT_EMBED_MODEL,
    extractionModel: env.VENDOR_MEMORY_LLM_MODEL ?? DEFAULT_EXTRACTION_MODEL,
  };
}

/** Which knob is missing — for /api/health and the boot log, never for vendors. */
export function memoryConfigGap(): string | null {
  if (!env.VENDOR_QDRANT_URL) return "VENDOR_QDRANT_URL";
  if (!env.VENDOR_OLLAMA_URL) return "VENDOR_OLLAMA_URL";
  if (!env.ANTHROPIC_API_KEY) return "ANTHROPIC_API_KEY";
  return null;
}

/**
 * What mem0 is told about the facts it extracts.
 *
 * Two jobs. First, language: mem0's built-in extractor prompt is English and
 * will happily translate a Spanish conversation into English facts, which then
 * read as machine output when they land back in a Spanish prompt. Second,
 * scope: this is a compliance onboarding chat, so durable facts are about the
 * BUSINESS, and the transient mechanics of the current document run are noise.
 *
 * The PII clause is defence in depth only — `redactMemoryFact` still runs on
 * everything that leaves the process, because a prompt is a request and a
 * regex is a guarantee.
 */
export const MEMORY_CUSTOM_INSTRUCTIONS = `
Extrae únicamente hechos duraderos sobre la EMPRESA del proveedor: su tipo de
entidad, dónde y cómo trabaja, su estructura de seguros, sus certificaciones,
sus preferencias de proceso y las restricciones que declara.

Reglas:
- Escribe cada hecho en español, en tercera persona, en una sola frase corta.
- NUNCA guardes datos de contacto ni identificadores fiscales (correo,
  teléfono, EIN, SSN, números de póliza).
- NUNCA guardes el estado momentáneo de un documento o de un requisito: eso se
  consulta en vivo y cambia solo.
- NUNCA guardes lo que dijo el asistente; solo lo que afirmó el proveedor.
- Si un hecho nuevo contradice uno anterior, prefiere el nuevo.
`.trim();
