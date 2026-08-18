/**
 * One-line structured logs for the Vendra harness pipeline (SPEC §17 C5).
 *
 * Every event is a single greppable line —
 * `[vendra:<event>] ts=<ISO-8601> level=<info|warn|error> k=v k=v` — so the
 * pipeline is traceable end-to-end (process.start → process.done), every
 * failure carries enough context to diagnose without a DB query, and an
 * audit pass can sweep one file for `level=error` / `level=warn` regardless
 * of which console stream the runtime merged the line from.
 *
 * Field-value grammar: values containing whitespace or `"` are quoted with
 * embedded quotes escaped, so lines stay machine-splittable on spaces.
 *
 * PII rule: identifiers / enums / counts / booleans / durations ONLY. Never
 * log names, TINs, extracted document values, or officer justification text
 * (log `noteLen` instead).
 */

export type LogFields = Record<
  string,
  string | number | boolean | null | undefined
>;

export type LogLevel = "info" | "warn" | "error";

function formatValue(value: string | number | boolean | null): string {
  const raw = String(value);
  if (/[\s"]/.test(raw)) return `"${raw.replaceAll('"', '\\"')}"`;
  return raw;
}

function formatLine(level: LogLevel, event: string, fields?: LogFields): string {
  const parts = [
    `[vendra:${event}]`,
    `ts=${new Date().toISOString()}`,
    `level=${level}`,
  ];
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      parts.push(`${key}=${formatValue(value)}`);
    }
  }
  return parts.join(" ");
}

export function vendraLog(event: string, fields?: LogFields): void {
  console.log(formatLine("info", event, fields));
}

export function vendraWarn(event: string, fields?: LogFields): void {
  console.warn(formatLine("warn", event, fields));
}

export function vendraError(event: string, fields?: LogFields): void {
  console.error(formatLine("error", event, fields));
}
