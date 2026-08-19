# Vendra

**Onboarding de proveedores y cumplimiento continuo, adjudicado con IA — un backend construido sobre un *agent harness* de Claude Code.**

Un proveedor sube los documentos de cumplimiento que tenga (certificados de seguro, W-9, licencias, historial de seguridad…). **Cada documento abre su propia sesión de agente Claude Code** dentro de una MicroVM desechable en la nube: el agente lee las páginas, clasifica el documento contra un catálogo y extrae datos estructurados — todo transmitido **en vivo** al navegador. Todo lo que viene después es código determinista del host: validación, mapeo de requisitos, matemática de cobertura, bitácora de auditoría. Un segundo carril de agente resuelve la **cobertura agregada de seguros** (¿la póliza umbrella se apila sobre la de responsabilidad civil para alcanzar el límite exigido?). Y un tercer carril es el **asistente conversacional** del proveedor: el mismo harness, esta vez como chat.

> **La regla de oro del proyecto:** el modelo nunca decide el cumplimiento. Solo lee documentos y responde preguntas. Las decisiones —validar, otorgar un requisito, aprobar una cuenta— las calcula código puro o las toma una persona.

---

## Índice

1. [¿Qué hace esta app? (explicación para principiantes)](#1-qué-hace-esta-app-explicación-para-principiantes)
2. [Arranque rápido](#2-arranque-rápido-solo-necesita-docker)
3. [La idea central: *harness* como backend](#3-la-idea-central-harness-como-backend)
4. [Carril 1 — el pipeline por documento](#4-carril-1--el-pipeline-por-documento)
5. [Carril 2 — la determinación de cobertura](#5-carril-2--la-determinación-de-cobertura)
6. [Carril 3 — el asistente LLM del proveedor](#6-carril-3--el-asistente-llm-del-proveedor)
7. [Arquitectura completa](#7-arquitectura-completa)
8. [El rol de cada pieza del stack](#8-el-rol-de-cada-pieza-del-stack)
9. [Versiones exactas](#9-versiones-exactas)
10. [Modelo de datos](#10-modelo-de-datos)
11. [Seguridad y privacidad](#11-seguridad-y-privacidad)
12. [Desarrollo local sin Docker](#12-desarrollo-local-sin-docker)
13. [Solución de problemas](#13-solución-de-problemas)

---

## 1. ¿Qué hace esta app? (explicación para principiantes)

### El problema del mundo real

Antes de que una empresa grande (el *comprador*) le pague a un proveedor nuevo, alguien tiene que revisar papeles: ¿tiene seguro vigente y con el monto suficiente?, ¿entregó su formulario tributario?, ¿su licencia comercial está al día?, ¿venció algo desde la última revisión? Hoy eso lo hace una persona abriendo PDFs uno por uno. Es lento, se equivoca y no queda registro de por qué se aprobó algo.

**Vendra automatiza la lectura y deja la decisión donde corresponde.**

### Los dos usuarios

| Rol | Quién es | Qué ve |
|---|---|---|
| **Contacto del proveedor** (`VENDOR_CONTACT`) | La empresa que quiere venderle al comprador | Su portal: sube documentos, ve el progreso en vivo, revisa qué le falta, activa su cuenta, y conversa con un asistente |
| **Oficial de cumplimiento** (`COMPLIANCE_OFFICER`) | Quien revisa y aprueba del lado del comprador | Un panel aparte: listado de proveedores, detalle de cada uno, y las herramientas para dispensar, reclasificar, otorgar manualmente, revocar, reintentar y aprobar |

### El recorrido del proveedor, paso a paso

1. **Se registra** con correo y contraseña, e ingresa los datos del negocio (nombre legal, tipo de entidad, estados donde trabaja, si es 100% remoto…). Esos datos definen su **perfil de requisitos**: por ejemplo, un proveedor totalmente remoto no necesita seguro de auto ni compensación laboral.
2. **Sube sus documentos** (hasta 40 archivos, 10 MB cada uno; PDF o imagen). El navegador los sube directo al almacenamiento con una URL prefirmada — no pasan por el servidor de la app.
3. **Mira el procesamiento en vivo.** Cada tarjeta de documento muestra 8 etapas (`leyendo → analizando → clasificando → extrayendo → guardando → validando → mapeando → finalizando`), el razonamiento del agente y frases cortas del tipo *"Leyendo ambas páginas de su certificado."* Todo llega por streaming, en español.
4. **Responde una confirmación si aparece.** Si un documento nombra a otra empresa (la póliza de la matriz, un nombre de fantasía), la app se detiene y pregunta: *"¿Esta póliza de ACME Holdings cubre a su empresa?"*. Hay 5 minutos para contestar; si nadie contesta, el sistema continúa con el criterio por defecto y lo deja registrado. La pregunta sobrevive a un refresh de la página.
5. **Ve su checklist de requisitos** — 11 categorías (identidad fiscal, responsabilidad civil, compensación laboral, auto, licencia, diversidad, seguridad, bancaria, seguridad de datos, acuerdos firmados, sanciones) — con lo que está cubierto, lo que falta y lo que se puede marcar "no aplica".
6. **Consulta al asistente** cuando algo no le calza: *"¿Por qué falló mi certificado?"*, *"¿Qué me falta para activar?"*. El asistente consulta el estado real en el momento, no adivina.
7. **Activa su cuenta** cuando el checklist se completa → el estado pasa a `PRE_APPROVED`.

### El recorrido del oficial

Entra a `/vendors`, filtra el listado, abre un proveedor y ve: los requisitos con su **trazabilidad** (qué documento otorgó qué categoría), cada documento con su clasificación / datos extraídos / reglas de validación, y la determinación de cobertura con el desglose de qué póliza aportó cuánto. Desde ahí puede:

- **Dispensar** una validación fallida (con justificación y alcance acotado por el servidor),
- **Reclasificar** un documento mal tipificado (crea una versión nueva; nunca sobrescribe),
- **Otorgar manualmente** una categoría,
- **Revocar** ese otorgamiento,
- **Reintentar** el procesamiento,
- **Finalizar** el estado (`APPROVED` / `NEED_REVIEW` / `REJECTED`),
- **Etiquetar** al proveedor.

Cada acción escribe una fila de actividad y recalcula el estado del proveedor **en la misma transacción**. Nada queda a medias.

### Y el tiempo también decide

Un barrido horario revisa vencimientos: cuando un documento obligatorio caduca, el proveedor `APPROVED` pasa a `EXPIRED` solo; a 30, 14 y 1 día del vencimiento se generan avisos de renovación. Si el proveedor sube la renovación y valida, vuelve a `APPROVED` sin que un oficial tenga que tocar nada.

### Glosario mínimo

| Término | Qué significa aquí |
|---|---|
| **Harness** | Un agente de codificación ya hecho (Claude Code) con su propio ciclo de razonamiento y herramientas. Este backend lo *arrienda* en vez de armar el loop a mano |
| **Sandbox / MicroVM** | Una máquina virtual desechable donde corre el agente, aislada del servidor y con salida a internet restringida |
| **Host tool** | Una herramienta que el agente llama, pero que se ejecuta en el servidor Next.js (no dentro de la VM). Así el agente pide "guarda esta clasificación" y el host decide qué hacer con eso |
| **HITL** | *Human in the loop*: el punto donde el sistema se detiene y le pregunta a una persona |
| **Compuerta de activación** | La matemática que decide si el proveedor puede activar su cuenta |
| **SSE / streaming** | La técnica para que el navegador reciba el avance en vivo mientras el agente trabaja |

---

## 2. Arranque rápido (solo necesita Docker)

```bash
git clone https://github.com/Cognition-Flux/multi-agent-harness-as-backend-es.git
cd multi-agent-harness-as-backend-es
cp .env.docker.example .env.docker
# edite .env.docker y complete las CUATRO llaves de dependencias remotas:
#   ANTHROPIC_API_KEY=…   (el modelo)
#   VERCEL_TOKEN=…        (Vercel Sandbox — la MicroVM donde corren los agentes)
#   VERCEL_TEAM_ID=…
#   VERCEL_PROJECT_ID=…
# y ponga cualquier cadena aleatoria en BETTER_AUTH_SECRET (openssl rand -hex 32)
docker compose up
```

Ese único comando levanta **cinco servicios**:

| Servicio | Qué hace |
|---|---|
| `postgres` | Postgres 16, la base de datos propia de la app (puerto host **5436**) |
| `minio` | Almacenamiento de objetos compatible con S3 (**9000** API / **9001** consola) |
| `minio-init` | Crea el bucket `vendor-docs` una sola vez |
| `migrate` | Aplica las migraciones y siembra la demo — **mire su log: ahí salen las credenciales** |
| `app` | El servidor Next.js en **http://localhost:3000** |

**Todo corre local excepto dos dependencias remotas, ambas de solo salida:** la API de Anthropic y Vercel Sandbox. Sin las cuatro llaves la app igual arranca, sirve las dos interfaces y acepta subidas; los documentos quedan en cola y `/api/health` reporta `harness: unconfigured`.

### La demo en 6 pasos

1. http://localhost:3000 → entre como **proveedor** (`vendor@summit-demo.test` / `VendorDemo123!`).
2. Complete los datos del negocio y suba un COI + W-9 + licencia (o cualquier PDF/imagen). Mire el streaming.
3. Si aparece una confirmación, respóndala (o déjela vencer: el sistema continúa).
4. Cuando el checklist se complete → **Activar cuenta** → `PRE_APPROVED`.
5. Cierre sesión y entre como **oficial** (`officer@acme-demo.test` / `OfficerDemo123!`) → `/vendors` → abra el proveedor → dispense / reclasifique / otorgue / finalice.
6. `docker compose down && docker compose up` → todo el estado sobrevive (volúmenes con nombre).

---

## 3. La idea central: *harness* como backend

### ¿Qué es un *harness* y en qué se diferencia de "llamar a un LLM"?

La forma común de usar un modelo desde un backend es: arma un prompt → llama a la API → si el modelo pide una herramienta, ejecútala → vuelve a llamar → repite. Ese loop lo escribe y lo mantiene usted.

Un **harness** es distinto: es un agente **ya construido y probado** —aquí, Claude Code— que trae su propio ciclo de razonamiento, su manejo de contexto, sus herramientas internas (`read`, `write`, `bash`, `glob`, `grep`, `webSearch`), su reanudación de sesiones y su modo de "pensar". El AI SDK v7 lo expone detrás de una API uniforme: la clase **`HarnessAgent`**.

Vendra lleva esa idea al extremo y la usa como **backend completo**: cada unidad de trabajo con IA es una **sesión de agente**, no una llamada a un modelo. En todo el repositorio no existe una sola llamada directa a `generateText` o `streamText`.

```ts
// apps/vendra/src/server/harness/doc-run.ts (simplificado)
const agent = new HarnessAgent({
  harness: createClaudeCode({
    model: env.HARNESS_MODEL,                        // p. ej. claude-sonnet-4-6
    thinking: { type: "adaptive", display: "summarized" },
    auth: { anthropic: { apiKey: env.ANTHROPIC_API_KEY } },  // auth directa, sin gateway
  }),
  sandbox,                                            // la MicroVM compartida
  tools: buildVendorDocTools(ctx),                    // herramientas del HOST
  activeTools: ["read", "saveClassification", "saveExtraction",
                "finalizeDocument", "failDocument"],  // lista blanca estricta
  permissionMode: "allow-reads",                      // defensa en profundidad
  sandboxConfig: { onSession: async ({ session, sessionWorkDir }) => {
    await session.writeBinaryFile({ path: `${sessionWorkDir}/incoming/document.pdf`, content: bytes });
  }},
});

const session = await agent.createSession({ abortSignal: signal });
const result  = await agent.stream({ session, prompt, abortSignal: signal });
writer.merge(toUIMessageStream({ stream: result.stream, sendReasoning: true }));
```

### La partición host / VM: quién ejecuta qué

Esta es la decisión de diseño más importante del proyecto.

```
┌─ Proceso Next.js (el HOST) ──────────────┐   ┌─ MicroVM Vercel Sandbox ─────────────┐
│                                          │   │                                      │
│  • Postgres, MinIO, sesiones, auth       │   │  • El CLI de Claude Code             │
│  • Los motores puros (@vendra/workflow)  │◄──┤  • El "bridge" que habla con el host │
│  • Las HOST TOOLS:                       │   │  • La herramienta interna `read`     │
│      saveClassification                  │   │  • El archivo del documento          │
│      saveExtraction                      │   │                                      │
│      finalizeDocument   ← aquí se decide │   │  Sin shell, sin escritura, sin web.  │
│      failDocument                        │   │  Egreso permitido SOLO hacia         │
│                                          │   │  api.anthropic.com y *.npmjs.org     │
└──────────────────────────────────────────┘   └──────────────────────────────────────┘
```

El agente **solo** puede: leer el archivo y llamar cuatro herramientas del host. No puede escribir archivos, no puede correr comandos, no puede navegar. Y cuando llama a `finalizeDocument`, quien valida, mapea requisitos y escribe en la base es el host — con código puro y determinista.

**Los bytes originales entran sin tocarse.** No hay rasterización ni conversión previa: el `read` interno de Claude Code abre PDFs e imágenes nativamente. Es una invariante deliberada.

### La MicroVM compartida y el grupo de puertos

Crear un sandbox y arrancar el bridge cuesta entre 1 y 3 minutos. Hacerlo por documento sería inaceptable. Por eso:

- Se crea **una sola MicroVM**, envuelta en modo *wrap* (`createVercelSandbox({ sandbox, bridgePorts })`), y cada sesión concurrente **arrienda un puerto** del grupo.
- Vercel Sandbox expone **como máximo 4 puertos** → el grupo es de 4 (`4000–4003`).
- Al crearla se hace un **pre-horneado** (`prepareSandboxForHarness`): una sesión desechable instala el bridge para que las sesiones reales no paguen el `npm install`.
- La vida de un sandbox tiene un tope duro de **45 minutos** → se renueva proactivamente a los **35**, y el viejo se retira con **8 minutos de gracia** para que las sesiones en vuelo terminen.
- El egreso es **denegado por defecto**: `networkPolicy: { allow: ["api.anthropic.com", "*.npmjs.org"] }`.

Los 4 puertos se reparten con dos semáforos:

```
 4 puertos bridge
 ├── carril de documentos  ≤ 3   (Semaphore, HARNESS_MAX_CONCURRENCY)
 └── carril de cobertura     1   (Semaphore dedicado — nunca se le puede morir de hambre)
     └── el asistente toma prestado del carril de documentos, un turno a la vez por proveedor
```

### Los tres carriles de agente

| Carril | Archivo | Sesión | Presupuesto | Pensamiento |
|---|---|---|---|---|
| **Por documento** | `server/harness/doc-run.ts` | Una por documento, se destruye al terminar | 14 min, 2 intentos | `adaptive` (resumido) |
| **Cobertura por proveedor** | `server/harness/coverage-runner.ts` | Una por proveedor, coalescida, *fire-and-forget* | 8 min, 3 intentos | `disabled` — medido: pasó de ~470 s a ~27 s |
| **Asistente del proveedor** | `server/assistant/` | Una por hilo de chat, **estacionada** entre turnos | 270 s por turno, 12 turnos | por defecto |

### Reglas de disciplina que se aplican en todo el repo

- **Todo `createSession` y todo `stream` lleva `abortSignal`.** Sin excepción.
- **Todo se transmite con `agent.stream()` envuelto en `createUIMessageStream`** — nunca `createAgentUIStreamResponse` (no hilvana la sesión del harness).
- **Nunca `z.record` cruzando el puente del harness**: descarta las llaves dinámicas. Los esquemas usan formas explícitas.
- **El contrato vive en un solo módulo**: `features/vendor-compliance/lib/vendor-harness-contract.ts` — etapas, constantes de subida, tipos de *data part* y esquemas zod de las herramientas. Lo importan las rutas, las herramientas del servidor y el cliente React, así el contrato del stream no puede desincronizarse entre capas.

---

## 4. Carril 1 — el pipeline por documento

```
Navegador                     Host (Next.js)                        MicroVM
   │                                │                                  │
   │ POST /upload-intake            │                                  │
   │───────────────────────────────►│ URL prefirmada (PUT, 900 s)      │
   │ PUT directo a MinIO ──────────────────────────►                   │
   │ POST /documents (registra fila)│                                  │
   │ POST /documents/{uuid}/process │                                  │
   │───────────────────────────────►│                                  │
   │                                │ 1. CAS: →PROCESSING (anti-doble) │
   │                                │ 2. lee los bytes (la lectura ES  │
   │                                │    la verificación)              │
   │                                │ 3. toma slot del semáforo        │
   │                                │ 4. crea sesión ────────────────► │ escribe el archivo
   │◄═══ SSE: etapas, razonamiento ═╪══════════════════════════════════│ read → clasifica
   │                                │◄── saveClassification ───────────│
   │                                │    devuelve el esquema de        │
   │                                │    extracción para ESE tipo      │
   │                                │◄── saveExtraction ───────────────│ extrae campos
   │                                │◄── finalizeDocument ─────────────│
   │                                │ 5. valida (código puro)          │
   │  ¿pregunta HITL? ◄─────────────│ 6. compara nombres de entidad    │
   │  respuesta ───────────────────►│    → ventana de 5 min            │
   │                                │ 7. mapea requisitos              │
   │                                │ 8. CAS: →PROCESSED / FAILED      │
   │                                │ 9. recalcula el proveedor        │
   │                                │10. dispara el carril de cobertura│
```

Puntos finos que importan:

- **CAS en cada reclamo y cada terminal** (*compare-and-swap*): dos clics simultáneos o el conserje automático nunca pueden procesar dos veces ni pisar un estado final.
- **Semántica de desconexión:** el `abortSignal` de la ruta **excluye a propósito `req.signal`** — cerrar la pestaña no debe matar el procesamiento. El cliente se re-sincroniza con un *poll* de snapshot cada 10 s.
- **Recuperación transitoria:** si la sesión se cae y todavía no se escribió nada hacia el proveedor (sin terminal, sin ventana HITL abierta), se reintenta en una sesión nueva. Si ya hubo efectos, no se reintenta.
- **El catálogo manda:** 17 tipos de documento (16 reales + `UNKNOWN`), y el agente solo puede elegir entre los tipos que el perfil del proveedor exige. Las descripciones de cada campo del esquema (`.describe()` en Zod) **son literalmente** las instrucciones de extracción que recibe el modelo.
- **Sin fallo silencioso:** si la corrida termina sin estado final, el host escribe la falla con una razón accionable en español.

---

## 5. Carril 2 — la determinación de cobertura

Un certificado de seguro rara vez alcanza solo: la póliza primaria da 1 M USD, la umbrella agrega 4 M encima, y el requisito es 5 M. Decidir eso exige leer varios documentos juntos.

Ese es el único trabajo del segundo carril: **una sesión por proveedor** que lee las pólizas ya extraídas y reporta, por línea (`GENERAL_LIABILITY`, `WORKERS_COMP`, `AUTO`), el límite efectivo, qué documento aportó cuánto (`primary` / `umbrella` / `excess` / `rejected`) y un veredicto (`MEETS` / `BELOW` / `UNDETERMINED`).

Disciplina de este carril:

- **Coalescido por proveedor:** si llega un disparo mientras corre, se marca `rerun` en vez de apilar sesiones.
- **Caché por firma:** un hash del conjunto de entradas corta las recorridas idénticas; la firma lleva un eje de versión (la palanca para purgar la política).
- **Fail-open explícito:** tras 3 intentos se persiste un registro `UNDETERMINED`. Los lectores muestran "sin determinar", **nunca** una cifra vieja disfrazada de fresca.
- **El host es la autoridad:** el validador rebota los payloads malos de vuelta al agente, y las cifras persistidas se re-derivan de las contribuciones.
- **Solo la determinación otorga** las tres categorías de seguro. Un documento suelto no puede otorgarlas por su cuenta — por eso el otorgamiento manual del oficial siempre está permitido en esas categorías: es su único remedio.

El progreso se ve en vivo en el navegador con un `useChat` de solo-adjuntar que reconecta al stream GET (`resumeStream()` + `prepareReconnectToStreamRequest`).

---

## 6. Carril 3 — el asistente LLM del proveedor

Un cajón de chat plegable en el portal. Por dentro es **el mismo harness**, y ahí está lo interesante.

### Sesión estacionada: `stop()`, nunca `detach()`

Una conversación dura minutos u horas, pero solo ocupa cómputo mientras un turno se transmite. Entonces:

```
turno 1 ── crea sesión ── transmite ── session.stop() ── guarda resumeState en Postgres
                                            └── libera el puerto bridge
turno 2 ── createSession({ sessionId, resumeFrom }) ── transmite ── stop() ── guarda
```

`stop()` (a diferencia de `detach()`) **libera el arriendo del puerto bridge**, y su parada de sandbox es un no-op en modo *wrap*, así que la MicroVM compartida sobrevive. Si se usara `detach()`, cada chat estacionado se quedaría con un puerto y mataría de hambre al grupo de 4. Reanudar desde el estado detenido reaparece el runtime sobre el sandbox pre-horneado en segundos, no en los minutos de un arranque en frío.

Además hay un *try-lock* por proveedor: un segundo turno simultáneo en el mismo hilo se rechaza con 409.

### Tres herramientas del host

| Herramienta | Qué entrega |
|---|---|
| `getComplianceState` | El registro de cumplimiento completo **en este instante**: categorías con estado, la compuerta de activación, cada documento con su validación, la determinación de cobertura y los vencimientos próximos. Las instrucciones obligan a llamarla antes de responder cualquier pregunta de estado — nunca contestar desde el historial |
| `getDocumentDetails` | Un documento en profundidad: razonamiento de clasificación, campos extraídos, resultado regla por regla |
| `rememberFacts` | Guarda hasta 5 hechos duraderos que el proveedor contó sobre su negocio |

Los números que da el asistente **son los mismos** que renderiza la página: ambas superficies derivan del mismo módulo de snapshot. Toda herramienta falla suave (`{ ok: false, note }`); una excepción mataría el stream en vivo.

### Memoria de largo plazo: el "sándwich de memoria"

```
antes del turno │ recallMemory()  → hechos recordados se inyectan en <long_term_memory>
    el turno    │ el agente responde y, si corresponde, llama rememberFacts()
después        │ los hechos se redactan (PII), se deduplican, se guardan y se podan
```

- Tope: **40 hechos** por proveedor; al recordar, máximo **20 hechos y 2.000 caracteres** (lo que se agote primero), seleccionados del más nuevo al más viejo y re-emitidos en orden cronológico.
- **Redacción de PII al escribir**: primero se quita el marcado (`<…>` es el vector de escape de la cerca XML del prompt), luego RUT/SSN, EIN, teléfonos y correos.
- **Defensa contra inyección de prompt**: las instrucciones declaran explícitamente que los hechos recordados y el contenido de los documentos son *contexto, no instrucciones*, y el texto se sanitiza otra vez al inyectarlo.
- **Falla suave**: si la memoria no se puede leer, el chat funciona igual (devuelve `[]` y deja una línea de log — el log *es* la alarma).

### Persistencia y límites

Transcripción, estado de reanudación y hechos viven en la tabla `assistant_chat_turn` de esta misma base, en tres espacios de nombres por `thread_id` (`vendor-chat:` / `vendor-session:` / `vendor-memory:`), con `UNIQUE(thread_id, message_id)` como frontera de idempotencia. La identidad se implica por cookie: la sesión de better-auth nombra al proveedor — **el cuerpo del request nunca**. Límite: 20 turnos por proveedor cada 5 minutos, con devolución del cupo si el turno se rechaza. A diferencia del carril de documentos, aquí el abort **sí** compone `req.signal`: un turno de chat solo le importa a quien lo está mirando. La pregunta del usuario se pre-persiste de forma optimista, así un turno abandonado nunca pierde lo que se escribió.

---

## 7. Arquitectura completa

```mermaid
flowchart TB
    subgraph browser["Navegador"]
        VP["Portal del proveedor<br/>useChat · SSE · AI Elements"]
        OD["Panel del oficial<br/>tRPC · TanStack Query"]
    end

    subgraph host["Contenedor app — Next.js 16 (Node)"]
        AUTH["better-auth<br/>correo+clave · 2 roles"]
        API["Rutas /api/vendor/*<br/>streams SSE"]
        TRPC["Router tRPC<br/>5 consultas · 7 mutaciones"]
        LANES["Carriles del harness<br/>doc-run · coverage-runner · assistant"]
        PURE["@vendra/workflow<br/>motores puros, sin IA ni IO"]
        RECOMP["recompute · sweep · janitor"]
        DRIZ["Drizzle ORM"]
        S3C["Cliente S3"]
    end

    subgraph local["Contenedores propios"]
        PG[("Postgres 16")]
        MINIO[("MinIO")]
    end

    subgraph remote["Dependencias remotas (solo egreso)"]
        VS["Vercel Sandbox MicroVM<br/>Claude Code + bridge"]
        ANTH["API de Anthropic"]
    end

    VP --> API
    OD --> TRPC
    VP -.->|cookie| AUTH
    OD -.->|cookie| AUTH
    API --> LANES
    TRPC --> RECOMP
    LANES --> PURE
    LANES --> RECOMP
    RECOMP --> DRIZ
    AUTH --> DRIZ
    DRIZ --> PG
    API --> S3C --> MINIO
    VP -.->|"PUT prefirmado"| MINIO
    LANES <-->|"bridge :4000-4003"| VS
    VS --> ANTH
```

### Subsistemas, uno por uno

| Subsistema | Dónde vive | Qué hace |
|---|---|---|
| **Runtime de sandbox compartido** | `server/harness/sandbox.ts` | UNA MicroVM de larga vida en modo *wrap*; grupo de 4 puertos bridge; pre-horneado del bridge; renovación proactiva a los 35 min con 8 min de gracia; egreso restringido; guardia de credenciales con errores nombrados; calentamiento desde `instrumentation.ts` |
| **Pipeline por documento** | `server/harness/doc-run.ts`, `tools.ts`, `prompt.ts` | Reclamo CAS → verificación de bytes → sesión `HarnessAgent` con el documento montado → 4 herramientas del host → validación y transiciones del lado del host |
| **Contrato del stream** | `features/vendor-compliance/lib/vendor-harness-contract.ts` | UN archivo compartido por rutas, herramientas y cliente: *data parts* tipados, esquemas zod de las herramientas, constantes de subida |
| **Asistente del proveedor** | `server/assistant/` + `/api/vendor/assistant` | Sesión estacionada por hilo, 3 herramientas del host, memoria de 40 hechos con redacción de PII, transcripción en Postgres |
| **Ventanas HITL durables** | `server/harness/confirmations.ts` | Registro en base primero, ventana de 5 min, esperas troceadas de 30 s (mantienen vivo el bridge), arbitraje atómico entre respuesta y vencimiento, expiración *fail-open* |
| **Carril de cobertura** | `server/harness/coverage-runner.ts` | Sesión coalescida por proveedor, caché por firma de entradas, pensamiento deshabilitado, validación del payload en el host, registro `UNDETERMINED` a prueba de fallos |
| **Elementos de IA vendorizados** | `src/components/ai-elements/` | Primitivas de render del AI SDK como código propio: `Tool` con su máquina de estados, `Reasoning` que se abre y cierra solo, `Task` como checklist de etapas, `Conversation`, `PromptInput`, `Response` |
| **Motores puros** | `packages/workflow/src/vendor/` | Sin IA, sin IO: catálogo de 17 tipos + esquemas de extracción, validadores, mapa documento→categoría, matemática de la compuerta, trazabilidad, comparación difusa de nombres de entidad, núcleo de cobertura |
| **Motor de recálculo** | `server/recompute.ts` | Todo terminal, toda mutación del oficial y todo tic del barrido pasan por un único pliegue: lecturas sobre la transacción del llamante, categorías de cobertura solo desde la determinación, un solo *merge* jsonb, bloqueos `FOR UPDATE` |
| **Kit de rescate del oficial** | `server/trpc/router.ts` | 7 mutaciones bajo el mismo contrato de atomicidad: bloqueo de fila → mutación → fila de actividad → recálculo, todo en la misma transacción. Los alcances de dispensa se **acotan en el servidor** (un desajuste de nombre jamás puede dispensar la identidad fiscal) |
| **Barrido de vencimientos** | `server/sweep.ts` | Tic horario con *advisory lock*: `APPROVED → EXPIRED` cuando caduca un documento requerido; avisos a 30/14/1 día; la renovación válida revierte el estado sola |
| **Conserje** | `server/harness/janitor.ts` | Rescata corridas huérfanas (por ejemplo si la app se reinició a mitad del procesamiento) |

### Reglas de diseño no negociables

- **Veracidad ante todo:** una corrida que no terminó **no escribe nada**; una determinación vieja se muestra como "actualizando", nunca como cifra fresca; un documento fallido trae una razón real y accionable.
- **Observabilidad desde el día uno:** cada evento del pipeline es una línea grepeable — `[vendra:<evento>] k=v k=v` — desde `process.start` hasta `process.done`, con tramos de latencia por fase.
- **Cero confianza en el cliente:** toda ruta `/api/vendor/*` y todo procedimiento tRPC resuelve la sesión en el servidor. El cuerpo del POST de `/process` se ignora deliberadamente: las entradas se cargan de la fila y del almacenamiento.

---

## 8. El rol de cada pieza del stack

### Capa de IA — AI SDK v7

| Paquete | Rol exacto en Vendra |
|---|---|
| **`ai`** (núcleo v7) | Solo tres cosas: `tool()` para definir las herramientas del host, `createUIMessageStream` / `createUIMessageStreamResponse` para abrir el stream hacia el navegador, y `toUIMessageStream` para fusionar el stream del agente. **Ninguna llamada directa a `generateText` / `streamText`** |
| **`@ai-sdk/harness`** | La clase `HarnessAgent`: crear sesión, transmitir, reanudar, detener, destruir. También `prepareSandboxForHarness` (pre-horneado) y `createFileReporter` (telemetría de turnos fallidos a `.harness-logs/`) |
| **`@ai-sdk/harness-claude-code`** | El adaptador concreto: `createClaudeCode({ model, thinking, maxTurns, auth })`. Instala y opera el CLI de Claude Code dentro de la VM y expone sus herramientas internas |
| **`@ai-sdk/sandbox-vercel`** | El proveedor de sandbox: `createVercelSandbox({ sandbox, bridgePorts })` en modo *wrap* — este repo es dueño del ciclo de vida de la VM |
| **`@vercel/sandbox`** | El SDK crudo de la MicroVM: `Sandbox.create({ runtime, ports, networkPolicy, timeout, env })`, y sus tipos de error (`APIError`, `StreamError`) que se aplanan en campos de log |
| **`@ai-sdk/react`** | `useChat` en el cliente: consume los *data parts* tipados del stream, maneja `resumeStream()` para reconectar al progreso de cobertura y renderiza las partes de herramienta |

### Autenticación — better-auth

Instancia local, **solo correo y contraseña**. Sin SSO, sin captcha, sin envío de correos, sin *haveibeenpwned*: crear cuenta e iniciar sesión funcionan **100% offline** contra los contenedores propios del repo.

- Dos roles reales (`VENDOR_CONTACT`, `COMPLIANCE_OFFICER`, más `ADMIN`), guardados como `additionalFields` en la fila de usuario junto con `organizationId` y `vendorId`.
- **`input: false` en cada campo adicional**: el rol y el vínculo con el tenant nunca son seteables desde el cliente — se asignan en el servidor al registrar.
- `disabledPaths: ["/sign-up/email"]`: el registro va por `/api/vendor/register`, que es quien asigna rol y tenant. El `auth.api.signUpEmail` interno sigue disponible para la semilla y los scripts.
- **Rate limiting activo en todos los modos** (la librería por defecto solo lo activa en producción) y telemetría explícitamente apagada.
- Habla con la base **solo** por su `drizzleAdapter(getDb())`; el código de la app nunca consulta las tablas de auth directamente.

### Base de datos — Drizzle ORM + Postgres 16

Este repositorio **es dueño de su esquema**. Nada de apuntar a una base ajena.

- El esquema vive en un solo archivo: `packages/db-vendor/drizzle/schema.ts`.
- Los cambios se generan con `drizzle-kit generate` y se aplican con el migrador programático de `drizzle-orm` (servicio `migrate` del compose). **Nunca `push`, nunca DDL a mano por psql.**
- **Toda interacción con la base pasa por Drizzle.** El *query builder* es la regla; el tag parametrizado `` sql`` `` se permite solo donde el builder no tiene equivalente (advisory locks, *merge* de hermanos jsonb, `NULLS LAST`). Nunca SQL armado con strings, nunca `sql.raw`, nunca un segundo cliente `pg`.
- Un solo cliente compartido en `packages/db-vendor/src/client.ts`.

### Almacenamiento — MinIO (compatible con S3)

Dos clientes S3 sobre un mismo bucket, y la razón es sutil: **SigV4 firma el host**.

- `storageClient` → operaciones del servidor contra el endpoint interno (`http://minio:9000`).
- `presignClient` → prefirma contra el endpoint que **el navegador** puede alcanzar (`http://localhost:9000`), y con `requestChecksumCalculation: "WHEN_REQUIRED"` (el default nuevo del SDK de AWS mete un checksum CRC32 de cuerpo vacío que una subida de navegador no puede satisfacer).

En AWS real basta con no definir los endpoints: la resolución por defecto toma el control, un solo camino de código.

### API y UI

| Pieza | Rol |
|---|---|
| **Next.js 16** (App Router) | Un solo servidor para las dos interfaces + todas las APIs. `runtime: "nodejs"`, `instrumentation.ts` para calentar el sandbox y arrancar el barrido |
| **React 19** | Componentes de servidor para las páginas, cliente para las superficies en vivo |
| **tRPC 11 + TanStack Query 5** | La superficie del oficial: tipos punta a punta, `superjson` como transformer, `complianceAdminProcedure` que valida rol y organización en el servidor (un no-oficial recibe `NOT_FOUND`, indistinguible de "no existe") |
| **Rutas SSE** | La superficie del proveedor: el streaming en vivo no cabe en tRPC, así que son rutas `/api/vendor/*` con `createUIMessageStream` |
| **Tailwind CSS 3** + `clsx` + `tailwind-merge` | Estilos, sin CDN ni fuentes externas |
| **AI Elements vendorizados** + **streamdown** | Render de partes de herramienta, razonamiento y markdown en streaming |
| **Zod 4** | La frontera de validación: entradas de las herramientas del host, cuerpos de las rutas, variables de entorno (vía `@t3-oss/env-nextjs`), y los esquemas de extracción cuyas descripciones son el prompt del modelo |

### Los motores puros — `@vendra/workflow`

Un paquete con **cero** imports de `ai`, de proveedores o de red, por contrato. Ahí vive todo lo que decide: catálogo de documentos, esquemas de extracción, validadores, mapa documento→categoría, matemática de la compuerta de activación, trazabilidad de requisitos, comparación difusa de nombres de entidad y el núcleo de la determinación de cobertura. Es puro y con el `now` inyectado, así el barrido de vencimientos puede evaluarlo como simple aritmética.

### Qué NO usa Vendra: mem0 y Qdrant

Vale la pena decirlo explícitamente, porque suele preguntarse:

> **mem0 y Qdrant no están en el código de la aplicación.** No aparecen en `package.json`, no hay contenedor para ellos y no hay ningún import. Existen únicamente como *skills* de referencia para el entorno de desarrollo, en `.claude/skills/`.

La razón es la regla de dependencias del proyecto: **el conjunto de dependencias externas es exactamente dos — la API de Anthropic y Vercel Sandbox**, ambas de solo egreso. Todo lo demás corre en contenedores propios. Eso descarta de plano mem0 Platform (nube) y Qdrant Cloud, que son servicios externos. Y hay una razón técnica encima: una memoria vectorial necesita un modelo de *embeddings*, y Anthropic no publica una API de embeddings — traer un proveedor de embeddings sería agregar una tercera dependencia externa.

Por eso la memoria del asistente se implementó **con la forma de la frontera, pero sobre Postgres**: `recallMemory` / `rememberFacts`, con topes, deduplicación, poda y falla suave. Si algún día se adopta un motor vectorial, tendría que ser **autohospedado** (mem0 OSS con `MEM0_TELEMETRY=false`, o Qdrant self-hosted) y reemplazaría el almacenamiento **sin tocar a los llamadores**: `server/assistant/memory.ts` es exactamente esa costura.

---

## 9. Versiones exactas

Runtime: **Node ≥ 22.10** · gestor de paquetes: **pnpm 10.4.1** · workspace de 3 paquetes.

### Aplicación (`apps/vendra`)

| Paquete | Versión | Para qué |
|---|---|---|
| `next` | **16.3.1** | Framework y servidor |
| `react` / `react-dom` | **19.2.8** | UI |
| `typescript` | **7.0.2** | Tipos (gate: `pnpm --filter vendra type-check`) |
| `ai` | **7.0.67** | Núcleo del AI SDK v7 |
| `@ai-sdk/harness` | **1.0.74** | `HarnessAgent` |
| `@ai-sdk/harness-claude-code` | **1.0.77** | Adaptador Claude Code |
| `@ai-sdk/sandbox-vercel` | **1.0.74** | Proveedor de sandbox |
| `@ai-sdk/react` | **4.0.70** | `useChat` |
| `@vercel/sandbox` | **2.9.2** | SDK de la MicroVM |
| `better-auth` | **1.7.1** | Autenticación |
| `drizzle-orm` | **0.45.2** | ORM |
| `pg` | **8.23.0** | Driver de Postgres |
| `@trpc/server` · `@trpc/client` · `@trpc/tanstack-react-query` | **11.x** (11.18.0) | API tipada del oficial |
| `@tanstack/react-query` | **5.101.4** | Caché de datos en el cliente |
| `zod` | **4.4.3** | Validación de esquemas |
| `@aws-sdk/client-s3` · `@aws-sdk/s3-request-presigner` | **3.x** | Almacenamiento y URLs prefirmadas |
| `tailwindcss` | **3.4.x** | Estilos |
| `streamdown` | **2.5.0** | Markdown en streaming |
| `@radix-ui/react-collapsible` | **1.1.x** | Primitiva de los elementos de IA |
| `lucide-react` | **1.32.x** | Iconos |
| `superjson` | **2.2.x** | Transformer de tRPC |
| `@t3-oss/env-nextjs` | **0.13.11** | Env tipado y validado |
| `use-stick-to-bottom` | **1.1.x** | Autoscroll del chat |
| `tsx` | **4.20.x** | Scripts (migrar, sembrar, crear cuentas) |

### Paquetes del workspace

| Paquete | Dependencias | Rol |
|---|---|---|
| `@vendra/db-vendor` | `drizzle-orm` 0.45.2, `pg` 8.23.0, `drizzle-kit` **0.31.10** (dev) | Esquema, migraciones, cliente y migrador |
| `@vendra/workflow` | **solo** `zod` ^4.4.3 | Motores puros — la lista corta de dependencias es la garantía |

### Infraestructura

| Componente | Versión / imagen | Puertos |
|---|---|---|
| Postgres | `postgres:16` | 5436 → 5432 |
| MinIO | `minio/minio:latest` | 9000 (API), 9001 (consola) |
| App | build multi-etapa, runner *distroless* | 3000 |
| Modelo por defecto | `claude-sonnet-4-6` (`HARNESS_MODEL`) | — |
| Runtime del sandbox | `node24` | bridge 4000–4003 |

---

## 10. Modelo de datos

Todo en la base propia de la app (`vendra`), definido en `packages/db-vendor/drizzle/schema.ts`.

| Tabla | Contenido |
|---|---|
| `organization` | El comprador (tenant). El `slug` es display/ruteo — **nunca** una entrada de permisos |
| `vendor_requirement_profile` | Qué exige ese comprador: categorías requeridas, obligatorias, descartables, umbrales (jsonb) |
| `vendor` | El proveedor: nombre legal, DBA, últimos 4 del identificador tributario, perfil de trabajo (jsonb), categorías descartadas, estado de cumplimiento, metadata (jsonb: determinación de cobertura, overrides, reintentos), próxima expiración denormalizada |
| `vendor_document` | Un archivo subido: estado (transicionado por CAS), llave en el almacén, metadata del archivo, tipo resuelto, fecha de expiración extraída |
| `vendor_document_extraction` | **Append-only**: una versión por clasificación. Reclasificar inserta `version+1`, jamás muta. Guarda tipo, confianza, razonamiento, datos extraídos (con el TIN ya enmascarado), reglas de validación, categorías otorgadas y la dispensa |
| `manual_requirement_grant` | Otorgamientos manuales del oficial, con índice parcial único: **un solo otorgamiento activo** por (documento, categoría) |
| `vendor_activity` | La bitácora: 15 tipos de evento, actor, documento, metadata |
| `vendor_status_transition` | Cada cambio de estado con su origen (`gate` / `officer_decision` / `sweep`) |
| `document_confirmation` | Las ventanas HITL durables: pregunta, entidad, respuesta por defecto, vencimiento, resultado |
| `renewal_notification` | Avisos de renovación a 30/14/1 día, únicos por (proveedor, categoría, horizonte, vencimiento) |
| `api_check_evidence` | Evidencia de verificaciones automáticas |
| `assistant_chat_turn` | El chat: transcripción, estado de reanudación del harness y hechos de memoria, en tres espacios de nombres por `thread_id` |
| `user` · `session` · `account` · `verification` | Tablas de better-auth, en la misma base. La app nunca las consulta directo |

Cambiar el esquema:

```bash
# 1. edite packages/db-vendor/drizzle/schema.ts
pnpm --filter @vendra/db-vendor generate   # 2. genera SQL + journal + snapshot
# 3. commitee el trío generado junto con el cambio de schema.ts
```

Los archivos bajo `drizzle/` son artefactos de solo lectura. El servicio `migrate` del compose únicamente **aplica** migraciones ya commiteadas.

---

## 11. Seguridad y privacidad

- **PII:** los identificadores tributarios completos y los números de cuenta bancaria nunca se piden, nunca se guardan, y se vuelven a enmascarar al momento de persistir (defensa en profundidad). El texto de justificación del oficial nunca se registra en logs (solo su largo).
- **Aislamiento del agente:** lista blanca de herramientas (`activeTools`), `permissionMode: "allow-reads"`, egreso denegado por defecto salvo dos hosts, y el documento montado en un directorio de trabajo por sesión.
- **Inyección de prompt:** el contenido de documentos y los hechos recordados se declaran como contexto, no instrucciones; el marcado se sanitiza al escribir y al inyectar.
- **Autorización:** cada ruta y cada procedimiento resuelve la sesión en el servidor. El rol y el tenant nunca vienen del cliente. Un no-oficial recibe `NOT_FOUND`, no `FORBIDDEN` (no filtra existencia).
- **Alcances acotados en el servidor:** una dispensa por desajuste de nombre no puede, por construcción, dispensar la identidad fiscal.
- **Secretos:** las cuatro llaves remotas viven solo en el entorno; nunca en código, commits, logs ni respuestas.

---

## 12. Desarrollo local sin Docker

Requisitos: Node ≥ 22.10, pnpm 10.4.1, y Docker solo para Postgres y MinIO.

```bash
nvm use 22
pnpm install
docker compose up -d postgres minio minio-init

# cree apps/vendra/.env.local con las mismas llaves que .env.docker, pero:
#   VENDOR_DATABASE_URL=postgresql://vendor:vendor@localhost:5436/vendra
#   S3_ENDPOINT_URL=http://localhost:9000
#   (S3_PUBLIC_ENDPOINT_URL puede omitirse — cae de vuelta a S3_ENDPOINT_URL)

pnpm --filter vendra migrate     # aplica migraciones + siembra la demo
pnpm --filter vendra dev         # http://localhost:3000
pnpm -r type-check               # gate de tipos
pnpm --filter vendra build       # gate de build
```

Crear cuentas de prueba (proveedores u oficiales) a demanda:

```bash
pnpm --filter vendra create-account
```

---

## 13. Solución de problemas

| Síntoma | Causa / arreglo |
|---|---|
| El PUT prefirmado falla desde el navegador | `S3_PUBLIC_ENDPOINT_URL` mal configurado — SigV4 firma el host, así que el endpoint de prefirma debe ser el que **el navegador** alcanza (`http://localhost:9000` en compose) |
| `/process` devuelve 503 nombrando llaves faltantes | La guardia de credenciales del harness — complete las cuatro llaves en `.env.docker` y `docker compose up -d app` |
| Documentos atascados en `PROCESSING` ~25 min y luego `FAILED` | El conserje funcionando como debe (una corrida huérfana, por ejemplo si la app se reinició). Use "Intentar de nuevo" |
| La creación del sandbox falla con `402 payment_required` | Cuota de sandbox del equipo en Vercel — use un token con alcance de equipo en un plan pagado, u otro equipo |
| Error 4xx del modelo nombrando el modelo | La llave de Anthropic no tiene acceso a `HARNESS_MODEL` (habilitación, no credenciales). Elija un modelo que su llave pueda invocar |
| La cobertura queda "determinando" | Abra el proveedor en el panel del oficial — toda superficie del oficial dispara la determinación al verla; el portal también la dispara en su siguiente *poll* |
| `harness: unconfigured` en `/api/health` | Faltan una o más de las cuatro llaves remotas. La app funciona igual, pero los documentos quedan en cola |

---

## Estructura del repositorio

```
apps/vendra/               la app Next.js (ambas interfaces + APIs + harness)
  src/app/                   rutas: páginas y /api
  src/server/harness/        los carriles de documento y cobertura + el sandbox compartido
  src/server/assistant/      el asistente LLM (sesión, herramientas, memoria, prompt, store)
  src/server/trpc/           la API del oficial
  src/features/…/lib/vendor-harness-contract.ts   EL contrato compartido
  src/components/ai-elements/  primitivas de render vendorizadas
packages/workflow/         motores puros (catálogo, validadores, compuerta) — sin IA, sin IO
packages/db-vendor/        el esquema Drizzle propio + migraciones commiteadas
docker-compose.yml         postgres + minio + minio-init + migrate + app
.env.docker.example        la matriz completa de variables, documentada línea por línea
```

## Licencia

MIT — vea [LICENSE](LICENSE).
