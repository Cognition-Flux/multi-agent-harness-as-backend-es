# Vendra — incorporación y cumplimiento continuo de proveedores, adjudicados por IA y gobernados por personas

<p align="center">
  <img src="docs/landing/00-stack.svg" width="100%"
       alt="Diagrama animado del stack, cuatro capas encadenadas. Capa 1 — harness de documentos: un documento entra y recibe su propia sesión de Claude Code en una MicroVM, la barra avanza de «Etapa 1 de 8» a «Etapa 8 de 8», aparecen los campos extraídos y una confirmación humana espera con su ventana de 5 minutos. Capa 2 — asistente del proveedor: el asistente encadena sus herramientas y su memoria recorre la tubería mem0 → embeddings locales bge-m3 en Ollama → índice Qdrant, con Postgres como sistema de registro y toda escritura pasando por Drizzle. Capa 3 — adjudicación del oficial: el oficial de cumplimiento enciende sus cinco acciones de rescate una a una y el registro de auditoría gana una línea por cada una, con la firma del estado final aparte. Capa 4 — gobernanza de plataforma: una política Rego compilada a Wasm admite la configuración de la empresa y los dos carriles de agente —el harness de documentos y el chat del asistente— quedan redibujados como hijos de esa misma puerta.">
</p>

Antes de trabajar con un proveedor hay que revisar sus papeles: el seguro
vigente, el formulario tributario, las licencias del rubro. Normalmente eso son
semanas de correos, planillas y carpetas compartidas. En Vendra el proveedor sube
sus documentos y **cada uno es leído por su propio agente de IA**, que reconoce
qué documento es, saca los datos que importan y los compara con lo que su empresa
exige. La app **no aprueba a nadie**: arma el caso, dice exactamente qué falta y
lo pone sobre la mesa de la persona que decide — dejando constancia de quién
decidió qué, cuándo y con qué justificación.

El sistema son **cuatro capas**, las mismas cuatro del diagrama de arriba. Cada
una resuelve un problema por su cuenta y trae su propio stack; los nombres de
terceros van `en monoespaciada`.

### 1 · Harness de documentos — *suba el archivo y vea cómo se lee*

Cada documento que entra recibe **su propia sesión de agente**, aislada de las
demás, y usted la ve trabajar en vivo: en qué etapa va, qué está haciendo en esta
frase, qué herramienta acaba de llamar y qué datos ya extrajo. Si un dato queda
ambiguo, el agente **pregunta en lugar de adivinar** y la respuesta queda guardada
con el expediente. No hay un bucle de herramientas escrito a mano: el harness trae
el suyo, con su propio manejo de contexto y su historial de sesión.

> **Stack:** `@ai-sdk/harness` + `@ai-sdk/harness-claude-code` — el CLI de
> `Claude Code` como backend del agente · `@ai-sdk/sandbox-vercel` +
> `@vercel/sandbox` — una MicroVM por proveedor, con salida a internet en lista
> blanca · `ai` 7 (`createUIMessageStream`) y `@ai-sdk/react` (`useChat`) para el
> stream tipado · AI Elements vendorizados para pintarlo.

### 2 · Asistente del proveedor — *pregunte en lenguaje natural, no busque en el manual*

Un chat que **consulta el expediente real antes de responder** y recuerda lo
conversado en turnos anteriores, así que nadie tiene que repetir su caso. A «¿Qué
falta para poder activar mi cuenta?» contesta con lo que falta de verdad. Según lo
que cada empresa habilite, solo explica o además redacta propuestas de cambio para
que una persona las apruebe. Si el índice de memoria no responde, el chat sigue
funcionando con lo más reciente.

> **Stack:** `mem0ai/oss` para extraer y recuperar hechos (con `claude-haiku-4-5`
> haciendo la extracción) · `ollama` con `bge-m3` de 1024 dimensiones para los
> *embeddings*, en un contenedor propio · `@qdrant/js-client-rest` para el índice
> vectorial · `drizzle-orm` sobre Postgres 16 como sistema de registro — el índice
> es desechable y se reconstruye.

### 3 · Adjudicación del oficial — *la máquina prepara, la persona decide*

Ningún proveedor queda aprobado por el sistema solo. El oficial de cumplimiento
recibe el expediente ya armado y tiene cinco herramientas para destrabarlo —eximir
una validación, recategorizar, otorgar un requisito a mano, revocar y reintentar—;
las cuatro que **cambian el veredicto exigen una justificación escrita**, y las
cinco dejan su línea en el registro de auditoría con actor y hora. La firma del
estado final es una decisión aparte y deliberada: otorgar una categoría nunca
aprueba a un proveedor.

> **Stack:** `@vendra/workflow` — motores deterministas, sin IA y sin IO, que
> calculan validación, trazabilidad, cobertura y la compuerta de activación ·
> `drizzle-orm` + Postgres para que cada adjudicación sea atómica y el registro
> durable · `better-auth` para que toda acción quede firmada por un rol real y
> acotada a su empresa.

### 4 · Gobernanza de plataforma — *una sola regla, aplicada en todas partes*

Cada empresa declara **de antemano** qué documentos acepta, qué datos se extraen,
qué revisiones cuentan y hasta dónde puede decidir la máquina por su cuenta. Esa
declaración se revisa una vez, al activarla, y desde ahí se aplica igual en todos
lados: el mismo límite rige al agente que lee documentos y al chat del asistente,
y ninguno puede ampliárselo a sí mismo. Cambiar la regla es un cambio de versión,
no un parche.

> **Stack:** `Open Policy Agent` — políticas en `Rego` compiladas a `Wasm` y
> evaluadas **en proceso** con `@open-policy-agent/opa-wasm`, con el artefacto
> verificado por SHA-256 y fallando cerrado: si la puerta no puede decidir, no
> admite.

La versión técnica de las cuatro capas está aquí abajo.

<details>
<summary><b>Las cuatro capas, en detalle técnico</b></summary>

**1 · Un documento, un agente, una MicroVM.** El harness de Claude Code es el
backend: trae su propio ciclo de razonamiento, su manejo de contexto y su
historial de sesión, así que aquí nadie escribe el bucle de herramientas a mano
—ni existe una sola llamada a `generateText` o `streamText`—. Cada archivo
recibe su sesión (`HarnessAgent` + `createClaudeCode` + `createVercelSandbox` en
modo *wrap*) dentro de una MicroVM con `runtime node24`, cuatro puertos de puente
`4000–4003` y salida permitida solo a `api.anthropic.com` y `*.npmjs.org`. El
agente ve una lista blanca de cinco herramientas —`read` más
`saveClassification`, `saveExtraction`, `finalizeDocument` y `failDocument`— con
`permissionMode: "allow-reads"`: clasifica y extrae, nada más. El progreso llega
al navegador por `createUIMessageStream` + `toUIMessageStream` y se pinta con los
AI Elements vendorizados (`Tool`, `Reasoning`, `Task`). Y cuando el agente duda
de verdad, el host abre una ventana de confirmación durable de 5 minutos —no el
`toolApproval` del SDK, porque tiene que sobrevivir a una recarga— que al vencer
deja continuar el procesamiento.

**2 · El asistente que conoce el expediente.** Una sesión estacionada por hilo,
que se detiene con `session.stop()` y nunca con `detach()` —una sesión
desprendida se quedaría con su puerto y mataría de hambre al grupo de cuatro—.
Cinco herramientas del host, y la política de la empresa decide si el modelo ve
tres o cinco: `activeTools` se recalcula en cada arriendo. La memoria corre
entera en contenedores propios: mem0 OSS extrae hechos con
`claude-haiku-4-5-20251001`, los *embeddings* son `bge-m3` de 1024 dimensiones en
Ollama y el índice es la colección Qdrant `vendra_assistant_memory`; Postgres es
el sistema de registro —y toda escritura pasa por Drizzle—, así que el índice se
puede tirar y reconstruir. Un
drenaje cada 20 s hace el trabajo pesado para que ningún turno espere a un LLM, y
el recuerdo corre en cada turno: 30 candidatos por ámbito → 20 hechos / 2.000
caracteres. Si el índice no responde, degrada a recencia.

**3 · La compuerta humana.** Cuando el motor determinista se detiene, el oficial
de cumplimiento tiene cinco acciones —«Eximir de la validación», «Recategorizar
documento», «Otorgar requisito manualmente», revocar y «Reintentar
procesamiento»—. Las cuatro que cambian el veredicto exigen una justificación
escrita; las cinco dejan su línea en el registro de auditoría, con actor y hora.
El servidor recorta el alcance de cada exención: un desajuste de nombre jamás
puede eximir la identidad fiscal. Y la firma final, «Finalizar estado de
cumplimiento», es una decisión aparte: otorgar una categoría nunca aprueba a un
proveedor.

**4 · Una sola puerta para todo lo agéntico.** Cada empresa declara qué puede
decidir la máquina: qué documentos se aceptan, qué campos se extraen —los
estructurales quedan bloqueados—, qué validaciones cuentan, qué categorías se
aprueban solas y qué puede hacer el asistente. Una política Rego compilada a
Wasm **admite** esa configuración —en proceso, verificada por SHA-256, fallando
cerrado, con 13 reglas de rechazo y 2 advertencias, y solo en los momentos de
gobernanza—, y los motores deterministas la **aplican** en cada documento y en
cada turno. De ahí bajan los dos carriles agénticos, redibujados como hijos de la
misma puerta: el harness de documentos (tipos, campos, validaciones y el límite
del árbitro) y el chat del asistente (`activeTools` = 3 o 5). El carril de
cobertura no se configura por política — y su veredicto tampoco puede otorgar
saltándose al árbitro.

</details>

Un proveedor sube sus documentos de cumplimiento —certificados de seguro,
formularios tributarios, licencias, pólizas— y **cada archivo recibe su propia
sesión de Claude Code dentro de una MicroVM aislada, transmitida en vivo al
navegador**. El agente hace exactamente dos cosas: clasificar y extraer. Todo lo
que *decide* —validación, trazabilidad de requisitos, matemática de cobertura, la
compuerta de activación— es código determinista del servidor. Y lo que exige
criterio queda en manos de personas: el proveedor responde por su propia
estructura societaria, un oficial de cumplimiento adjudica el expediente, y un
administrador de plataforma define **de antemano** qué puede aprobar el sistema
por su cuenta.

De un vistazo:

| | |
|---|---|
| **Roles** | contacto del proveedor · oficial de cumplimiento · administrador de plataforma |
| **Superficies** | portal del proveedor · panel del oficial · consola de plataforma · asistente con memoria (y la página pública en `/`) |
| **Carriles de agente** | uno por documento · uno de cobertura por proveedor · el chat del asistente — los tres sobre una sola MicroVM de `@vercel/sandbox` |
| **Puntos donde decide un humano** | confirmación del proveedor · adjudicación del oficial · derivación por política · propuesta de directiva |
| **Motores deterministas** | `@vendra/workflow`: 16 tipos de documento, 11 categorías de requisitos, 11 validadores, cobertura apilada, compuerta de activación — sin IA y sin IO |
| **Gobernanza** | política por empresa versionada, admitida por una puerta de `Open Policy Agent` (`Rego` → `Wasm`) evaluada en proceso con `@open-policy-agent/opa-wasm` |
| **Dependencias externas** | exactamente dos: la API de `Anthropic` y `Vercel Sandbox`. El resto —Postgres, MinIO, `Qdrant`, `Ollama`— corre en contenedores de este repositorio |

## Índice

- [**El producto en funcionamiento**](#el-producto-en-funcionamiento) — el sistema trabajando, en trece bloques

1. [¿Qué hace esta app? (explicación para principiantes)](#1-qué-hace-esta-app-explicación-para-principiantes)
2. [Arranque rápido y cómo probar la app](#2-arranque-rápido-y-cómo-probar-la-app)
3. [La idea central: *harness* como backend](#3-la-idea-central-harness-como-backend)
4. [**Dónde decide una persona: los cuatro puntos HITL**](#4-dónde-decide-una-persona-los-cuatro-puntos-hitl)
5. [Carril 1 — el pipeline por documento](#5-carril-1--el-pipeline-por-documento)
6. [Carril 2 — la determinación de cobertura](#6-carril-2--la-determinación-de-cobertura)
7. [Carril 3 — el asistente del proveedor y su memoria](#7-carril-3--el-asistente-del-proveedor-y-su-memoria)
8. [**La gobernanza: la política de cada empresa y la puerta OPA**](#8-la-gobernanza-la-política-de-cada-empresa-y-la-puerta-opa)
9. [Arquitectura completa](#9-arquitectura-completa)
10. [El rol de cada pieza del stack](#10-el-rol-de-cada-pieza-del-stack)
11. [Versiones exactas](#11-versiones-exactas)
12. [Modelo de datos](#12-modelo-de-datos)
13. [Seguridad y privacidad](#13-seguridad-y-privacidad)
14. [Desarrollo local sin Docker](#14-desarrollo-local-sin-docker)
15. [Solución de problemas](#15-solución-de-problemas)

---

## El producto en funcionamiento

Antes de la explicación, la evidencia. Lo que sigue son trece bloques que
muestran el sistema trabajando: un documento leído etapa por etapa, una umbrella
apilándose sobre la póliza primaria, el agente deteniéndose a preguntar, las
cuatro superficies del producto, el asistente encadenando herramientas, el kit
de rescate del oficial escribiendo su rastro de auditoría, y una empresa
configurándose antes de recibir su primer archivo.

> **De dónde salen estas piezas.** Siete son grabaciones de navegador de las
> demostraciones que la propia app publica en su portada (`/`): miniaturas
> fieles de cada superficie, con los textos de comportamiento —mensajes de
> etapa, preguntas HITL, títulos de diálogo, etiquetas de herramienta,
> veredictos— tomados de los módulos reales del portal, del panel del oficial,
> de la consola de plataforma y del asistente. **No son grabaciones de una
> sesión en vivo con documentos reales**, y un puñado de cadenas son
> adaptaciones tipográficas o gramaticales de la plantilla del producto. Las
> piezas restantes no son grabaciones: cinco son vector construido a mano para
> este archivo (dos de ellas animadas por CSS) y dos son diagramas Mermaid.
> Seis de las grabaciones duran exactamente un ciclo del demo que retratan
> —8 600 ms el documento, 6 000 ms la cobertura apilada, 8 100 ms el HITL,
> 11 200 ms el asistente, 11 500 ms las acciones del oficial y 11 700 ms la
> gobernanza—, así que el ciclo cierra sin salto. La séptima, el recorrido por
> las cuatro superficies, no tiene ciclo propio: esas pestañas solo cambian al
> hacer clic, así que son 12 000 ms de recorrido guionado, 3 000 ms por
> pestaña. Todas hacen bucle infinito. Todo es archivo local del repositorio:
> ni tipografías, ni iconos, ni imágenes de terceros.

### Las rutas y quién entra a cada una

La app es un solo servidor Next.js que sirve las cuatro superficies. La ruta `/`
resuelve la sesión en el servidor y decide: quien no ha iniciado sesión ve la
página pública; un contacto de proveedor aterriza en su portal, un oficial en el
directorio y un administrador de plataforma en la consola.

| Ruta | Quién entra | Qué hace ahí |
|---|---|---|
| `/` | cualquiera | la página pública con las demostraciones; ya autenticado, redirige al panel del rol |
| `/register` | un proveedor nuevo (público) | alta de un proveedor: razón social, nombre del contacto, correo y contraseña |
| `/login` | los tres roles | correo y contraseña, resueltos en el servidor |
| `/portal` | contacto del proveedor | subir documentos, ver los agentes trabajar, responder confirmaciones, activar la cuenta, conversar con el asistente |
| `/vendors` · `/vendors/{uuid}` | oficial de cumplimiento | directorio por próximo vencimiento y el expediente completo con el kit de rescate |
| `/platform` · `/platform/{uuid}` | administrador de plataforma | crear empresas, crear cuentas de oficial y configurar la política de cada empresa |

No existe registro público para el oficial ni para el administrador de
plataforma: esas cuentas se crean desde la consola o por script ([§2.4](#24-crear-más-cuentas-y-más-empresas)).

### Del documento a la activación, en cuatro pasos

**Del documento a la activación, sin cajas negras.** La IA trabaja a la vista y
las decisiones son de código determinista y de personas.

```mermaid
flowchart LR
  A["1 · Suba sus documentos"] --> B["2 · Un agente por documento"]
  B --> C["3 · El motor determinista decide"]
  C --> D["4 · Una persona adjudica"]
```

| Paso | Qué ocurre |
|---|---|
| **Suba sus documentos** | Arrastre COIs, W-9, licencias y pólizas — PNG, JPEG, WebP o PDF de hasta 10 MB, con carga múltiple y reintentos. |
| **Un agente por documento** | Cada archivo recibe su propia sesión de Claude en una MicroVM aislada, transmitida en vivo: clasificación, extracción y razonamiento a la vista. |
| **El motor determinista decide** | Validación, trazabilidad de requisitos y matemática de cobertura son código puro y reproducible — la IA nunca aprueba por sí sola. |
| **Una persona adjudica** | Exenciones, otorgamientos, revocaciones y la decisión final quedan en manos de su oficial de cumplimiento, con auditoría inmutable. |

### Un documento, ocho etapas, en vivo

<p align="center">
  <a href="docs/landing/01-hero-documento.webp">
    <img src="docs/landing/01-hero-documento.webp" width="100%"
         alt="La tarjeta de un documento recorre las ocho etapas de revisión de un certificado ACORD 25: la barra avanza de «Etapa 2 de 8» a «Revisión completada», el agente narra cada etapa y al cerrar aparecen los campos extraídos —asegurado, límite por ocurrencia, asegurado adicional y fecha de vencimiento— junto al requisito que el documento acredita.">
  </a>
</p>

<p align="center">
  <sub>
    <b>Cumplimiento de proveedores, revisado en vivo por agentes de IA.</b><br>
    Esta es la unidad de trabajo del sistema: un archivo, un agente, ocho etapas transmitidas al
    navegador —<code>leyendo → analizando → clasificando → extrayendo → guardando → validando →
    mapeando → finalizando</code>— y, al cerrar, los campos que el agente extrajo junto al requisito
    que acreditan. Las dos fichas flotantes recogen los dos momentos que definen al producto: la
    pregunta HITL con su cuenta regresiva de 5 minutos y la cobertura efectiva de $2.000.000 una vez
    apiladas la póliza primaria y la umbrella. La tesis del sistema cabe en seis palabras —
    <b>Adjudicación por IA · gobernada por personas</b>.
  </sub>
</p>

### El catálogo real, en cifras

<p align="center">
  <img src="docs/landing/02-cifras.svg" width="100%"
       alt="Cuatro contadores que suben desde cero hasta sus valores finales: 16 tipos de documento, 11 categorías de requisitos, 8 etapas de revisión en vivo y 7 estados de cumplimiento.">
</p>

<p align="center">
  <sub>
    Las cuatro cifras corresponden al catálogo real y están verificadas contra la fuente:
    <b>16 tipos de documento</b> (los títulos del catálogo, sin el cubo de rechazo <code>UNKNOWN</code>),
    <b>11 categorías de requisitos</b> (con trazabilidad documento a documento), <b>8 etapas de revisión
    en vivo</b> (transmitidas a su navegador) y <b>7 estados de cumplimiento</b> (de «No iniciado» a
    «Aprobado», más «Rechazado» y «Vencido»).
  </sub>
</p>

### Los 16 tipos que el clasificador reconoce

<p align="center">
  <img src="docs/landing/03-tipos-documento.svg" width="100%"
       alt="Marquesina que desplaza los dieciséis tipos de documento aceptados, desde el Certificado de seguro (ACORD 25) hasta el Acuerdo de confidencialidad firmado.">
</p>

El catálogo tiene 17 entradas: estos 16 tipos más `UNKNOWN`, el terminal del
clasificador para «no es ninguno de estos». Cada empresa elige, de los 16, cuáles
acepta; el proveedor solo puede subir la intersección de lo que su empresa acepta
con lo que su perfil de requisitos exige.

<details>
<summary><b>Los dieciséis tipos que el catálogo acepta</b></summary>

Certificado de seguro (ACORD 25) · Página de declaraciones de la póliza de seguro ·
Póliza umbrella / de exceso de responsabilidad · Formulario W-9 del IRS ·
Formulario W-8BEN-E del IRS · Licencia comercial · Certificación de diversidad ·
Carta de EMR (tasa de modificación por experiencia) · Resumen del Formulario 300A de OSHA ·
Informe SOC 2 · Certificado ISO 27001 · Póliza de responsabilidad cibernética ·
Carta de verificación bancaria · Cheque anulado · Contrato marco de servicios firmado ·
Acuerdo de confidencialidad firmado

</details>

### Los casos difíciles: la cobertura que se apila y la duda que se pregunta

**Los casos difíciles, manejados a la vista.** Pólizas que se apilan,
certificados a nombre de la filial, credenciales que vencen y preguntas que
merecen un humano — así se ven en Vendra, mientras suceden.

<table>
  <tr>
    <td width="50%" valign="top" align="center">
      <a href="docs/landing/04-cobertura-apilada.webp">
        <img src="docs/landing/04-cobertura-apilada.webp" width="100%"
             alt="Una póliza umbrella se apila sobre la primaria: la barra crece del millón al segundo millón y la cobertura efectiva pasa de $1.000.000 a $2.000.000, alcanzando el límite exigido.">
      </a>
    </td>
    <td width="50%" valign="top" align="center">
      <a href="docs/landing/05-hitl-cuenta-regresiva.webp">
        <img src="docs/landing/05-hitl-cuenta-regresiva.webp" width="100%"
             alt="El agente detiene el procesamiento y pregunta si aplica un endoso general de asegurado adicional; la barra de cuenta regresiva se vacía mientras esperan los botones Sí y No.">
      </a>
    </td>
  </tr>
  <tr>
    <td valign="top" align="center">
      <sub>
        <b>La cobertura se apila</b><br>
        Un certificado rara vez alcanza solo. El carril de cobertura lee las pólizas juntas y reporta,
        por línea, el límite efectivo y quién aportó cuánto: el host re-deriva cada cifra de las
        contribuciones — un payload incoherente rebota al agente antes de persistir.
      </sub>
    </td>
    <td valign="top" align="center">
      <sub>
        <b>La duda se pregunta</b><br>
        Humano en el circuito: ventanas de confirmación durables con cuenta regresiva. El agente solo
        puede preguntar tres cosas, y la ventana sobrevive a que usted recargue la página — la duda
        genuina se pregunta, no se adivina.
      </sub>
    </td>
  </tr>
</table>

Otros dos comportamientos del mismo motor, sin captura pero con el mismo peso:

- **Falla acotada:** un certificado a nombre de la filial no acredita identidad, pero sus límites sí cuentan —la tarjeta lo marca **Contado · cobertura**— y el oficial puede eximir solo lo que la falla bloquea.
- **Cumplimiento continuo:** aviso de renovación a 30 días, la expiración pasa APROBADO→VENCIDO sola y una renovación válida restaura la aprobación.

### Cuatro superficies, un mismo expediente

<p align="center">
  <a href="docs/landing/06-paneles.webp">
    <img src="docs/landing/06-paneles.webp" width="100%"
         alt="Recorrido por las cuatro superficies de la plataforma: la píldora oscura salta de «Portal del proveedor» a «Panel del oficial», luego a «Consola de gobernanza» y a «Asistente con memoria», y en cada salto el panel se cruza en fundido y el texto de la derecha cambia con él. Cada superficie llega con su demo ya corriendo: la zona de carga con tres documentos en distintos estados y la lista de requisitos avanzando; el directorio de proveedores ordenado por próximo vencimiento con una decisión esperando; la política de la empresa con su poder de árbitro por categoría y el botón de activación; y el chat del asistente escribiendo su pregunta.">
  </a>
</p>

**Una plataforma, cuatro superficies.** Proveedores, oficiales de cumplimiento y
administradores de plataforma trabajan sobre el mismo expediente — cada uno con
su propio panel. En el portal, el botón de activación **es** el contador de lo que
falta: solo cuando la compuerta se despeja dice **Activar cuenta de proveedor**.
En el panel del oficial, una categoría que la política retuvo dice
**Esperando su decisión** hasta que una persona la ratifique — y al proveedor,
sobre esa misma categoría, el portal le dice que **no necesita hacer nada más.**

<details>
<summary><b>Portal del proveedor</b> — Incorporación con agentes a la vista</summary>

El proveedor arrastra sus documentos y ve trabajar a cada agente en vivo, con la lista de requisitos y la puerta de activación siempre al lado.

- Zona de carga con verificación en vivo: barra «Etapa X de 8», narración del agente y razonamiento visible.
- Confirmaciones humano-en-el-circuito con cuenta regresiva cuando el agente duda de verdad.
- Lista de requisitos del perfil del proveedor con medidor de avance, descartes «No aplica» y aviso de renovación a 30 días.
- Activación con compuerta determinista: el botón explica exactamente qué falta para habilitarse.

</details>

<details>
<summary><b>Panel del oficial</b> — Adjudicación con herramientas de rescate</summary>

Un directorio ordenado por próximo vencimiento y un expediente por proveedor con todo el kit: eximir, recategorizar, otorgar, revocar y reintentar.

- Directorio con búsqueda, filtros por estado y auto-refresco cada 15 s — lo próximo a vencer, primero.
- Trazabilidad de requisitos: qué documento otorga cada categoría, cuál falló y por qué regla.
- Exenciones acotadas con vencimiento y justificación obligatoria que queda en el registro de auditoría.
- Determinación de cobertura por línea de póliza: límites efectivos contra los exigidos, en vivo.

</details>

<details>
<summary><b>Consola de gobernanza</b> — Administración de políticas del agente</summary>

Cada empresa define qué documentos acepta, qué campos se extraen, qué validaciones cuentan y qué puede aprobar el sistema sin una persona.

- Poder de árbitro por categoría: «El sistema decide» o «Un oficial debe aprobarla» — la frontera exacta de la IA.
- Puerta de admisibilidad OPA compilada a Wasm y evaluada localmente antes de activar cualquier política.
- Versionado borrador → activa → archivada, con anclaje por proveedor: a nadie se le cambian las reglas a mitad del proceso.
- Propuestas del asistente delegado revisadas por humanos: nada se aplica sin aprobación explícita.

</details>

<details>
<summary><b>Asistente con memoria</b> — Un asistente que conoce el expediente</summary>

Chat en español con acceso al expediente de cumplimiento del proveedor y memoria semántica entre sesiones — todo autoalojado.

- Responde sobre cobertura, requisitos y vencimientos leyendo el expediente real, no un resumen.
- Memoria local y privada: mem0 OSS + Qdrant + Ollama en contenedores propios, con PII redactada antes de almacenar.
- Dos niveles de privilegio: «Conversacional — solo explica» o «Delegado — puede proponer directivas».
- Si el índice no responde, degrada a recencia: el asistente nunca se cae con su memoria.

</details>

### El asistente resuelve una pregunta difícil en un turno

<p align="center">
  <a href="docs/landing/07-asistente-herramientas.webp">
    <img src="docs/landing/07-asistente-herramientas.webp" width="100%"
         alt="El asistente responde «¿Qué falta para poder activar mi cuenta?» encadenando cuatro herramientas —consultar el expediente, revisar un documento, tomar nota y redactar una propuesta—, transmite la respuesta token a token y deja una propuesta de directiva pendiente en la consola de gobernanza.">
  </a>
</p>

<p align="center">
  <sub>
    <b>Una pregunta difícil, resuelta en un solo turno.</b><br>
    El proveedor pregunta en español. El asistente lee el expediente real, abre el documento que falló,
    deja una nota para la próxima vez y redacta una propuesta de directiva que solo una persona puede
    aprobar.
  </sub>
</p>

- Cuatro herramientas encadenadas en el mismo turno: consultar el expediente, revisar un documento, tomar nota y redactar una propuesta. Hay una quinta —consultar el estado de sus propias propuestas— que esta escena no muestra.
- El razonamiento del modelo queda a la vista, plegado — se abre cuando usted quiere verlo, y el texto llega transmitido token a token.
- Memoria semántica local: mem0 OSS, Qdrant y Ollama en contenedores propios, con la PII redactada antes de almacenar.
- En el nivel «Delegado — puede proponer directivas» la propuesta aterriza en la consola de gobernanza, bajo **Propuestas del asistente**, y espera una decisión humana.

### El kit de rescate del oficial

<p align="center">
  <a href="docs/landing/08-acciones-oficial.webp">
    <img src="docs/landing/08-acciones-oficial.webp" width="100%"
         alt="El expediente de Beta Logística Ltda. en la pestaña «Documentos»: las cinco acciones de rescate se encienden una a una y las cuatro que cambian el veredicto abren su diálogo — «Eximir de la validación», acotado a la categoría que la falla bloquea y con la fecha en que la exención vence; «Recategorizar documento», que vuelve a validar bajo el nuevo tipo; «Otorgar requisito manualmente», con su justificación escrita; la revocación, en rojo, advirtiendo que la cobertura se recalcula de inmediato; y el reintento del procesamiento, que no abre diálogo y devuelve el documento a la cola. El archivo sobre el que se actúa cambia con cada acción, el registro «Actividad» gana una línea cada vez, y el ciclo cierra con las cinco líneas asentadas junto al bloque «Finalizar estado de cumplimiento» y sus cuatro estados.">
  </a>
</p>

<p align="center">
  <sub>
    <b>Cinco acciones de rescate, cada una con su rastro.</b><br>
    Cuando el motor determinista se detiene, su oficial de cumplimiento tiene herramientas — y cada una
    escribe su propia línea en el registro de auditoría antes de tocar nada. Son cinco demostraciones
    sobre el mismo expediente, no una cadena causal: otorgar una categoría nunca aprueba a un
    proveedor, y por eso el estado final llega aparte, al final.
  </sub>
</p>

- Eximir, recategorizar, otorgar, revocar y reintentar: el kit completo sobre el documento, sin salir del expediente del proveedor.
- Las cuatro acciones que cambian el veredicto exigen una justificación escrita; las cinco dejan su línea en el registro de auditoría — no hay atajos silenciosos.
- El servidor vuelve a acotar el alcance de cada exención: una falla nunca puede eximir más de lo que realmente bloquea.
- El estado final es una decisión aparte y explícita: **Otorgar requisito manualmente** cierra una categoría, no aprueba al proveedor.

### La gobernanza: la empresa se configura antes del primer archivo

<p align="center">
  <a href="docs/landing/09-gobernanza.webp">
    <img src="docs/landing/09-gobernanza.webp" width="100%"
         alt="La consola de plataforma de Acme Constructora SpA configura la empresa paso a paso, y el riel de la izquierda va pasando de «sin definir» a resuelto: el diálogo «Añadir oficial de cumplimiento» crea la primera cuenta que puede revisar proveedores —y solo los de esta empresa—, se elige el privilegio «Delegado — puede proponer directivas» para el asistente del proveedor, se despliega un tipo de documento con sus campos estructurales marcados «obligatorio» y se enciende una validación más (de 4/7 a 5/7 checks), y se fija qué categorías puede aprobar el sistema por su cuenta y cuál exige a un oficial. El ciclo cierra en el veredicto de la puerta de admisibilidad OPA: dos advertencias listadas y, recién entonces, los botones Validar, Guardar borrador y «Activar política…».">
  </a>
</p>

<p align="center">
  <sub>
    <b>Roles y políticas, configurados a la vista.</b><br>
    Cada empresa define quién revisa, qué puede hacer el asistente, qué documentos se aceptan y qué
    requisitos aprueba el sistema por su cuenta — todo antes de que un proveedor suba su primer
    archivo. La escena se detiene justo antes de activar: activar versiona la política
    (borrador → activa → archivada) y ancla a cada proveedor a la versión bajo la que se le juzga.
  </sub>
</p>

- Cuentas de oficial creadas desde la consola, con alcance exacto a una empresa y a ninguna otra.
- Dos niveles de privilegio para el asistente del proveedor: solo explicar, o proponer cambios que una persona aprueba.
- Por tipo de documento: qué campos se extraen —con los estructurales bloqueados— y qué validaciones cuentan de verdad.
- Poder de árbitro por categoría, y una puerta de admisibilidad OPA que revisa la configuración antes de dejar activarla.
- Al activar, **Aplicar también a los** proveedores existentes es una casilla opcional: por defecto la política nueva rige solo para quien llegue después. Y **Reevaluar políticas activas** vuelve a pasar la puerta sobre todas las políticas vigentes, para que una mejora del motor no deje una configuración vieja en pie sin revisar.

### Las seis capas del producto

**Capas que se gobiernan entre sí.** Agentes que trabajan, reglas que deciden,
personas que aprueban — y todo queda registrado.

<p align="center">
  <img src="docs/landing/10-bento.svg" width="100%"
       alt="Las seis funcionalidades en retícula: políticas del agente gobernadas por un gate OPA, documentos y extracción, memoria semántica local, humano en el circuito, auditoría inmutable y cumplimiento continuo.">
</p>

<details>
<summary><b>Las seis capas, una por una</b></summary>

| Capa | Qué cubre |
|---|---|
| **Políticas del agente, gobernadas** | Un gate OPA/Rego compilado a Wasm admite cada política antes de activarla: documentos aceptados, campos extraídos, validaciones que cuentan y qué categorías aprueba el sistema solo. |
| **Documentos y extracción** | 16 tipos de documento con campos estructurales bloqueados, identificadores fiscales siempre enmascarados y una versión de extracción por cada revisión. |
| **Memoria semántica local** | El asistente recuerda hechos entre sesiones con búsqueda semántica en español — mem0 OSS, Qdrant y Ollama, autoalojados. |
| **Humano en el circuito** | Confirmaciones con cuenta regresiva, derivaciones por política de empresa y propuestas de directivas que solo una persona puede aprobar. |
| **Auditoría inmutable** | Libro de actividad transaccional y trazabilidad por requisito: el artefacto que se le entrega a un auditor, siempre al día. |
| **Cumplimiento continuo** | El tiempo es un disparador de primera clase: expiración automática, aviso de renovación en el portal a 30 días y restauración sin fricción al renovar. |

</details>

### Dónde corre cada cosa

La inteligencia corre aislada, las decisiones son reproducibles y los datos no
salen de contenedores propios.

```mermaid
flowchart LR
  D["Documento"] --> A["Agente Claude · MicroVM"]
  A --> M["Motor determinista"]
  M --> O["🧑‍⚖️ Oficial de cumplimiento"]
```

| Garantía | Cómo se sostiene |
|---|---|
| **La IA nunca decide sola** | El agente solo clasifica y extrae. Validación, mapeo de requisitos, apilamiento de coberturas y compuertas de activación son código determinista: cada veredicto es reproducible. |
| **Agentes aislados y visibles** | Cada documento corre en su propia sesión de Claude Code dentro de una MicroVM (Vercel Sandbox), transmitida en vivo al navegador — sin cajas negras. |
| **Sus datos, en sus contenedores** | Postgres, MinIO, Qdrant y Ollama autoalojados. Las únicas salidas a internet son la API de Anthropic y Vercel Sandbox — nada más. |
| **Acceso local y auditable** | Autenticación de correo y contraseña resuelta en el servidor, roles separados para proveedor, oficial y plataforma, y límites de tasa siempre activos. |

### El vocabulario de estados

Los colores del producto son semánticos, no decorativos: el naranja marca
actividad de agente en vivo y nunca adorno, **vencido** es ámbar y jamás rojo
—una credencial que caducó no es un rechazo—, y el rojo queda reservado para lo
que **falló** o fue **rechazado**.

<p align="center">
  <img src="docs/landing/11-tokens.svg" width="100%"
       alt="La paleta de la plataforma: cada token con su muestra de color, su valor hexadecimal y su función, del naranja de marca al grafito de los botones y los cuatro colores de estado.">
</p>

<p align="center">
  <img src="docs/landing/12-badges.svg" width="100%"
       alt="Las nueve variantes de insignia con sus colores semánticos: verificado y aprobado en verde, procesando y delegado en naranja, vencido y requiere revisión en ámbar, en progreso en azul, rechazado en rojo y no aplica en gris.">
</p>

<p align="center">
  <sub>
    Nueve insignias del vocabulario que el usuario ve en todo el producto — mezcla estados de
    proveedor, de documento y el nivel de privilegio del asistente; no es el enum completo de siete
    estados de cumplimiento («No iniciado» y «Probablemente en cumplimiento» no aparecen aquí. Ver
    <a href="#12-modelo-de-datos">§12</a>). En pantalla, los estados en vivo llevan además un punto que late.
  </sub>
</p>

---

## 1. ¿Qué hace esta app? (explicación para principiantes)

### El problema del mundo real

Antes de que una empresa grande (el *comprador*) le pague a un proveedor nuevo, alguien tiene que revisar papeles: ¿tiene seguro vigente y con el monto suficiente?, ¿entregó su formulario tributario?, ¿su licencia comercial está al día?, ¿venció algo desde la última revisión? Hoy eso lo hace una persona abriendo PDFs uno por uno. Es lento, se equivoca y no queda registro de por qué se aprobó algo.

**Vendra automatiza la lectura y deja la decisión donde corresponde: en las personas.**

### Los tres usuarios — y la decisión que le toca a cada uno

| Rol | Quién es | Qué ve | **Su decisión** |
|---|---|---|---|
| **Contacto del proveedor** (`VENDOR_CONTACT`) | La empresa que quiere venderle al comprador | Su portal: sube documentos, ve el progreso en vivo, revisa qué le falta y conversa con un asistente | Responde las **confirmaciones sobre sus propios documentos** (¿esta póliza de la matriz lo cubre?), marca categorías como «No aplica» y decide cuándo activar su cuenta |
| **Oficial de cumplimiento** (`COMPLIANCE_OFFICER`) | Quien revisa y aprueba del lado del comprador | Un panel aparte: listado de proveedores, expediente completo, trazabilidad de requisitos | **Adjudica**: exime, recategoriza, otorga o revoca requisitos, reintenta, ratifica las categorías que la política le derivó, y firma el estado final |
| **Administrador de plataforma** (`SUPERADMIN`) | Quien opera la plataforma y da de alta a los compradores | La consola `/platform`: empresas, cuentas de oficial y la política de cada empresa | **Define qué puede decidir la IA**: qué documentos se aceptan, qué campos se extraen, qué validaciones cuentan, qué categorías aprueba el sistema solo y qué puede hacer el asistente — y aprueba o rechaza las propuestas de cambio |

Los tres puntos son distintos a propósito: **el proveedor aporta el conocimiento
que solo él tiene** (la estructura societaria de su negocio), **el oficial aporta
el criterio que solo él puede ejercer** (aceptar una excepción y hacerse
responsable), y **el administrador de plataforma fija de antemano la frontera de
la autonomía** (qué se aprueba sin preguntarle a nadie). El sistema no le pide a
ninguno lo que le corresponde al otro. El detalle completo está en la
[sección 4](#4-dónde-decide-una-persona-los-cuatro-puntos-hitl).

`SUPERADMIN` es un eje aparte, no «un oficial con más permisos»: opera entre
empresas y **nunca adjudica un proveedor**. Un oficial que abra `/platform` es
devuelto a su propio panel, y un administrador de plataforma que abra
`/vendors` también; en la capa tRPC, además, los procedimientos de la otra
superficie responden `NOT_FOUND` — el sistema no filtra ni su existencia.

### El recorrido del proveedor, paso a paso

1. **Se registra** en `/register` con correo y contraseña, e ingresa los datos del negocio (nombre legal, DBA, tipo de entidad, estados donde trabaja, si es 100% remoto…). Esos datos definen su **perfil de requisitos**: por ejemplo, un proveedor totalmente remoto no necesita seguro de auto ni compensación laboral. El EIN nunca se escribe a mano: los últimos 4 dígitos los rellena un W-9 o W-8BEN-E ya verificado.
2. **Sube sus documentos** (hasta 40 archivos por lote, 10 MB cada uno; PDF, PNG, JPEG o WebP). El navegador los sube directo al almacenamiento con una URL prefirmada — no pasan por el servidor de la app. Un archivo vacío, de tipo no admitido o que cambió en disco tras seleccionarlo se rechaza solo, sin hundir el resto del lote.
3. **Mira el procesamiento en vivo.** Cada tarjeta muestra 8 etapas (`leyendo → analizando → clasificando → extrayendo → guardando → validando → mapeando → finalizando`), el razonamiento del agente y frases cortas del tipo *«Analizando el contenido y la estructura del documento...»*. Todo llega por streaming, en español.
4. 🧑‍⚖️ **Responde la confirmación cuando aparece — este es el HITL del proveedor.** Si un documento nombra a otra empresa, la app se detiene y pregunta: *«Esta póliza nombra a "ACME Holdings" como asegurado. ¿Es esa su empresa matriz y la cobertura de dicha empresa se extiende a su negocio?»*. Hay 5 minutos para contestar; la pregunta sobrevive a un refresh de la página y se puede responder desde otra pestaña o incluso desde otra instancia del servidor. Si nadie contesta, el sistema **continúa** con el criterio por defecto y deja registrado que fue por vencimiento — nunca se queda colgado.
5. **Ve su checklist de requisitos.** El catálogo tiene 11 categorías; el proveedor ve las que su perfil exige (9 en el perfil sembrado `construction-sub`, 5 en `general-supplier`), con lo cubierto, lo que falta y lo que **él mismo** puede marcar como «No aplica» — dentro de lo que el perfil permite, nunca una categoría obligatoria y nunca una que un oficial esté revisando.
6. **Consulta al asistente** cuando algo no le calza: *«¿Por qué falló mi documento?»*, *«¿Qué falta para poder activar mi cuenta?»*. El asistente consulta el estado real en el momento, no adivina — y tiene prohibido prometer resultados o pasar por encima de una decisión del oficial.
7. **Activa su cuenta** cuando el checklist se completa → el estado pasa a `PRE_APPROVED`. Es una acción deliberada del proveedor, y el servidor vuelve a calcular la compuerta antes de aceptarla.

### El recorrido del oficial

Entra a `/vendors`, un directorio ordenado por **próximo vencimiento primero**, con búsqueda, filtro por los 7 estados y una casilla «Por vencer dentro de 30 días». Abre un proveedor y cae, por defecto, en la pestaña **Trazabilidad de requisitos**: cada categoría con su estado, qué documento la otorgó y bajo qué fuente (extracción, concesión manual, exención, determinación de cobertura), más la tarjeta de determinación de cobertura con los límites efectivos contra los exigidos.

Sobre cada documento puede abrir un visor a dos paneles —el archivo real a la izquierda (imagen o PDF, por URL prefirmada contra el almacén propio) y el expediente de procesamiento a la derecha: clasificación con su confianza y razonamiento, campos extraídos con confianza por campo, y las reglas de validación una por una.

🧑‍⚖️ **Desde ahí adjudica — este es el HITL del oficial.** Nada de lo que hace es automático, y nada de lo que hace queda sin registro:

- **Eximir** una validación fallida (con justificación obligatoria, fecha de vencimiento y un alcance que el servidor **recorta** a lo que esa falla realmente bloquea),
- **Recategorizar** un documento mal tipificado (inserta una versión nueva; nunca sobrescribe la anterior),
- **Otorgar manualmente** una categoría —lo que además **ratifica** una derivación pendiente—, reconociendo explícitamente la anulación si el documento de respaldo falló,
- **Revocar** ese otorgamiento,
- **Reintentar** un documento fallado (lo devuelve a la cola),
- **Firmar el estado final** (`PRE_APPROVED` / `NEED_REVIEW` / `APPROVED` / `REJECTED`), que queda sellado con su identidad y la hora,
- **Etiquetar** al proveedor.

Cada acción documental escribe una fila de actividad y recalcula el estado del proveedor **en la misma transacción**. Nada queda a medias, y toda la bitácora es reconstruible.

### El recorrido del administrador de plataforma

Entra a `/platform` y ve el directorio de empresas, con lo que a cada una le falta: «Sin oficiales», «Borrador sin activar», «Propuestas pendientes (N)».

- **Crea una empresa** («Nueva empresa»): nombre, identificador, uno de los dos perfiles de requisitos y —opcionalmente, en el mismo acto— la primera cuenta de oficial. Todo eso nace junto con una política v1 activa que reproduce el comportamiento por defecto.
- **Configura la política** de esa empresa: qué tipos de documento acepta, qué campos se extraen de cada uno (los estructurales quedan bloqueados y marcados «obligatorio»), qué validaciones cuentan, qué categorías puede aprobar el sistema por su cuenta y qué puede hacer el asistente del proveedor.
- **Valida y activa**: una puerta de admisibilidad OPA revisa la configuración antes de dejar activarla, y activar versiona la política y ancla a cada proveedor a la versión bajo la que se le juzga.
- 🧑‍⚖️ **Resuelve las propuestas de directiva** que redactó un asistente delegado: aprobarlas crea y activa una versión nueva; rechazarlas exige un motivo, que el asistente recuerda.

Todo eso está en detalle en la [sección 8](#8-la-gobernanza-la-política-de-cada-empresa-y-la-puerta-opa).

### Y el tiempo también decide

Un barrido horario revisa vencimientos: cuando un documento obligatorio caduca, el proveedor `APPROVED` pasa a `EXPIRED` solo; a 30, 14 y 1 día del vencimiento se generan avisos de renovación. Si el proveedor sube la renovación y valida, vuelve a `APPROVED` **sin que un oficial tenga que tocar nada** — el HITL se reserva para lo que de verdad exige criterio.

### Glosario mínimo

| Término | Qué significa aquí |
|---|---|
| **HITL** (*human in the loop*) | El punto donde el sistema se detiene y le entrega el control a una persona. En Vendra hay cuatro: la confirmación del proveedor, la adjudicación del oficial, la derivación de un requisito y la propuesta de directiva |
| **Ventana durable** | Una pregunta HITL que vive en la base de datos, no solo en memoria: sobrevive a recargas, se puede responder desde cualquier instancia y vence de forma explícita |
| **Fail-open** | Si la ventana de confirmación vence sin respuesta, el proceso **continúa** con un criterio por defecto registrado, en vez de quedarse bloqueado. Solo la ventana del proveedor falla abierta; las otras tres esperan a una persona |
| **Poder de árbitro** | La lista de categorías que la política de una empresa deja que el sistema resuelva por su cuenta. Lo que queda fuera, lo aprueba una persona en cada proveedor |
| **Derivación de requisito** | El requisito que el motor probó pero no tuvo permiso de conceder: queda registrado, se le muestra al oficial y espera su ratificación. Sin vencimiento y sin respuesta por defecto |
| **Propuesta de directiva** | El cambio de política que redacta un asistente en nivel «Delegado». Es un borrador estructurado: solo un administrador de plataforma puede aplicarlo |
| **Anclaje de política** | Cada proveedor queda fijado a la versión de la política bajo la que se le juzga; activar una versión nueva no le cambia las reglas a quien ya está en curso |
| **Puerta de admisibilidad** | La política Rego compilada a Wasm que revisa una configuración de empresa antes de dejar activarla. Corre dentro del proceso, sin red |
| **Harness** | Un agente de codificación ya hecho (Claude Code) con su propio ciclo de razonamiento y herramientas. Este backend lo *arrienda* en vez de armar el loop a mano |
| **Sandbox / MicroVM** | Una máquina virtual desechable donde corre el agente, aislada del servidor y con salida a internet restringida |
| **Host tool** | Una herramienta que el agente llama, pero que se ejecuta en el servidor Next.js (no dentro de la VM). Así el agente pide «guarda esta clasificación» y el host decide qué hacer con eso |
| **Compuerta de activación** | La matemática que decide si el proveedor puede activar su cuenta |
| **SSE / streaming** | La técnica para que el navegador reciba el avance en vivo mientras el agente trabaja |

---

## 2. Arranque rápido y cómo probar la app

Esta sección va completa: levantar el stack, entrar, **crear sus propias cuentas y empresas**, y qué documentos subir para ver funcionar cada parte del sistema.

### 2.1 Requisitos previos

Solo **Docker** con Docker Compose v2 (`docker compose version` debe responder). No hace falta Node ni pnpm para el camino de Docker.

Y cuatro credenciales de las dos dependencias remotas:

| Variable | De dónde sale |
|---|---|
| `ANTHROPIC_API_KEY` | Consola de Anthropic → API Keys. La llave debe tener habilitado el modelo de `HARNESS_MODEL` (por defecto `claude-sonnet-4-6`) y el de extracción de memoria (`claude-haiku-4-5-20251001`) |
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens. Créelo **con alcance del equipo**, no personal |
| `VERCEL_TEAM_ID` | Vercel → Team Settings → General (empieza con `team_`) |
| `VERCEL_PROJECT_ID` | Vercel → cualquier proyecto → Settings → General (empieza con `prj_`) |

> **Se puede arrancar sin ellas.** La app igual levanta, sirve las cuatro superficies, permite registrarse y aceptar subidas: los documentos quedan en cola y `/api/health` reporta `harness: unconfigured`. Lo que no ocurre es el procesamiento con agentes ni la determinación de cobertura.

**Para desarrollar** (no hace falta para solo probar la app): active el hook de
push una vez por clon —

```bash
pnpm hooks:install   # = git config core.hooksPath .githooks
```

Cada `git push` corre entonces la especificación ejecutable
(`policy/run-checks.sh`, también disponible como `pnpm policy:check`) más el
type-check. Requiere el binario local de OPA (`~/.local/bin/opa`). Escape de
emergencia: `VENDRA_SKIP_CHECKS=1 git push`.

### 2.2 Levantar el stack

```bash
git clone https://github.com/Cognition-Flux/multi-agent-harness-as-backend-es.git
cd multi-agent-harness-as-backend-es

cp .env.docker.example .env.docker
# Edite .env.docker:
#   1. las cuatro llaves de arriba
#   2. BETTER_AUTH_SECRET → cualquier cadena aleatoria:  openssl rand -hex 32
# El resto del archivo ya viene con los valores correctos para compose.

docker compose up
```

La primera vez la construcción de la imagen tarda algunos minutos. Ese único comando levanta **ocho servicios**:

| Servicio | Qué hace | Cuándo termina |
|---|---|---|
| `postgres` | Postgres 16, la base propia de la app (puerto host **5436**) | queda corriendo |
| `minio` | Almacenamiento de objetos compatible con S3 (**9000** API / **9001** consola) | queda corriendo |
| `minio-init` | Crea el bucket `vendor-docs` | one-shot |
| `qdrant` | El índice semántico de la memoria del asistente (**6333** REST / 6334 gRPC) | queda corriendo |
| `ollama` | El host local del modelo de *embeddings* (**11435** en el host → 11434 dentro) | queda corriendo |
| `ollama-init` | Descarga el modelo `bge-m3` (~2,2 GB). Es *best-effort*: si falla, la app arranca igual | one-shot |
| `migrate` | Aplica las migraciones, siembra la demo y rellena las políticas de empresa — **mire su log: ahí salen las credenciales** | one-shot |
| `app` | El servidor Next.js en **http://localhost:3000** | queda corriendo |

El servicio `app` espera a que `migrate`, `minio-init` y `ollama-init` terminen bien, así que cuando el puerto 3000 responde, la base ya está lista. A `qdrant` **no** lo espera a propósito: un índice ausente degrada el recuerdo del asistente a recencia en vez de bloquear el arranque.

**Comprobar que quedó sano:**

```bash
curl -s http://localhost:3000/api/health
# {"db":"ok","storage":"ok","harness":"ok","sweeper":{"lastTickAt":…},
#  "memory":{"status":"ok","qdrant":"ok","ollama":"ok","queueDepth":0,"drainLastTickAt":…}}
#
# harness:"unconfigured" + "missing":[...]  = falta alguna de las cuatro llaves
# memory:"unconfigured" | "degraded"        = el índice no está; el asistente recuerda por recencia
```

Solo `db` y `storage` deciden el 200 vs 503: un `memory` degradado **no** marca la app como enferma, porque el asistente sigue funcionando sin su índice.

**Comandos del día a día:**

```bash
docker compose up -d                 # levantar en segundo plano
docker compose logs -f app           # seguir los logs de la app
docker compose logs migrate          # volver a ver las credenciales sembradas
docker compose restart app           # reiniciar solo la app (tras cambiar .env.docker)
docker compose down                  # detener; los datos sobreviven (volúmenes con nombre)
docker compose down -v               # detener Y BORRAR todo: base, archivos, cuentas, índice y modelos
```

`down -v` borra también el volumen de Qdrant (reconstruible con
`pnpm --filter vendra memory-reindex -- --rebuild`) y el de modelos de Ollama
(~2,2 GB, se vuelve a descargar en el siguiente arranque).

La consola de MinIO queda en http://localhost:9001 (`minioadmin` / `minioadmin`) si quiere ver los archivos subidos.

### 2.3 Las cuentas sembradas

El servicio `migrate` deja creadas la organización compradora (**Acme Construction Group**), la organización de plataforma (**Vendra (plataforma)**), dos perfiles de requisitos, **tres cuentas** y —vía el backfill de gobernanza que corre después de la semilla— una política v1 activa por empresa con cada proveedor anclado a ella:

| Rol | Correo | Contraseña | Aterriza en |
|---|---|---|---|
| Administrador de plataforma | `superadmin@vendra.test` | `SuperDemo123!` | `/platform` |
| Oficial de cumplimiento | `officer@acme-demo.test` | `OfficerDemo123!` | `/vendors` |
| Contacto de proveedor | `vendor@summit-demo.test` | `VendorDemo123!` | `/portal` |

Son credenciales de demo local, no secretos. La semilla es idempotente: si la organización ya existe, no hace nada.

### 2.4 Crear más cuentas y más empresas

Para probar de punta a punta conviene tener varios proveedores (cada uno con su propio expediente), más de un oficial y más de una empresa. Hay cuatro caminos, y son distintos a propósito.

#### Proveedores → desde el navegador, sin tocar la terminal

Vaya a **http://localhost:3000/register** y complete cuatro campos: razón social, nombre del contacto, correo y contraseña (mínimo 8 caracteres). Eso crea la cuenta, crea la fila del proveedor dentro de `acme-construction`, la vincula con el primer perfil de requisitos (`construction-sub`) y la ancla a la política activa de esa empresa. Es el mismo camino que usaría un proveedor real.

Repítalo con distintas razones sociales para tener varios expedientes en el listado del oficial.

#### Empresas y oficiales → desde la consola de plataforma

Entre como `superadmin@vendra.test` y use **Nueva empresa**: nombre, identificador, perfil de requisitos y, en la misma pantalla, la primera cuenta de oficial («Crear el primer oficial de cumplimiento»). Después puede sumar más con **Añadir oficial** en la ficha de la empresa. Ambos caminos crean la cuenta con la instancia de better-auth de la app, nunca escribiendo a mano en las tablas de autenticación.

#### Cuentas → por script, cuando prefiere la terminal

No hay registro público para oficiales ni para administradores de plataforma. El script `create-account` los crea, con el mismo camino interno que la consola.

**Con el stack en Docker corriendo:**

```bash
docker compose run --rm migrate \
  pnpm --filter vendra create-account -- \
    --role officer \
    --email officer2@acme-demo.test \
    --password 'Officer2Demo123!' \
    --name "Segunda Oficial"
```

`docker compose run --rm migrate <comando>` reutiliza la imagen del migrador —que sí trae pnpm y el código fuente— y toma el entorno de `.env.docker`. El `--rm` borra el contenedor al terminar.

El mismo script crea proveedores y administradores de plataforma:

```bash
docker compose run --rm migrate \
  pnpm --filter vendra create-account -- \
    --role vendor \
    --email vendor@maple-demo.test \
    --password 'MapleDemo123!' \
    --name "Robin Vale" \
    --legal-name "Maple Works LLC"

docker compose run --rm migrate \
  pnpm --filter vendra create-account -- \
    --role superadmin \
    --email super2@vendra.test \
    --password 'Super2Demo123!' \
    --name "Platform Op"
```

**Banderas disponibles:**

| Bandera | Obligatoria | Qué hace |
|---|---|---|
| `--role` | sí | `officer`, `vendor` o `superadmin` |
| `--email` | sí | Correo de inicio de sesión (único) |
| `--password` | sí | 8–128 caracteres (política de better-auth) |
| `--name` | sí | Nombre de la persona |
| `--legal-name` | solo `vendor` | Razón social — es el nombre contra el que se comparan los documentos |
| `--org` | no | Slug de la organización (por defecto `acme-construction`). No aplica a `superadmin`: esa cuenta va a la organización de plataforma, que se crea sola |
| `--profile` | no | Solo para `vendor`: `construction-sub` (9 categorías) o `general-supplier` (5). Por defecto, el perfil de menor id de la organización — el mismo que usa `/register` |

Imprime una línea JSON con lo creado, útil para guionar:

```json
{"userId":"NDKs…","role":"COMPLIANCE_OFFICER","email":"officer2@acme-demo.test"}
{"userId":"9C2D…","role":"VENDOR_CONTACT","email":"vendor@maple-demo.test","vendorId":4,"vendorUuid":"2e2b…"}
{"userId":"7F1A…","role":"SUPERADMIN","email":"super2@vendra.test"}
```

#### Empresas → por script, el gemelo de la consola

```bash
docker compose run --rm migrate \
  pnpm --filter vendra create-company -- \
    --name "Delta Infraestructura SpA" \
    --slug delta-infra \
    --preset general-supplier \
    --officer-email oficial@delta.test \
    --officer-password 'DeltaDemo123!' \
    --officer-name "Ana Oficial"
```

Provisiona la organización, su perfil de requisitos, una política v1 **admisible** (la puerta OPA se ejecuta también aquí) y la primera cuenta de oficial — el mismo `provisionCompany` que llama la consola. Las tres banderas de oficial van juntas o no van; `--preset` acepta `construction-sub` (por defecto) o `general-supplier`.

Si corre la app sin Docker ([§14](#14-desarrollo-local-sin-docker)), los cuatro scripts funcionan directo: `pnpm --filter vendra create-account -- …`, `create-company`, `migrate` y `memory-reindex`.

### 2.5 Qué documentos subir

El agente clasifica por **lo que el documento muestra**, no por el nombre del archivo. Se aceptan **PDF, PNG, JPEG y WebP**, hasta 40 archivos por lote de 10 MB cada uno. Esta es la tabla que importa: qué debe verse en la página para que el documento se reconozca, y qué categoría acredita si además pasa la validación.

| Suba esto | Debe mostrar | Acredita |
|---|---|---|
| **Certificado de seguro ACORD 25** | El título "CERTIFICATE OF LIABILITY INSURANCE", la casilla INSURED y la grilla de límites por línea | *Aporta a* responsabilidad civil, compensación laboral y/o auto; una línea cíber en vigor sí otorga seguridad de datos |
| **Página de declaraciones de póliza** | Página "Declarations" de la aseguradora con asegurado, número de póliza, vigencia y límites de UNA póliza | *Aporta a* las mismas líneas de seguro |
| **Póliza umbrella / exceso** | Un documento "Umbrella" o "Excess Liability" con su propio límite | *Aporta a* responsabilidad civil, apilándose sobre la primaria |
| **Formulario W-9** | El encabezado "Form W-9" y la casilla del TIN en la Parte I | Identidad fiscal |
| **Formulario W-8BEN-E** | El encabezado "Form W-8BEN-E" (entidades extranjeras) | Identidad fiscal |
| **Licencia comercial** | Licencia o registro emitido por un estado/condado/ciudad, con número y fecha de vencimiento | Licencia comercial |
| **Certificación de diversidad** | Certificado de un organismo certificador (MBE / WBE / DBE / VOSB / 8(a) / HUBZone) | Certificación de diversidad |
| **Carta de EMR** | Carta de la aseguradora o del buró que indica la tasa de modificación por experiencia | Historial de seguridad |
| **OSHA 300A** | El encabezado del formulario 300A con los totales anuales | Historial de seguridad |
| **Carta bancaria** o **cheque anulado** | Carta en papel membretado del banco confirmando la cuenta, o un cheque marcado "VOID" | Verificación bancaria |
| **MSA o NDA firmado** | Contrato titulado "Master Services Agreement" o "Non-Disclosure Agreement", con bloques de firma | Acuerdos firmados |
| **SOC 2 / ISO 27001 / póliza cíber** | El informe, el certificado o la póliza correspondiente | Seguridad de datos (perfil `general-supplier`) |

> **Las tres categorías de seguro no las otorga ningún documento suelto.** Un
> certificado o una póliza *aportan* evidencia; quien concede responsabilidad
> civil, compensación laboral y auto es la determinación de cobertura
> ([§6](#6-carril-2--la-determinación-de-cobertura)) cuando su veredicto es
> `MEETS` — o el otorgamiento manual del oficial. Por eso un ACORD 25 impecable
> deja esas categorías «determinando» durante unos segundos antes de ponerse en
> verde.

**De dónde sacar archivos de prueba.** El W-9 y el OSHA 300A son formularios públicos que se descargan en blanco desde los sitios oficiales del IRS y de OSHA — sirven tal cual (un W-9 en blanco se clasifica igual; la extracción registra lo que falta). Para lo demás, plantillas de ejemplo de ACORD 25 y de cartas bancarias abundan en la web.

<details>
<summary><b>O fabrique el suyo en 30 segundos</b></summary>

Escriba un HTML con los identificadores de la tabla e imprímalo a PDF sin abrir nada:

```bash
cat > /tmp/w9.html <<'HTML'
<h1>Form W-9</h1>
<h2>Request for Taxpayer Identification Number and Certification</h2>
<p>1 Name of entity: <b>Northwind Remote Services LLC</b></p>
<p>3a Federal tax classification: [x] LLC — S corporation</p>
<h3>Part I — Taxpayer Identification Number (TIN)</h3>
<p>Employer identification number: 47-3914826</p>
<h3>Part II — Certification</h3>
<p>Signature: Dana Whitfield, Managing Member &nbsp; Date: 2026-02-14</p>
HTML

google-chrome --headless --no-pdf-header-footer \
  --print-to-pdf=/tmp/w9.pdf file:///tmp/w9.html
```

Ese PDF se clasifica como W-9, pasa la validación y otorga identidad fiscal. Cambiando el contenido se arma cualquier caso: una licencia comercial vencida, un W-9 sin firma, una carta de EMR sobre 1,00, un SOC 2 con opinión adversa, o una póliza a nombre de otra empresa para disparar la ventana HITL.

</details>

**No use documentos reales con datos personales**: los identificadores tributarios y las cuentas bancarias se enmascaran, pero no hay razón para arriesgarlos.

**Un archivo que no calza con nada** se clasifica como `UNKNOWN` a propósito — cotizaciones de seguros, material de marketing o correspondencia deberían dar exactamente eso, con el mensaje «No pudimos reconocer el tipo de este documento…». Es una prueba válida, no un error.

### 2.6 Seis recorridos de punta a punta

El perfil sembrado por defecto, `construction-sub`, exige nueve categorías: identidad fiscal, responsabilidad civil, compensación laboral, auto, licencia comercial, historial de seguridad, verificación bancaria, acuerdos firmados y certificación de diversidad. De esas, **identidad fiscal y responsabilidad civil son obligatorias** (no se pueden descartar), y sus umbrales son 1 M USD por ocurrencia / 2 M agregado, con asegurado adicional requerido.

#### A — el camino corto hasta la activación

El objetivo es llegar a `PRE_APPROVED` con la menor cantidad de documentos.

1. Regístrese en `/register` como **"Northwind Remote Services LLC"**.
2. En «Datos de la empresa» marque **«Solo remoto (sin trabajo presencial)»** y guarde. Eso descarta automáticamente seguro de auto y compensación laboral (no son obligatorias en este perfil) — y **sin gastar** ninguno de sus dos descartes manuales: quedará en 7 categorías pendientes y «0 de 2 descartes de "no aplica" utilizados».
3. Marque **«No aplica»** en certificación de diversidad e historial de seguridad — los dos descartes manuales que permite el perfil. Quedan 5 pendientes: identidad fiscal, responsabilidad civil, licencia comercial, verificación bancaria y acuerdos firmados.
4. Suba cinco documentos: **W-9**, **certificado ACORD 25** (con al menos 1 M por ocurrencia y la condición de asegurado adicional indicada, para no disparar el HITL), **licencia comercial**, **carta bancaria** y un **MSA firmado**.
5. Espere a que la determinación de cobertura cierre en `MEETS` — hasta entonces responsabilidad civil queda «determinando» y el servidor responde `412` a un intento de activar.
6. Con el checklist completo, el botón deja de contar lo que falta y dice **Activar cuenta de proveedor** → `PRE_APPROVED`.

#### B — la ventana HITL del proveedor

Hay tres formas de provocarla, y cada una dispara una pregunta distinta:

| Para ver… | Suba… |
|---|---|
| *«¿Es esa su empresa matriz?»* | Un **documento de seguro** (ACORD 25, declaraciones o umbrella) a nombre de **otra empresa** claramente distinta (regístrese como "Cedar Grove Electric LLC" y suba un COI a nombre de "Cedar Holdings Group Inc.") |
| *«¿Es el mismo negocio bajo otro nombre?»* | Un documento con un nombre **parecido pero no igual** al registrado (registrado "Cedar Grove Electric LLC", documento "Cedar Grove Electrical Co.") |
| *«¿Aplica un endoso general de asegurado adicional?»* | Un **ACORD 25 que no indique** la condición de asegurado adicional — el perfil `construction-sub` la exige |

Con la pregunta en pantalla, pruebe las tres salidas: respóndala, **recargue la página** (sigue ahí, con su reloj corriendo), o **déjela vencer** los 5 minutos para ver el *fail-open* — el documento continúa y el resultado queda registrado como vencimiento.

Un detalle que vale la pena mirar: si responde «No» al caso de la matriz, el documento falla; pero si responde «Sí», o si el nombre simplemente no calza en un documento de seguro, la tarjeta queda **Contado · cobertura** — falló la identidad, y sus límites igual alimentan la determinación.

#### C — el apilamiento de cobertura

1. Suba un certificado o declaración con responsabilidad civil de **500.000 USD por ocurrencia** — por debajo del umbral de 1 M. El documento **pasa** la validación (el límite bajo es una advertencia informativa, no una falla) y la determinación queda en `BELOW`.
2. Suba ahora una **póliza umbrella de 2.000.000 USD**.
3. Espere a que el carril de cobertura vuelva a correr. El veredicto pasa a `MEETS` con límite efectivo de 2,5 M, y el desglose muestra qué documento aportó como `primary` y cuál como `umbrella`.

#### D — el rescate del oficial

1. Como proveedor, suba un documento que **falle** la validación: un certificado vencido, un W-9 sin firma o una licencia emitida en un estado fuera de su perfil de trabajo.
2. Entre como oficial (`officer@acme-demo.test`), abra `/vendors` y luego el proveedor.
3. Abra el visor del documento (el ícono de ojo) y lea la regla que falló. Después pruebe el kit: **eximir** (pide justificación de al menos 10 caracteres y fecha de vencimiento), **recategorizar** un documento mal tipificado, **otorgar a mano** una categoría, **revocarla** y **firmar** el estado final.
4. Abra la pestaña «Resumen»: cada acción quedó en «Actividad» con actor y hora, y cada cambio de estado en «Transiciones de estado» con su origen. Ese es el punto — el expediente explica por qué está como está.

#### E — la consola de plataforma y la puerta OPA

1. Entre como `superadmin@vendra.test` y cree una empresa con **Nueva empresa**, marcando la casilla para crear su primera cuenta de oficial.
2. Abra la empresa y **quite todas las validaciones** de un tipo de documento. La tarjeta lo marca en rojo: «Sin validaciones, cualquier documento de este tipo pasaría sin revisión. No se puede activar así.»
3. Pulse **Validar**: la puerta OPA responde «No se puede activar todavía» con la violación nombrada. Deshaga el cambio y vuelva a validar — ahora la verá pasar con advertencias.
4. Saque una categoría del poder de árbitro, active la política, y suba desde ese proveedor un documento que acredite esa categoría: el requisito queda **derivado** y espera al oficial en vez de otorgarse solo.
5. Intente poner el asistente en «Delegado — puede proponer directivas» en una empresa **sin oficiales**: la puerta lo rechaza, porque no habría quién revise.

#### F — el asistente y su memoria

1. Como proveedor, abra el cajón del asistente y pregunte «¿Qué falta para poder activar mi cuenta?». Verá las píldoras de herramienta («Consultando su registro de cumplimiento…») y la respuesta transmitida token a token.
2. Cuéntele algo duradero de su negocio («trabajamos solo en Chile central, con dos cuadrillas»). Aparecerá «Tomando nota…» → «Anotado para la próxima vez», o el hecho se extraerá en segundo plano.
3. Cierre sesión, vuelva a entrar y pregunte algo relacionado: el asistente lo recuerda. Con `qdrant`/`ollama` apagados, el recuerdo cae a recencia y el chat sigue funcionando — `/api/health` lo dirá en su bloque `memory`.

Al terminar, `docker compose down && docker compose up` para comprobar que todo el estado sobrevive.

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
    model: env.HARNESS_MODEL,                        // por defecto claude-sonnet-4-6
    thinking: { type: "adaptive", display: "summarized" },
    maxTurns: 28 + 2 * Math.ceil(confirmationWindowMs / 30_000),   // 48 por defecto
    startupTimeoutMs: 180_000,
    auth: { anthropic: { apiKey: env.ANTHROPIC_API_KEY } },  // auth directa, sin gateway
  }),
  sandbox,                                            // la MicroVM compartida
  tools: buildVendorDocTools(ctx),                    // herramientas del HOST
  activeTools: ["read", "saveClassification", "saveExtraction",
                "finalizeDocument", "failDocument"],  // lista blanca estricta
  permissionMode: "allow-reads",                      // defensa en profundidad
  telemetry: { integrations: [getHarnessFileReporter()] },       // solo turnos fallidos
  sandboxConfig: { onSession: async ({ session, sessionWorkDir }) => {
    await session.writeBinaryFile({
      path: `${sessionWorkDir}/incoming/document${EXTENSION_BY_MIME[mediaType]}`,
      content: bytes,
    });
  }},
});

const session = await agent.createSession({ abortSignal: signal });
const result  = await agent.stream({ session, prompt, abortSignal: signal });
writer.merge(toUIMessageStream({ stream: result.stream, sendReasoning: true }));
```

### La partición host / VM: quién ejecuta qué

Esta es la decisión de diseño que sostiene todo lo demás.

```
┌─ Proceso Next.js (el HOST) ──────────────┐   ┌─ MicroVM Vercel Sandbox ─────────────┐
│                                          │   │                                      │
│  • Postgres, MinIO, sesiones, auth       │   │  • El CLI de Claude Code             │
│  • Los motores puros (@vendra/workflow)  │◄──┤  • El "bridge" que habla con el host │
│  • Las ventanas HITL del proveedor       │   │  • La herramienta interna `read`     │
│  • La política de la empresa             │   │  • El archivo del documento          │
│  • Las HOST TOOLS:                       │   │                                      │
│      saveClassification                  │   │  Sin shell, sin escritura, sin web.  │
│      saveExtraction                      │   │  Egreso permitido SOLO hacia         │
│      finalizeDocument   ← aquí se decide │   │  api.anthropic.com y *.npmjs.org     │
│      failDocument                        │   │                                      │
└──────────────────────────────────────────┘   └──────────────────────────────────────┘
```

El agente **solo** puede: leer el archivo y llamar cuatro herramientas del host. No puede escribir archivos, no puede correr comandos, no puede navegar. Y cuando llama a `finalizeDocument`, quien compara nombres de entidad, decide si hay que preguntarle al proveedor, valida, mapea requisitos y escribe en la base es el host — con código puro y determinista.

**Los bytes originales entran sin tocarse.** No hay rasterización ni conversión previa: el `read` interno de Claude Code abre PDFs e imágenes nativamente, y el archivo se monta con su extensión real. Es una invariante deliberada.

**El esquema que recibe el agente lo decide la empresa.** `saveClassification` le devuelve el esquema de extracción del tipo clasificado ya **proyectado** por los campos que la política de esa empresa seleccionó; y la selección se vuelve a aplicar al guardar, así que un campo deseleccionado no se persiste aunque el modelo lo ofrezca. Con la política por defecto, la proyección es un no-op exacto.

### La MicroVM compartida y el grupo de puertos

Crear un sandbox y arrancar el bridge cuesta entre 1 y 3 minutos. Hacerlo por documento sería inaceptable. Por eso:

- Se crea **una sola MicroVM** (`runtime: "node24"`), envuelta en modo *wrap* (`createVercelSandbox({ sandbox, bridgePorts })`), y cada sesión concurrente **arrienda un puerto** del grupo.
- Vercel Sandbox expone **como máximo 4 puertos** → el grupo es de 4 (`4000–4003`).
- Al crearla se hace un **pre-horneado** (`prepareSandboxForHarness`, tope de 4 min): una sesión desechable instala el bridge para que las sesiones reales no paguen el `npm install`. Es *best-effort*: si falla, la primera sesión de cada puerto paga ese arranque.
- La vida de un sandbox tiene un tope duro de **45 minutos** → se renueva a los **35 si hubo uso reciente** (si estaba ocioso, se retira y la próxima subida paga un arranque en frío), y el viejo se jubila con **8 minutos de gracia** para que las sesiones en vuelo terminen.
- El egreso es **denegado por defecto**: `networkPolicy: { allow: ["api.anthropic.com", "*.npmjs.org"] }`.
- El nivel de esfuerzo del CLI se inyecta como variable de entorno de toda la MicroVM (`CLAUDE_CODE_EFFORT_LEVEL` desde `HARNESS_EFFORT_LEVEL`, por defecto `high`) — es la única palanca de esfuerzo del producto y aplica a los tres carriles a la vez.

Los 4 puertos se reparten con dos semáforos:

```
 4 puertos bridge
 ├── carril de documentos  ≤ 3   (Semaphore, HARNESS_MAX_CONCURRENCY, tope duro 3)
 │   └── el asistente toma prestado de ESTE carril, un turno a la vez por proveedor
 └── carril de cobertura     1   (Semaphore dedicado — nunca se le puede morir de hambre)
```

La única sesión que arrienda un puerto **fuera** de los semáforos es la desechable del pre-horneado, que corre una vez y termina antes de que el sandbox quede disponible para nadie.

### Los tres carriles de agente

| Carril | Archivo | Sesión | Presupuesto | Pensamiento |
|---|---|---|---|---|
| **Por documento** | `server/harness/doc-run.ts` | Una por documento, se destruye al terminar | 14 min (cola incluida), 2 intentos, 48 turnos | `adaptive` (resumido) |
| **Cobertura por proveedor** | `server/harness/coverage-runner.ts` | Una por intento, coalescida por proveedor, *fire-and-forget* | 8 min **por intento**, hasta 3 intentos, 24 turnos | `disabled` — medido: pasó de ~470 s a ~27 s |
| **Asistente del proveedor** | `server/assistant/` | Una por hilo de chat, **estacionada** entre turnos | 270 s por turno, 12 turnos | por defecto |

El segundo intento del carril de documentos solo ocurre si la corrida sigue siendo **invisible para el proveedor**: sin estado terminal escrito, sin ventana HITL abierta ni resuelta y sin abort. Si ya hubo efectos visibles para la persona, no se reintenta.

### Las reglas que sostienen los tres carriles

- **Todo `createSession` y todo `stream` lleva `abortSignal`.** Sin excepción: ninguna corrida sobrevive a su presupuesto.
- **Todo se transmite con `agent.stream()` envuelto en `createUIMessageStream`** — nunca `createAgentUIStreamResponse` (no hilvana la sesión del harness).
- **Nunca `z.record` cruzando el puente del harness**: descarta las llaves dinámicas. Los esquemas usan formas explícitas.
- **El contrato vive en un solo módulo**: `features/vendor-compliance/lib/vendor-harness-contract.ts` — etapas, constantes de subida, tipos de *data part* (incluidas las partes de confirmación HITL), esquemas zod de las herramientas y los topes de la propuesta de directiva. Lo importan las rutas, las herramientas del servidor y el cliente React, así el contrato del stream no puede desincronizarse entre capas.
- **Los fallos del harness se clasifican**, no se aplanan: `timeout`, `sandbox_api`, `sandbox_stream` o `unknown`, y un error de la API de Vercel Sandbox se registra con su status y su código (`status=402 code=payment_required`).

---

## 4. Dónde decide una persona: los cuatro puntos HITL

Vendra automatiza la **lectura**, no el **criterio**. Hay exactamente cuatro
lugares donde el sistema entrega el control a un ser humano, y están diseñados
con reglas distintas porque resuelven problemas distintos. Solo el primero vence
solo; los otros tres esperan indefinidamente, porque una pregunta de gobernanza
que se responde sola no es una pregunta.

| | **Proveedor** | **Oficial** | **Política** | **Gobernanza** |
|---|---|---|---|---|
| **Quién decide** | El contacto del proveedor, sobre su propio negocio | El oficial de cumplimiento, sobre el expediente ajeno | El oficial, sobre un requisito que el motor no tuvo permiso de conceder | El administrador de plataforma, sobre la política de la empresa |
| **Cuándo** | **Durante** el procesamiento — el pipeline está esperando | **Después**, en cualquier momento, sobre el estado ya calculado | Cuando el pliegue de evidencia retiene un otorgamiento | Cuando un asistente delegado redacta una propuesta |
| **Qué aporta** | Conocimiento que solo él tiene (estructura societaria, DBA, endosos) | Criterio y responsabilidad (aceptar una excepción y firmarla) | La ratificación que la empresa exigió para esa categoría | La decisión de cambiar —o no— las reglas del agente |
| **Si no responde** | *Fail-open*: el proceso continúa con el criterio por defecto, registrado | No hay vencimiento: el expediente espera | No hay vencimiento **ni respuesta por defecto**: la categoría no se otorga | No hay vencimiento: la política vigente sigue igual |
| **Superficie** | Una tarjeta de pregunta en el portal, ventana de 5 min | Siete mutaciones tRPC en `/vendors` | La tarjeta de la categoría, resuelta con «Otorgar requisito manualmente» | La ficha «Propuestas del asistente» en `/platform` |
| **Rastro** | Fila en `document_confirmation` con pregunta, respuesta, hora y resultado | Fila en `vendor_activity` + transición de estado, en la misma transacción | Fila en `requirement_referral` + actividades de derivación y resolución | Fila en `directive_proposal` + acta en `company_policy_decision` |
| **Dónde vive** | `server/harness/confirmations.ts` | `server/trpc/router.ts` | `server/harness/db/referrals.ts` | `server/directive-proposals.ts` |

### 4.1 El HITL del proveedor — la ventana de confirmación durable

**Cuándo se abre.** Después de extraer y **antes de validar**, el host compara el nombre de la entidad que aparece en el documento con la razón social registrada (comparación difusa: variantes de nombre, sufijos societarios, abreviaturas). Hay exactamente tres disparadores:

| Tipo | Cuándo se abre | La pregunta que ve el proveedor |
|---|---|---|
| `DBA_SAME_ENTITY` | El nombre es **ambiguo** (comparte tokens distintivos, pero no calza) | *«Este documento muestra el nombre "X". ¿Se trata de la misma empresa registrada bajo su razón social (es decir, un DBA o nombre comercial)?»* |
| `PARENT_POLICY_COVERS_SUBSIDIARY` | El nombre **no calza** Y el documento es de seguro (ACORD 25, declaraciones o umbrella) | *«Esta póliza nombra a "X" como asegurado. ¿Es esa su empresa matriz y la cobertura de dicha empresa se extiende a su negocio?»* |
| `BLANKET_ENDORSEMENT_APPLIES` | Un ACORD 25 no indica la condición de asegurado adicional y el perfil la exige | *«El certificado no indica la condición de asegurado adicional. ¿Aplica a esta relación un endoso general (blanket) de asegurado adicional en la póliza?»* |

Un nombre que no calza en un W-9, una licencia o un MSA **no** abre ventana: eso lo resuelve la validación directamente.

**Por qué es una ventana durable y no `toolApproval` del AI SDK.** El SDK v7 trae aprobaciones de herramienta con alcance de stream. Aquí no sirven: la pregunta tiene que **sobrevivir a que el proveedor recargue la página, cambie de pestaña o vuelva 4 minutos después**, y tiene que poder resolverse desde una instancia distinta de la que está corriendo el pipeline. Por eso el patrón es otro:

```
1. El host escribe PRIMERO el registro durable (document_confirmation)
   └── si esa escritura falla, degrada a solo-memoria; nunca bloquea el pipeline
2. Abre la ventana: temporizador de 5 min (unref'd) + espera en memoria
3. El proveedor responde por POST /api/vendor/documents/{uuid}/confirmation
   └── la respuesta gana PRIMERO el registro en base, después toca al esperador local
4. La instancia dueña también hace poll a la base cada 5 s
   └── así llega una respuesta contestada en otra instancia
5. Al vencer: arbitraje ATÓMICO — gana exactamente uno de {respuesta, vencimiento}
   └── si el vencimiento pierde, es porque una respuesta llegó tarde: se adopta
6. Resultado del vencimiento: la respuesta por defecto si se conoce,
   si no `timeout` → FAIL-OPEN, el documento sigue procesándose
```

La ventana dura 5 minutos por defecto; `VENDOR_CONFIRMATION_WINDOW_MS` la acorta para pruebas, y ese mismo valor entra en el cálculo del presupuesto de turnos del agente.

**Mientras tanto, el agente espera sin morirse.** El agente llama a `finalizeDocument`, el host le responde "confirmación pendiente" y el agente vuelve a llamar. Cada espera se trocea en tramos de 30 segundos para mantener vivo el bridge, y el presupuesto de turnos de la sesión se calcula con holgura explícita para eso: `28 + 2 × (ventana / 30 s)`.

**Garantías de seguridad de la ventana:**
- El `[uuid]` de la ruta debe coincidir con el documento de la confirmación: un POST cruzado **no puede** ganar la ventana de otro documento.
- La guardia de autenticación corre **antes** de parsear el cuerpo, para no entregar un oráculo 400-vs-401 sobre la forma del payload.
- Una corrida que ya abrió o resolvió una ventana **nunca se reintenta**: el reintento transitorio solo aplica mientras la corrida sigue siendo invisible para el proveedor.
- Preferencia por la vivacidad sobre la consistencia: si la base falla en el arbitraje, se registra la advertencia y el pipeline continúa — jamás se cuelga un documento por un problema de base.

**Los otros dos momentos del proveedor.** Además de la ventana, el proveedor toma dos decisiones propias, ambas verificadas en el servidor:

- **«No aplica»**: puede descartar categorías, pero el servidor filtra la lista contra las que el perfil marca como descartables, respeta el tope `maxManualDismissable`, **nunca** deja descartar una categoría obligatoria y **rechaza** cualquier categoría con una derivación abierta («Un oficial de cumplimiento está revisando estos requisitos…»). Las auto-descartadas por el perfil «Solo remoto» no entran en la lista manual ni gastan cupo, y una categoría descartada tampoco cuenta como satisfecha (nada de doble crédito).
- **Activar la cuenta**: la matemática de la compuerta que corre en el cliente es solo experiencia de usuario; el servidor **la vuelve a derivar** y responde, en este orden: `200` idempotente si ya estaba activada, `403` si el proveedor está `REJECTED` (revertirlo es decisión del oficial; `EXPIRED`, en cambio, sí es autoservicio), `412` si la cobertura todavía se está determinando, `400` **nombrando** las categorías obligatorias que faltan, o `400` con el rechazo genérico por conteo.

### 4.2 El HITL del oficial — la adjudicación

El oficial no "revisa lo que hizo la IA": es la autoridad del expediente. Sus siete mutaciones viven todas detrás de la misma guardia, y las **cuatro documentales** comparten además el contrato de atomicidad completo:

```
bloqueo de fila (FOR UPDATE) del documento y su proveedor
   → mutación
   → auditoría en la metadata + fila de actividad con actor y LARGO de la justificación
   → recálculo del proveedor
todo dentro de la MISMA transacción, con tramos de latencia registrados
   → después, fuera de la transacción, dispara la determinación de cobertura
```

| Mutación | Qué hace y qué la protege |
|---|---|
| `waiveDocumentValidation` | **Exime** una validación fallida. Exige justificación (10–1000 caracteres) y fecha de vencimiento. El **alcance se recorta en el servidor**: se toma lo que ese tipo de documento podría otorgar, y si las fallas son solo de nombre se reduce a las tres categorías de cobertura, para intersectarse por último con la intención del oficial — por construcción, un desajuste de nombre **jamás** puede eximir la identidad fiscal. Lleva además un seguro de concurrencia optimista: si el estado de la exención cambió mientras el oficial trabajaba, devuelve `CONFLICT` |
| `reclassifyDocument` | **Recategoriza** un documento mal tipificado. Inserta `version + 1` en la tabla de extracciones — **append-only, jamás sobrescribe la clasificación anterior**. Rechaza `UNKNOWN`, rechaza los tipos que el perfil del proveedor no acepta y también los que la política de la empresa no acepta, y revalida con los validadores que esa empresa cuenta |
| `grantManualRequirement` | **Otorga** una categoría a mano. Si el documento de respaldo falló, exige un `acknowledgeOverride` explícito. Rechaza otorgar lo ya satisfecho **salvo en dos casos**: las tres categorías de seguro, donde la determinación es la única autoridad, y cualquier categoría con una **derivación abierta** — ahí otorgar *es* la ratificación, y cierra la derivación como `GRANTED` con el id del oficial en la misma transacción |
| `revokeManualRequirement` | **Revoca** un otorgamiento, con justificación. Un índice parcial único garantiza un solo otorgamiento activo por (documento, categoría) |
| `retryDocumentProcessing` | Devuelve un documento `FAILED`/`ERROR` al estado `UPLOADED` y limpia su razón de falla, para que el pipeline pueda volver a reclamarlo. Es un **reset**, no una re-ejecución: nada lo reclama automáticamente |
| `finalizeStatus` | **Firma el estado final** (`PRE_APPROVED` / `NEED_REVIEW` / `APPROVED` / `REJECTED`). Sella `signoffUserId` y `signoffAt`: el expediente queda con nombre y hora. Es idempotente — refirmar el mismo estado no altera el reloj de la firma |
| `setVendorTags` | Etiqueta al proveedor para la gestión del listado (hoy las etiquetas son de solo lectura en el directorio) |

**Privacidad dentro del propio HITL:** el texto de justificación del oficial es información sensible de negocio y **nunca se escribe en los logs** — solo su largo (`noteLen`). Queda íntegro en la base, en la columna de la exención o del otorgamiento, para el auditor; hoy el panel no lo vuelve a mostrar.

**Autorización:** todas viven detrás de `complianceAdminProcedure`, que resuelve la sesión en el servidor, verifica el rol y acota a la organización del oficial. Un no-oficial recibe `NOT_FOUND`, no `FORBIDDEN` — el sistema no filtra ni siquiera la existencia del expediente. El oficial además alcanza las rutas por documento de su organización (procesar, responder una confirmación, borrar).

### 4.3 El HITL de la política — el requisito derivado

Cuando la política de la empresa **no** incluye una categoría en el poder de árbitro, el pliegue de evidencia hace algo muy específico: registra la evidencia y **retiene el otorgamiento**. La categoría no se otorga, no cuenta para la compuerta, y se abre una fila `requirement_referral`.

Es deliberadamente **lo contrario** de la ventana del proveedor:

- **No vence y no tiene respuesta por defecto.** Una pregunta de gobernanza que se resuelve sola no es una pregunta.
- Un índice parcial único garantiza **una sola derivación abierta** por (proveedor, categoría).
- El proveedor ve *«Documentación recibida. Un oficial de cumplimiento debe aprobar este requisito; no necesita hacer nada más.»* y no puede descartar esa categoría.
- El oficial ve *«Esperando su decisión: la documentación respalda este requisito, pero la política de la empresa no permite que el sistema lo apruebe. Use "Otorgar manualmente…".»*
- Otorgar manualmente **es** la ratificación: cierra la derivación como `GRANTED` con la identidad del oficial, en la misma transacción.
- Si la evidencia cambia y la categoría deja de estar retenida, el pliegue cierra la derivación como `SUPERSEDED` con su nota — nunca queda una pregunta huérfana.

Los otorgamientos de origen humano (concesión manual, exención) **nunca** se retienen: si lo hicieran, el camino de rescate del oficial sería inalcanzable.

### 4.4 El HITL de la gobernanza — la propuesta de directiva

En el nivel «Delegado — puede proponer directivas», el asistente del proveedor puede **redactar** un cambio a la política de la empresa. Nunca aplicarlo.

- La propuesta es un **diff de vocabulario cerrado**: aceptar o dejar de aceptar tipos de documento, agregar o quitar campos y validadores, mover categorías dentro o fuera del poder de árbitro, más un motivo de 1 a 500 caracteres que se redacta (PII) antes de persistir. No hay ningún campo de texto libre que pueda llegar al prompt del carril de documentos.
- **Una propuesta abierta por proveedor**, garantizado por índice parcial único.
- Al redactarla se corre un ensayo **asesor** de la puerta OPA y el resultado se le devuelve al modelo; la evaluación **autoritativa** vuelve a correr al aprobar.
- Aprobarla crea un borrador con la política propuesta y lo activa por el mismo camino que usa la consola — con la misma casilla opcional para re-anclar a los proveedores existentes— y deja obsoletas las demás propuestas abiertas de esa empresa.
- Rechazarla exige un motivo, y ese motivo se consolida en la memoria del asistente para que no vuelva a proponer lo mismo.
- Si la política activa cambió desde que se propuso, la propuesta se marca obsoleta en vez de aplicarse sobre una base que ya no existe.

### 4.5 Lo que el HITL *no* es

- **No es una aprobación ciega de lo que dijo el modelo.** El agente nunca propone "apruebo/rechazo": propone una clasificación y unos datos. Lo que se valida, se mapea y se aprueba es responsabilidad del código puro y de las personas.
- **No es un cuello de botella.** La ventana del proveedor solo se abre ante una ambigüedad real de identidad, y vence sola. Las renovaciones rutinarias se resuelven sin intervención de nadie. Y la derivación existe solo donde la empresa decidió que existiera.
- **No es opcional en su rastro.** Toda respuesta, toda adjudicación, toda derivación y toda propuesta quedan en la base con actor, hora, justificación y resultado. La pregunta "¿por qué este proveedor está aprobado?" siempre tiene respuesta.

---

## 5. Carril 1 — el pipeline por documento

```
Navegador                     Host (Next.js)                        MicroVM
   │                                │                                  │
   │ POST /upload-intake            │                                  │
   │───────────────────────────────►│ registra la fila PENDING +       │
   │                                │ devuelve URL prefirmada (900 s)  │
   │ PUT directo a MinIO ──────────────────────────►                   │
   │ POST /documents/{uuid}/process │                                  │
   │───────────────────────────────►│                                  │
   │                                │ 1. CAS: →PROCESSING (anti-doble) │
   │                                │ 2. lee los bytes (la lectura ES  │
   │                                │    la verificación)              │
   │                                │ 3. toma slot del semáforo        │
   │                                │ 4. crea sesión ────────────────► │ monta el archivo
   │◄═══ SSE: etapas, razonamiento ═╪══════════════════════════════════│ read → clasifica
   │                                │◄── saveClassification ───────────│
   │                                │    devuelve el esquema de        │
   │                                │    extracción para ESE tipo,     │
   │                                │    proyectado por la política    │
   │                                │◄── saveExtraction ───────────────│ extrae campos
   │                                │◄── finalizeDocument ─────────────│
   │                                │ 5. compara nombres de entidad    │
   │ 🧑‍⚖️ HITL ◄────────────────────│    → ventana durable de 5 min    │
   │ respuesta ────────────────────►│ 5b. gate del endoso general      │
   │  (o vence → fail-open)         │      (el agente reintenta        │
   │                                │       finalizeDocument cada 30s) │
   │                                │ 6. valida (código puro)          │
   │                                │ 7. mapea requisitos — y retiene  │
   │                                │    los que la política derive    │
   │                                │ 8. CAS: →PROCESSED / FAILED      │
   │                                │ 9. recalcula el proveedor        │
   │                                │10. dispara el carril de cobertura│
```

Puntos finos que importan:

- **Los dos gates HITL corren ANTES de la validación**, no después: primero se pregunta lo que solo el proveedor sabe, y recién entonces se juzga el documento con esa respuesta en la mano.
- **CAS en cada reclamo y cada terminal** (*compare-and-swap*): dos clics simultáneos o el conserje automático nunca pueden procesar dos veces ni pisar un estado final.
- **Semántica de desconexión:** el `abortSignal` de la ruta **excluye a propósito `req.signal`** — cerrar la pestaña no debe matar el procesamiento, y menos aún abandonar una ventana HITL abierta. Mientras haya una corrida que esta pestaña no está transmitiendo, el cliente se re-sincroniza con un *poll* de snapshot cada 10 s (y el resumen de cumplimiento se poletea aparte: 5 s mientras determina, 15 s si quedó rancio, 30 s en reposo), y la pregunta pendiente reaparece.
- **El catálogo manda, y la empresa lo acota:** 17 tipos (16 reales + `UNKNOWN`), y el agente solo puede elegir dentro de la **intersección** de lo que la política de la empresa acepta con lo que el perfil del proveedor deriva — la política es un tope superior, nunca un ensanchador. Por eso el rechazo dice «esta empresa no acepta ese tipo de documento».
- **Las descripciones del esquema son el prompt:** los `.describe()` de cada campo en Zod **son literalmente** las instrucciones de extracción que recibe el modelo, recortadas a los campos que la política seleccionó.
- **Rechazos antes de abrir el stream**, cada uno con su código: `503` nombrando las credenciales del harness que faltan, `503` si la guardia de contexto falla, `422` si el documento no tiene un tipo de archivo aceptado, `409` si no está en un estado reclamable, `410` si falta el archivo subido.
- **Sin fallo silencioso:** si la corrida termina sin estado final, el host escribe la falla con una razón accionable en español («El procesamiento terminó inesperadamente.», «El procesamiento fue interrumpido.»).
- **El conserje rescata lo estancado:** `PROCESSING` > 25 min, `PENDING` > 10 min y `UPLOADED` > 10 min pasan a `FAILED` con su motivo. Los 25 minutos están calibrados contra el presupuesto real: 14 min de corrida + cola detrás de 3 slots + hasta 3 min de arranque en frío.
- **El cuerpo del POST a `/process` se ignora deliberadamente**: todas las entradas se cargan de la fila y del almacenamiento. El cliente no puede dirigir la corrida.

Y tres resultados que no son "aprobado" ni "fallido":

- **Contado · cobertura** — un documento de seguro cuya única falla no informativa es el nombre de la entidad queda `FAILED`, pero sus límites siguen alimentando la determinación: la póliza de la matriz cubre legítimamente a la filial.
- **Derivado** — el documento probó una categoría que la política de la empresa no deja conceder al sistema; queda registrada y esperando a un oficial ([§4.3](#43-el-hitl-de-la-política--el-requisito-derivado)).
- **Aviso multi-entidad** — si el archivo contiene documentos de varias empresas, el agente lo reporta (hasta 8 nombres) y la tarjeta pide separarlos. Es advisorio: nunca bloquea nada.

---

## 6. Carril 2 — la determinación de cobertura

Un certificado de seguro rara vez alcanza solo: la póliza primaria da 1 M USD, la umbrella agrega 4 M encima, y el requisito es 5 M. Decidir eso exige leer varios documentos juntos.

Ese es el único trabajo del segundo carril: **una corrida por proveedor** —coalescida, con hasta 3 sesiones, una por intento— que lee las pólizas ya extraídas *más cualquier documento con un otorgamiento manual de cobertura vigente* (para que la decisión de un oficial nunca sea invisible al carril), y reporta por línea (`GENERAL_LIABILITY`, `WORKERS_COMP`, `AUTO`) el límite efectivo, qué documento aportó cuánto (`primary` / `umbrella` / `excess` / `rejected`) y un veredicto (`MEETS` / `BELOW` / `UNDETERMINED`).

Disciplina de este carril:

- **Coalescido por proveedor:** si llega un disparo mientras corre, se marca `rerun` en vez de apilar sesiones.
- **Caché por firma:** un hash del conjunto de entradas corta las recorridas idénticas; la firma lleva un eje de versión (`COVERAGE_DETERMINATION_VERSION`) que sirve de palanca de purga — subirla invalida toda determinación persistida aunque ningún insumo haya cambiado.
- **Nunca deja a un cliente girando:** un acierto de caché emite igual la etapa `converged`, y un conjunto de entradas vacío emite `unavailable`; ambos se sostienen 10 s para que el reintento de enganche del navegador (cada 4 s) alcance a recibir el cierre.
- **Fail-open explícito, pero solo cuando corresponde:** con el proveedor quieto, tras 3 intentos se persiste un registro `UNDETERMINED` y los lectores muestran "sin determinar", **nunca** una cifra vieja disfrazada de fresca. Si en cambio quedan documentos hermanos procesándose, el carril corre **un solo intento oportunista**, se retira en la etapa «Esperando a que terminen sus otros documentos…» y no persiste nada: el próximo terminal lo vuelve a disparar.
- **El host es la autoridad:** el validador rebota los payloads malos de vuelta al agente con su razón, sobre nueve puertas distintas —líneas vacías, líneas duplicadas, un uuid que no es del proveedor, montos negativos, una contribución rechazada que trae dólares, un límite nulo con veredicto que no sea `UNDETERMINED`, contribuciones que no suman el límite declarado dentro de ±1 %, contradicciones veredicto↔umbral, y un agregado incoherente (nunca menor que el límite por ocurrencia; nunca `MEETS` en responsabilidad civil si queda bajo el agregado exigido)— y las cifras persistidas se **re-derivan** de las contribuciones, así que la aritmética del modelo nunca llega a la base.
- **Solo la determinación otorga** las tres categorías de seguro. Un documento suelto no puede concederlas — y por eso, como se explicó en [§4.2](#42-el-hitl-del-oficial--la-adjudicación), el otorgamiento manual del oficial siempre está permitido ahí: es su único remedio cuando la máquina no alcanza a concluir.

El progreso se ve en vivo en el navegador con un `useChat` de solo-adjuntar que reconecta al stream GET (`resumeStream()` + `prepareReconnectToStreamRequest`). Son nueve etapas, y el proveedor las lee en español: «En cola para la revisión de cobertura…», «Iniciando la revisión de cobertura…», «Revisando sus pólizas…», «Verificando límites y acumulación de pólizas umbrella…», «Guardando la determinación de cobertura…», «Esperando a que terminen sus otros documentos…», «Revisando nuevamente…», «Revisión de cobertura completada.» y «La revisión de cobertura no pudo completarse.». Mientras se recalcula, las cifras viejas siguen visibles bajo un velo, con el pie «Actualizando con sus documentos más recientes…» — nunca se atenúa el texto ni se finge frescura.

---

## 7. Carril 3 — el asistente del proveedor y su memoria

Un cajón de chat plegable en el portal. Por dentro es **el mismo harness**, y ahí está lo interesante.

### Sesión estacionada: `stop()`, nunca `detach()`

Una conversación dura minutos u horas, pero solo ocupa cómputo mientras un turno se transmite. Entonces:

```
turno 1 ── crea sesión ── transmite ── session.stop() ── guarda resumeState en Postgres
                                            └── libera el puerto bridge
turno 2 ── createSession({ sessionId, resumeFrom }) ── transmite ── stop() ── guarda
```

`stop()` (a diferencia de `detach()`) **libera el arriendo del puerto bridge**, y su parada de sandbox es un no-op en modo *wrap*, así que la MicroVM compartida sobrevive. Si se usara `detach()`, cada chat estacionado se quedaría con un puerto y mataría de hambre al grupo de 4. Reanudar desde el estado detenido reaparece el runtime sobre el sandbox pre-horneado en segundos, no en los minutos de un arranque en frío. Un turno solo se estaciona si no abortó ni falló de forma fatal; si falló, la sesión se destruye y el siguiente mensaje arranca limpio.

Además hay un *try-lock* por proveedor: un segundo turno simultáneo en el mismo hilo se rechaza con 409, y si el grupo de puertos está agotado el proveedor lee «El asistente está ocupado mientras se procesan sus documentos — intente de nuevo en un momento.» en vez de una espera muda.

### Cinco herramientas del host, y la empresa decide cuántas ve el modelo

El nivel de privilegio sale de la política anclada al proveedor y se aplica como **lista blanca `activeTools` recalculada en cada turno** — nunca como una instrucción en el prompt. Revocar el nivel solo puede achicar la superficie, y nunca depende de que una sesión estacionada se entere.

| Herramienta | Nivel | Qué entrega | Cómo se ve en el chat |
|---|---|---|---|
| `getComplianceState` | siempre | El registro de cumplimiento completo **en este instante**: categorías con estado, la compuerta de activación, cada documento con su validación, la determinación de cobertura y los vencimientos próximos | «Consultando su registro de cumplimiento…» → «Se consultó su registro de cumplimiento» |
| `getDocumentDetails` | siempre | Un documento en profundidad: razonamiento de clasificación, campos extraídos, resultado regla por regla | «Revisando un documento…» → «Se revisó un documento» |
| `rememberFacts` | siempre | Guarda de 1 a 5 hechos duraderos (1–300 caracteres cada uno) que el proveedor contó sobre su negocio | «Tomando nota…» → «Anotado para la próxima vez» |
| `proposeDirectiveChange` | solo «Delegado» | Redacta —nunca aplica— un cambio a la política de la empresa, con un ensayo asesor de la puerta OPA | «Redactando una propuesta de directiva…» → «Propuesta enviada a revisión» |
| `getDirectiveProposals` | solo «Delegado» | El estado de las propuestas de ese proveedor: pendiente, aprobada, rechazada u obsoleta | «Consultando sus propuestas…» → «Se consultaron sus propuestas» |

Las instrucciones obligan a llamar a `getComplianceState` antes de responder cualquier pregunta de estado — nunca contestar desde el historial. Los números que da el asistente **son los mismos** que renderiza la página: ambas superficies derivan del mismo módulo de snapshot, que además vuelve a enmascarar identificadores fiscales antes de entregarlos, porque la salida de una herramienta viaja por el stream y queda en la transcripción. Toda herramienta falla suave (`{ ok: false, note }`); una excepción mataría el stream en vivo.

### El asistente también respeta el HITL

Sus instrucciones lo dicen explícitamente: **"usted nunca decide el cumplimiento"**. Puede explicar por qué un documento falló, qué falta para activar o qué significa una exención, pero tiene prohibido pasar por encima de una decisión del oficial, prometer un resultado o inventar un estado. Sabe además distinguir los dos estados donde el proveedor no tiene nada que hacer —«determinando» y «esperando a un oficial»— y no los responde pidiendo que suba algo. En el nivel «Delegado» se agrega una regla más: una propuesta es una solicitud, no una promesa.

### Memoria de largo plazo: semántica, local y reconstruible

El asistente recuerda cosas entre sesiones. Así funciona, en concreto.

#### El reparto: Postgres es la verdad, Qdrant es el índice

| Pieza | Rol | Si se cae |
|---|---|---|
| `assistant_memory` (Postgres) | **Sistema de registro.** Cada hecho, con su origen (`tool` / `extracted` / `directive`), su alcance y su historial (`superseded_at`, `deleted_at`) | Nada funciona sin la base; es la misma de toda la app |
| Qdrant (contenedor propio) | Índice vectorial derivado y **desechable** de la colección `vendra_assistant_memory` | El recuerdo degrada a recencia sobre Postgres; el chat sigue igual |
| Ollama (contenedor propio) | *Embeddings* locales con `bge-m3`, 1024 dimensiones | Igual: degrada a recencia |
| mem0 OSS | La capa que extrae hechos, indexa y busca. Solo `server/memory/mem0-client.ts` puede importarla, y solo por `mem0ai/oss` | El cliente nunca cachea un fallo: el siguiente turno reintenta |
| API de Anthropic | La extracción de hechos usa el LLM `anthropic` de mem0 (`claude-haiku-4-5-20251001`) — **el único cliente de Anthropic que sostiene el código de la app** | Sin llave, la capa queda `unconfigured` y no se pierde nada más que la extracción |

`MEM0_TELEMETRY=false` es obligatorio y se fija antes del import dinámico: mem0
publica telemetría a un sumidero externo por defecto, y eso rompería la promesa
de dos dependencias externas.

#### Quién escribe: dos productores, una sola compuerta de redacción

```
DURANTE el turno  │ el modelo llama a rememberFacts(...)
                  │   host: redactar PII → insertar en assistant_memory → encolar para indexar
DESPUÉS del turno │ el texto del PROVEEDOR (nunca la respuesta del asistente) se encola
                  │   drenaje: mem0 + Haiku extraen hechos duraderos → redactar → reconciliar
ANTES del turno   │ recallMemory(consulta = el texto del turno) → bloque <long_term_memory>
```

- La escritura del modelo es síncrona y visible: la píldora «Tomando nota…» aparece en el chat. La memoria no se escribe a espaldas de nadie.
- La extracción de fondo solo mira **lo que dijo el proveedor**, y solo si el turno supera 24 caracteres después de redactar. mem0 recibe instrucciones en español: hechos en tercera persona sobre la **empresa**, nunca datos de contacto ni identificadores fiscales, nunca el estado momentáneo de un documento, nunca lo que dijo el asistente.
- La **redacción de PII** corre en cuatro caminos: sobre los hechos que elige el agente, sobre el texto del turno antes de encolarlo, sobre cada hecho que mem0 extrae y **también sobre lo que vuelve del índice** al recordar. El orden importa: marcado `<…>` → identificadores personales → EIN con guion → teléfonos → correos → colapso de espacios.
- **Deduplicación en dos niveles**: exacta, por un índice único parcial sobre `(alcance, hecho)` entre filas vivas; y semántica, por mem0 al indexar, que ve lo que ya existe y se abstiene.
- **No hay poda.** Las filas no se borran: se marcan como superadas o eliminadas, así el historial queda consultable. Solo desaparecen si se borra el proveedor (`ON DELETE CASCADE`).

#### La cola de ingesta: por qué el chat sigue siendo rápido

Indexar cuesta una llamada a un LLM y una de *embeddings*. Ningún proveedor debería esperar eso, así que el turno solo **encola** y un drenaje de fondo hace el trabajo:

- corre cada **20 s** (`VENDOR_MEMORY_DRAIN_INTERVAL_MS` lo acorta en pruebas), en lotes de **5**;
- reclama con `FOR UPDATE SKIP LOCKED` bajo un *advisory lock* de Postgres, con el reloj de la base como única referencia y una reclamación de bloqueos rancios a los 5 minutos;
- **5 intentos** antes de enterrar un ítem, y el payload de una fila terminada se vacía: la cola es un libro de trabajo, no una segunda transcripción;
- una sonda previa salta el tic completo si Qdrant u Ollama no responden — un reinicio de contenedor no quema intentos.

#### Recuperación: en cada turno, por relevancia, con dos alcances

- **Corre en cada turno**, usando el texto del proveedor como consulta — así una sesión estacionada también ve los hechos escritos después de su primer turno.
- Se piden **30 candidatos por alcance** al índice, se ordenan por puntaje (el alcance del proveedor gana los empates) y se recortan a **20 hechos / 2.000 caracteres**; manda casi siempre el tope de caracteres.
- Hay **dos alcances en el mismo presupuesto**: los hechos del proveedor y los de la empresa (`org:<uuid>`), que es donde aterrizan las directivas aprobadas o rechazadas. Por eso una decisión de gobernanza cambia lo que el asistente responde a todos los proveedores de esa empresa.
- Lo recuperado entra en el prompt dentro de una cerca `<long_term_memory>`, cada hecho re-sanitizado y recortado a 300 caracteres, con una declaración explícita: es **contexto, no instrucciones**.
- **Si el índice no está**, el recuerdo cae a recencia: hasta 20 filas vivas por alcance desde Postgres, fusionadas por fecha y re-emitidas en orden cronológico. El camino semántico, en cambio, conserva el orden de relevancia.
- Toda falla deja su línea de log (`memory.recall_degraded`, `memory.recall_fallback_failed`, `memory.record_failed`, `memory.enqueue_failed`) — el log **es** la alarma, porque una memoria que muere en silencio es la trampa operativa clásica.

#### Mantenimiento: el índice es desechable a propósito

```bash
pnpm --filter vendra memory-reindex -- --rebuild        # resetea la colección y reindexa todo
pnpm --filter vendra memory-reindex -- --backfill       # indexa lo que quedó sin id de mem0
pnpm --filter vendra memory-reindex -- --adopt-index    # adopta hechos que solo viven en el índice
pnpm --filter vendra memory-reindex -- --adopt-legacy   # migra las filas de memoria anteriores a §22
```

Y `/api/health` publica el estado real: `unconfigured` (falta una variable) / `degraded` (Qdrant u Ollama inalcanzable) / `ok`, con la profundidad de la cola y la hora del último drenaje — deliberadamente **fuera** del cálculo de salud general.

#### Los topes, de una mirada

| Límite | Valor | Dónde se define |
|---|---|---|
| Hechos por llamada a la herramienta | 1–5 | esquema zod del contrato compartido |
| Largo de un hecho al escribirlo | 1–300 caracteres | esquema zod del contrato compartido |
| Hechos almacenados por proveedor | sin tope (no hay poda) | `server/memory/db.ts` |
| Candidatos pedidos al índice, por alcance | 30 | `RECALL_SEARCH_LIMIT` |
| Hechos inyectados en el prompt | 20 | `RECALL_MAX_FACTS` |
| Caracteres inyectados en el prompt | 2.000 | `RECALL_MAX_CHARS` |
| Largo de un hecho al inyectarlo | 300 caracteres | `sanitizeInline` |
| Turno mínimo para extraer | 24 caracteres | `MIN_TURN_CHARS` |
| Mensajes cargados al abrir el chat | 80 | `ASSISTANT_HISTORY_LIMIT` |
| Transcripción conservada | 400 filas (5 × el tope anterior) | poda desde el `onEnd` del stream |
| Largo de un mensaje | 4.000 caracteres, hasta 4 partes | contrato compartido |
| Turnos por proveedor | 20 cada 5 min | `RATE_LIMIT_MAX` |

`server/memory/` es la capa; `server/assistant/memory.ts` es solo una fachada
(`recallMemory` / `rememberFacts` / `observeVendorTurn`). Si algún día cambia el
almacenamiento, `mem0-client.ts` es la costura — nadie más se entera.

### Identidad, límites y desconexión

La identidad se implica por cookie: la sesión de better-auth nombra al proveedor — **el cuerpo del request nunca**. Un rechazo por límite de tasa no consume cupo, y el cupo se devuelve solo en los rechazos previos al trabajo (503 de arriendo, 409 de hilo ocupado); un Stop del usuario no lo devuelve, para que un bucle de detener-y-reintentar no burle el límite. Cada escritura en `assistant_chat_turn` cae sobre `UNIQUE(thread_id, message_id)`, la frontera de idempotencia de sus dos espacios de nombres vivos: la transcripción (`vendor-chat:<uuid>`, una fila por mensaje) y el estado de reanudación del harness (`vendor-session:<uuid>`, una sola fila con *upsert*). A diferencia del carril de documentos, aquí el abort **sí** compone `req.signal`: un turno de chat solo le importa a quien lo está mirando. La pregunta del usuario se pre-persiste de forma optimista, y una respuesta interrumpida se guarda marcada como tal («— *interrumpido*»), para que nunca reaparezca disfrazada de respuesta completa.

---

## 8. La gobernanza: la política de cada empresa y la puerta OPA

Las secciones anteriores describen un sistema con una frontera fija entre lo que
decide la máquina y lo que decide una persona. Esta sección es la que hace esa
frontera **configurable por empresa** — y auditable.

### La consola de plataforma

`/platform` es la tercera superficie, con su propio rol (`SUPERADMIN`), su propio
router tRPC (14 procedimientos, el único sin alcance por organización) y su
propia guardia: a cualquier otro rol la consola lo devuelve a su propia
superficie, y esos procedimientos le responden `NOT_FOUND`.

- **Crear una empresa** («Nueva empresa»): nombre, identificador (2–49 caracteres, minúsculas, números y guiones; `vendra-platform` está reservado), uno de los dos perfiles de requisitos y, opcionalmente, la primera cuenta de oficial. La organización, su perfil, su política v1 y sus filas por tipo de documento nacen en **una sola transacción**; la cuenta de oficial se crea después con el SDK de better-auth y, si falla, la transacción se compensa borrando lo creado.
- La política v1 que se genera es **de comportamiento idéntico al de siempre**: acepta todos los tipos que el perfil deriva, extrae todos los campos, cuenta todos los validadores y deja **todas** las categorías bajo el poder de árbitro del sistema. La gobernanza es invisible hasta que alguien la estrecha.
- **Crear oficiales** («Añadir oficial de cumplimiento»): la cuenta podrá revisar y aprobar a los proveedores de esa empresa y de ninguna otra. Una empresa sin oficiales se marca en el directorio y en su ficha.
- El directorio muestra, por empresa, proveedores, tipos de documento aceptados, categorías con aprobación automática, la versión activa y lo que falta: «Sin oficiales», «Borrador sin activar», «Propuestas pendientes (N)».

### Las cuatro perillas de una política

| Perilla | Qué controla | Qué la protege |
|---|---|---|
| **Documentos aceptados** | Cuáles de los 16 tipos puede subir un proveedor de esa empresa | Se intersecta con el perfil del proveedor: la política acota, nunca ensancha |
| **Campos a extraer** | Qué campos se le piden al agente por tipo de documento | Los **estructurales** van marcados «obligatorio», bloqueados y se re-agregan al guardar: deseleccionar la entrada de un validador falla ruidosamente, pero deseleccionar la entrada de una derivación falla en silencio (sin `coverage_lines` un ACORD 25 dejaría de otorgar cobertura y todos los checks seguirían pasando) |
| **Validaciones que cuentan** | Qué reglas deciden el veredicto de ese tipo | Un tipo sin validaciones no se puede activar: «Sin validaciones, cualquier documento de este tipo pasaría sin revisión.» Y si una política deja un documento sin ninguna regla aplicable, el documento falla con un motivo explícito en vez de pasar por verdad vacua |
| **Aprobación automática** (poder de árbitro) | Qué categorías puede resolver el sistema solo («El sistema decide») y cuáles exigen a una persona («Un oficial debe aprobarla») | Lo que queda fuera se **deriva** ([§4.3](#43-el-hitl-de-la-política--el-requisito-derivado)); los otorgamientos de origen humano nunca se retienen. Una lista vacía significa «derivar todo», no «autonomía por omisión» |

Y una quinta, sobre el asistente: **«Conversacional — solo explica»** o
**«Delegado — puede proponer directivas»** ([§7](#7-carril-3--el-asistente-del-proveedor-y-su-memoria)).

### La puerta de admisibilidad: OPA de verdad, dentro del proceso

Nada se activa sin pasar una política Rego. No es una metáfora: `policy/company-policy.rego`
se compila a `policy/company-policy.wasm` y se evalúa **en proceso** con
`@open-policy-agent/opa-wasm`. Sin sidecar, sin subproceso, sin red — y nunca en
la ruta de un documento: corre en los momentos de gobernanza (validar un
borrador, activarlo, provisionar una empresa, el *backfill* de arranque, la
reevaluación de las políticas vigentes) y en el ensayo asesor que pide el
asistente al redactar una propuesta.

- El artefacto se **verifica por SHA-256** contra su manifiesto antes de cargarse. Si falta, si no calza o si OPA no devuelve decisión, el gate **falla cerrado**: no hay camino en el que una política se active sin veredicto.
- Los hechos que recibe Rego se regeneran **de los motores reales** en cada llamada (catálogo de tipos, validadores por tipo, categorías que cada tipo puede otorgar, campos estructurales, vocabulario de privilegios), así que el gate no puede aprobar contra una copia vieja del catálogo.
- Tiene **13 reglas de rechazo** —tipo desconocido, ningún documento aceptado, un tipo sin validadores, un validador que no aplica a ese tipo, umbrales que vuelven un validador insatisfacible o que apagan la comprobación de límites, campo desconocido, campo estructural deseleccionado, categoría requerida imposible de otorgar, árbitro sobre algo no requerido, categoría desconocida, privilegio desconocido, y «Delegado» en una empresa sin oficiales— y **2 advertencias**: una categoría obligatoria derivada y un tipo con validaciones reducidas.
- Los hallazgos viajan **estructurados** (`error.data.admission`), no como texto, y la consola los traduce al español: «La configuración es válida», «Advertencias de esta configuración», «No se puede activar todavía».
- Cada evaluación y cada acción de gobernanza deja un acta en `company_policy_decision` con el actor, la versión, los hallazgos, los umbrales evaluados y **los hashes del rego y del wasm que decidieron**. La pregunta «¿quién permitió que la IA decidiera esto, y bajo qué reglas?» tiene respuesta sin depender de la retención de logs.
- **Reevaluar políticas activas** vuelve a pasar la puerta sobre todas las políticas vigentes de todas las empresas: una mejora del motor puede dejar inadmisible algo que ya estaba activo, y eso hay que verlo.

### Versionado y anclaje: a nadie se le cambian las reglas a mitad del proceso

- Una política es una **versión inmutable**: `DRAFT` → `ACTIVE` → `ARCHIVED`, con un índice parcial único que garantiza **como máximo una activa por empresa**.
- Activar archiva la anterior, sella quién y cuándo, y escribe su acta — todo en una transacción.
- **Cada proveedor queda anclado** a la versión bajo la que se le juzga (`vendor.company_policy_id`), fijada al registrarse. Activar una versión nueva rige para los que lleguen después; aplicarla a los existentes es una casilla explícita («Aplicar también a los N proveedor(es) existentes») que escribe una actividad por proveedor re-anclado.
- El ancla se estampa además en **cada extracción**, para que un oficial pueda distinguir «el documento no traía ese dato» de «la política vigente no pedía ese campo».
- Al arrancar, un *backfill* idempotente le da a cada organización sin política una v1 admisible y ancla a los proveedores sueltos; si el gate no puede correr, falla cerrado.

### Cómo se opera esto desde la terminal

```bash
pnpm --filter vendra create-company -- --name "…" --slug … --preset construction-sub
pnpm --filter vendra policy:build      # recompila company-policy.wasm + su manifiesto
pnpm policy:check                      # la suite Rego completa, sin red
```

`policy:build` corre `opa check --strict` y `opa test` **antes** de compilar, y
escribe el manifiesto de integridad. La suite de `policy/` es la especificación
ejecutable del sistema: seis grupos de comprobación con umbrales de cobertura
propios —invariantes del repositorio, satisfacibilidad de perfiles, adjudicación
de payloads de cobertura, admisibilidad de políticas, la frontera del árbitro y
un barrido de 16.384 escenarios de la compuerta de activación—, más el lint
estricto, la frescura del pin de capacidades y los invariantes de motor en
TypeScript. Corre con un archivo de capacidades fijado
que **le quita a OPA `http.send`**: una comprobación no puede, ni por accidente,
adquirir una dependencia de red. El detalle completo del análisis está en
[`docs/opa-applications.md`](docs/opa-applications.md).

---

## 9. Arquitectura completa

```mermaid
flowchart TB
    subgraph browser["Navegador"]
        VP["Portal del proveedor<br/>useChat · SSE · AI Elements"]
        HITL["🧑‍⚖️ Tarjeta de confirmación<br/>ventana de 5 min"]
        OD["Panel del oficial<br/>🧑‍⚖️ 7 mutaciones de adjudicación"]
        PL["Consola de plataforma<br/>🧑‍⚖️ políticas y propuestas"]
    end

    subgraph host["Contenedor app — Next.js 16 (Node)"]
        AUTH["better-auth<br/>correo+clave · 3 roles en uso"]
        API["Rutas /api/vendor/*<br/>streams SSE"]
        CONF["Ventanas HITL durables<br/>confirmations.ts"]
        TRPC["Routers tRPC<br/>oficial 5+7 · plataforma 5+9"]
        GOV["Política de empresa + puerta OPA<br/>company-policy · policy-admission (Wasm)"]
        LANES["Carriles del harness<br/>doc-run · coverage-runner · assistant"]
        MEM["Capa de memoria<br/>ingesta · drenaje · recuerdo"]
        PURE["@vendra/workflow<br/>motores puros, sin IA ni IO"]
        RECOMP["recompute · sweep · janitor · referrals"]
        DRIZ["Drizzle ORM"]
        S3C["Cliente S3"]
    end

    subgraph local["Contenedores propios"]
        PG[("Postgres 16")]
        MINIO[("MinIO")]
        QD[("Qdrant")]
        OL[("Ollama · bge-m3")]
    end

    subgraph remote["Dependencias remotas (solo egreso)"]
        VS["Vercel Sandbox MicroVM<br/>Claude Code + bridge"]
        ANTH["API de Anthropic"]
    end

    VP --> API
    VP --- HITL
    HITL --> CONF
    OD --> TRPC
    PL --> TRPC
    VP -.->|cookie| AUTH
    OD -.->|cookie| AUTH
    PL -.->|cookie| AUTH
    API --> LANES
    LANES --> CONF
    LANES --> GOV
    TRPC --> GOV
    CONF --> DRIZ
    GOV --> DRIZ
    TRPC --> RECOMP
    LANES --> PURE
    GOV --> PURE
    LANES --> RECOMP
    LANES --> MEM
    RECOMP --> DRIZ
    AUTH --> DRIZ
    MEM --> DRIZ
    MEM --> QD
    MEM --> OL
    MEM --> ANTH
    DRIZ --> PG
    API --> S3C --> MINIO
    VP -.->|"PUT prefirmado"| MINIO
    LANES <-->|"bridge :4000-4003"| VS
    VS --> ANTH
```

### Subsistemas, uno por uno

| Subsistema | Dónde vive | Qué hace |
|---|---|---|
| **Runtime de sandbox compartido** | `server/harness/sandbox.ts` | UNA MicroVM de larga vida en modo *wrap*; grupo de 4 puertos bridge; pre-horneado del bridge; renovación a los 35 min con 8 min de gracia; egreso restringido; nivel de esfuerzo inyectado por entorno; guardia de credenciales con errores nombrados; calentamiento desde `instrumentation.ts` |
| **Pipeline por documento** | `server/harness/doc-run.ts`, `tools.ts`, `prompt.ts` | Reclamo CAS → verificación de bytes → sesión `HarnessAgent` con el documento montado → 4 herramientas del host → gates HITL, validación y transiciones del lado del host |
| **🧑‍⚖️ Ventanas HITL del proveedor** | `server/harness/confirmations.ts` + `/api/vendor/documents/[uuid]/confirmation` | Registro durable primero, ventana de 5 min, poll cruzado cada 5 s entre instancias, esperas troceadas de 30 s que mantienen vivo el bridge, arbitraje atómico entre respuesta y vencimiento, expiración *fail-open*. Ver [§4.1](#41-el-hitl-del-proveedor--la-ventana-de-confirmación-durable) |
| **🧑‍⚖️ Kit de adjudicación del oficial** | `server/trpc/router.ts`, `server/harness/db/referrals.ts`, `features/…/components/officer/` | 5 consultas y 7 mutaciones; las cuatro documentales bajo el contrato completo (bloqueo de fila → mutación → auditoría y actividad → recálculo, en la misma transacción, y después el disparo de cobertura). Alcances de exención recortados en el servidor, recategorización *append-only*, firma con actor y hora, y la ratificación de derivaciones cerrada en la misma transacción. Ver [§4.2](#42-el-hitl-del-oficial--la-adjudicación) |
| **🧑‍⚖️ Gobernanza de la política** | `server/company-policy.ts`, `company-provisioning.ts`, `policy-admission.ts`, `directive-proposals.ts`, `server/trpc/platform-router.ts`, `policy/*.rego` | Provisión de empresas, política versionada con anclaje por proveedor, puerta OPA/Wasm verificada por hash, acta de decisiones, propuestas de directiva. Ver [§8](#8-la-gobernanza-la-política-de-cada-empresa-y-la-puerta-opa) |
| **Contrato del stream** | `features/vendor-compliance/lib/vendor-harness-contract.ts` | UN archivo compartido por rutas, herramientas y cliente: *data parts* tipados (etapas, extracción, validación, **confirmación**, derivación, terminal), esquemas zod de las herramientas, constantes de subida, topes de la propuesta de directiva |
| **Asistente del proveedor** | `server/assistant/` + `/api/vendor/assistant` | Sesión estacionada por hilo, 3 o 5 herramientas del host según el privilegio de la empresa, transcripción en Postgres, enmascarado de PII en la salida de cada herramienta |
| **Capa de memoria** | `server/memory/` (config · mem0-client · ingest · drain · recall · redact · db · reindex · directives) | Postgres como sistema de registro, índice semántico en Qdrant con *embeddings* locales, cola de ingesta drenada cada 20 s, redacción de PII en cuatro caminos, degradación a recencia. Ver [§7](#7-carril-3--el-asistente-del-proveedor-y-su-memoria) |
| **Carril de cobertura** | `server/harness/coverage-runner.ts` | Corrida coalescida por proveedor, caché por firma de entradas, pensamiento deshabilitado, validación del payload en el host, registro `UNDETERMINED` a prueba de fallos |
| **Elementos de IA vendorizados** | `src/components/ai-elements/` | Primitivas de render del AI SDK como código propio: `Tool` con su máquina de estados, `Reasoning` que se abre y cierra solo, `Task` como checklist de etapas, `Conversation`, `PromptInput`, `Response` |
| **Motores puros** | `packages/workflow/src/vendor/` | Sin IA, sin IO: catálogo de 16 tipos más `UNKNOWN` con sus esquemas de extracción, 11 validadores, mapa documento→categoría, matemática de la compuerta, trazabilidad, comparación difusa de nombres de entidad (lo que dispara el HITL), núcleo de cobertura y la capa de política por empresa |
| **Motor de recálculo** | `server/recompute.ts` | Todo terminal, toda adjudicación del oficial y todo tic del barrido pasan por un único pliegue: lecturas sobre la transacción del llamante, categorías de cobertura solo desde la determinación, reconciliación de derivaciones, un solo *merge* jsonb, bloqueos `FOR UPDATE` |
| **Barrido de vencimientos** | `server/sweep.ts` | Tic horario con *advisory lock*: `APPROVED → EXPIRED` cuando caduca un documento requerido; avisos a 30/14/1 día; la renovación válida revierte el estado sola, sin HITL |
| **Conserje** | `server/harness/janitor.ts` | Rescata corridas huérfanas y subidas incompletas (por ejemplo si la app se reinició a mitad del procesamiento) |
| **Página pública** | `src/features/landing/` | La superficie de `/` para visitantes no autenticados: las demostraciones animadas del producto, sin recursos de terceros |

### Reglas de diseño no negociables

- **Veracidad ante todo:** una corrida que no terminó **no escribe nada**; una determinación vieja se muestra como "actualizando", nunca como cifra fresca; un documento fallido trae una razón real y accionable; una respuesta interrumpida del asistente queda marcada como interrumpida.
- **El humano nunca queda bloqueado ni ignorado:** una ventana de confirmación siempre se cierra (con respuesta o con vencimiento registrado), una adjudicación siempre se refleja en el estado dentro de la misma transacción, y una derivación abierta nunca se resuelve sola ni desaparece sin dejar su resolución.
- **La autonomía es configurable, pero nunca implícita:** lo que el sistema puede aprobar solo está declarado por empresa, admitido por una puerta que falla cerrada, versionado y anclado a cada proveedor.
- **Observabilidad desde el día uno:** cada evento es una línea grepeable — `[vendra:<evento>] k=v k=v` — desde `process.start` hasta `process.done`, incluyendo `confirmation.answered` / `confirmation.expired`, `officer.waive`, `coverage.payload_bounced` y `memory.drain_tick`, con tramos de latencia por fase y **nunca** el texto de una justificación.
- **Cero confianza en el cliente:** toda ruta `/api/vendor/*` y todo procedimiento tRPC resuelve la sesión en el servidor. El cuerpo del POST de `/process` se ignora deliberadamente: las entradas se cargan de la fila y del almacenamiento.

---

## 10. El rol de cada pieza del stack

### Capa de IA — AI SDK v7

| Paquete | Rol exacto en Vendra |
|---|---|
| **`ai`** (núcleo v7) | Solo tres cosas: `tool()` para definir las herramientas del host, `createUIMessageStream` / `createUIMessageStreamResponse` para abrir el stream hacia el navegador, y `toUIMessageStream` para fusionar el stream del agente. **Ninguna llamada directa a `generateText` / `streamText`** |
| **`@ai-sdk/harness`** | La clase `HarnessAgent`: crear sesión, transmitir, reanudar, detener, destruir. También `prepareSandboxForHarness` (pre-horneado) y `createFileReporter` (telemetría de turnos fallidos a `.harness-logs/`) |
| **`@ai-sdk/harness-claude-code`** | El adaptador concreto: `createClaudeCode({ model, thinking, maxTurns, auth })`. Instala y opera el CLI de Claude Code dentro de la VM y expone sus herramientas internas |
| **`@ai-sdk/sandbox-vercel`** | El proveedor de sandbox: `createVercelSandbox({ sandbox, bridgePorts })` en modo *wrap* — este repo es dueño del ciclo de vida de la VM |
| **`@vercel/sandbox`** | El SDK crudo de la MicroVM: `Sandbox.create({ runtime, ports, networkPolicy, timeout, env })`, y sus tipos de error (`APIError`, `StreamError`) que se aplanan en campos de log |
| **`@ai-sdk/react`** | `useChat` en el cliente: consume los *data parts* tipados del stream — incluida la parte de confirmación que **renderiza la tarjeta HITL** —, maneja `resumeStream()` para reconectar al progreso de cobertura y renderiza las partes de herramienta |

> Nota sobre el HITL y el SDK: v7 ofrece `toolApproval` para aprobaciones humanas con alcance de stream. Vendra **no lo usa** a propósito — ver [§4.1](#41-el-hitl-del-proveedor--la-ventana-de-confirmación-durable): la ventana debe sobrevivir a recargas y resolverse desde cualquier instancia, y eso exige un registro durable en base, no un estado de stream.

### Autenticación — better-auth

Instancia local, **solo correo y contraseña**. Sin SSO, sin captcha, sin envío de correos, sin *haveibeenpwned*: crear cuenta e iniciar sesión funcionan **100% offline** contra los contenedores propios del repo.

- Cuatro valores de rol declarados y tres en uso real: `VENDOR_CONTACT`, `COMPLIANCE_OFFICER` y `SUPERADMIN`, más `ADMIN` como oficial de mayor alcance dentro del tenant. Se guardan como `additionalFields` en la fila de usuario junto con `organizationId` y `vendorId`. **Ese rol es lo que separa los puntos HITL**: quién puede responder una ventana, quién adjudica y quién activa una política.
- `SUPERADMIN` queda **fuera** del conjunto de roles de oficial a propósito y tiene su propia guardia, que nunca aplica alcance por organización: es otro eje, no un oficial más grande.
- **`input: false` en cada campo adicional**: el rol y el vínculo con el tenant nunca son seteables desde el cliente — se asignan en el servidor al registrar.
- `disabledPaths: ["/sign-up/email"]`: el registro va por `/api/vendor/register`, que es quien asigna rol y tenant. El `auth.api.signUpEmail` interno sigue disponible para la semilla, los scripts y la consola de plataforma.
- **Rate limiting activo en todos los modos** (la librería por defecto solo lo activa en producción) y telemetría explícitamente apagada.
- Toda credencial se crea y verifica por el SDK; la app solo **lee** la tabla `user` por Drizzle (para listar oficiales y para fijar rol y tenant justo después del alta). `session`, `account` y `verification` no se tocan nunca directo.

### Base de datos — Drizzle ORM + Postgres 16

Este repositorio **es dueño de su esquema**. Nada de apuntar a una base ajena.

- El esquema vive en un solo archivo: `packages/db-vendor/drizzle/schema.ts`.
- Los cambios se generan con `drizzle-kit generate` y se aplican con el migrador programático de `drizzle-orm` (servicio `migrate` del compose). **Nunca `push`, nunca DDL a mano por psql.**
- **Toda interacción con la base pasa por Drizzle.** El *query builder* es la regla; el tag parametrizado ``` sql`` ``` se permite solo donde el builder no tiene equivalente (advisory locks, *merge* de hermanos jsonb, `NULLS LAST`). Nunca SQL armado con strings, nunca `sql.raw`, nunca un segundo cliente `pg`.
- Es también **el sustrato del HITL**: la durabilidad de la ventana de confirmación, la atomicidad de cada adjudicación y la unicidad de «una derivación abierta por categoría» o «una política activa por empresa» son garantías de Postgres expresadas en Drizzle.

### Almacenamiento — MinIO (compatible con S3)

Dos clientes S3 sobre un mismo bucket, y la razón es sutil: **SigV4 firma el host**.

- `storageClient` → operaciones del servidor contra el endpoint interno (`http://minio:9000`).
- `presignClient` → prefirma contra el endpoint que **el navegador** puede alcanzar (`http://localhost:9000`), y con `requestChecksumCalculation: "WHEN_REQUIRED"` (el default nuevo del SDK de AWS mete un checksum CRC32 de cuerpo vacío que una subida de navegador no puede satisfacer).

Las URLs prefirmadas —de subida y de lectura— duran 900 s. En AWS real basta con no definir los endpoints: la resolución por defecto toma el control, un solo camino de código.

### Memoria — mem0 OSS + Qdrant + Ollama, autoalojados

| Pieza | Rol |
|---|---|
| **`mem0ai`** (solo `mem0ai/oss`) | Extracción de hechos e indexado. La raíz del paquete es el cliente de la nube gestionada y está prohibida; `server/memory/mem0-client.ts` es el único módulo que puede importarlo |
| **`@qdrant/js-client-rest`** | El cliente del índice, fijado a 1.18.x porque mem0 3.1.6 llama a `search()`, que la 1.19 removió — y el cliente se niega a hablar con un servidor a más de un *minor* de distancia |
| **`ollama`** | *Embeddings* locales con `bge-m3` (1024 dimensiones), en un contenedor propio |
| **`@anthropic-ai/sdk`** | La extracción de hechos de mem0, con `claude-haiku-4-5-20251001`. Es el **único** cliente de Anthropic que sostiene el código de la app; sin llave, la capa se apaga sola |

### Gobernanza — OPA compilado a Wasm

`@open-policy-agent/opa-wasm` evalúa `policy/company-policy.wasm` dentro del
proceso Node, con un solo punto de entrada y un único built-in de host
(`sprintf`), después de verificar el SHA-256 del artefacto contra su manifiesto.
No hay servidor de OPA, no hay red, y la ruta de un documento nunca lo toca:
corre solo en los momentos de gobernanza ([§8](#8-la-gobernanza-la-política-de-cada-empresa-y-la-puerta-opa)).

### API y UI

| Pieza | Rol |
|---|---|
| **Next.js 16** (App Router) | Un solo servidor para las cuatro superficies + todas las APIs. `runtime: "nodejs"`, `instrumentation.ts` para calentar el sandbox y arrancar el barrido y el drenaje de memoria |
| **React 19** | Componentes de servidor para las páginas, cliente para las superficies en vivo (streaming, tarjeta HITL, diálogos de adjudicación, constructor de políticas) |
| **tRPC 11 + TanStack Query 5** | Las superficies autenticadas de gestión: la del oficial (5 consultas · 7 mutaciones, acotadas a su organización) y la de plataforma (14 procedimientos `platform.*`, el único guard sin alcance por organización). `superjson` como transformer; un no-oficial recibe `NOT_FOUND`, indistinguible de "no existe" |
| **Rutas SSE** | La superficie del proveedor: el streaming en vivo y la ventana HITL no caben en tRPC, así que son rutas `/api/vendor/*` con `createUIMessageStream` |
| **Tailwind CSS 3** + `clsx` + `tailwind-merge` | Estilos, sin CDN ni fuentes externas |
| **`motion`** | Las animaciones de la página pública, en un stack con carga diferida |
| **AI Elements vendorizados** + **streamdown** | Render de partes de herramienta, razonamiento y markdown en streaming |
| **Zod 4** | La frontera de validación: entradas de las herramientas del host, cuerpos de las rutas (incluida la respuesta HITL), justificaciones del oficial con largos mínimos y máximos, el diff de una propuesta de directiva, variables de entorno (vía `@t3-oss/env-nextjs`), y los esquemas de extracción cuyas descripciones son el prompt del modelo |

### Los motores puros — `@vendra/workflow`

Un paquete con **cero** dependencias fuera de `zod`, por contrato: 13 módulos y ~5.200 líneas sin un solo import de `ai`, de un proveedor o de red. Ahí vive todo lo que decide: catálogo de documentos, esquemas de extracción, validadores, mapa documento→categoría, matemática de la compuerta de activación, trazabilidad de requisitos, comparación difusa de nombres de entidad —el motor que determina **cuándo hay que abrir una ventana HITL**—, el núcleo de la determinación de cobertura y la capa de política por empresa (intersección de catálogos, proyección de campos, recorte de validadores y el predicado del árbitro). Es puro y con el `now` inyectado, así el barrido de vencimientos puede evaluarlo como simple aritmética.

Dos detalles que muestran el nivel de cuidado: la comparación de nombres trae un diccionario curado de **161 grupos de variantes de nombre de pila** (inglés y español) que además funciona como **veto** —«daniel» y «danielle» son conocidos y no comparten grupo, así que ninguna capa difusa puede unirlos—, y el recorte de validadores expone `hasBlockingChecks` porque `[].every(...)` es `true`: una política que filtró todas las reglas que pueden fallar leería «válido», y por eso el documento falla explícitamente en vez de pasar por verdad vacua.

### El conjunto de dependencias externas: exactamente dos

Vale la pena decirlo explícitamente, porque explica muchas decisiones de este repo:

> **Vendra depende de dos servicios externos y de ninguno más: la API de Anthropic y Vercel Sandbox.** Ambos son llamadas de **solo egreso**. Todo lo demás —base de datos, almacenamiento de objetos, autenticación, sesiones, índice semántico, modelo de *embeddings*, motor de políticas, colas, temporizadores— corre en contenedores que este repositorio levanta y administra.

La API de Anthropic se alcanza por **dos caminos**: detrás de Claude Code, en los
tres carriles del harness; y directamente desde la capa de memoria, para la
extracción de hechos. Ese segundo camino es el único lugar donde el código de la
app sostiene un cliente de Anthropic, usa la misma llave y degrada a no-op si no
está.

En la práctica: sin CDN, sin fuentes remotas, sin gateway de modelos entremedio
(la autenticación con Anthropic se fija de forma directa, para que ningún
fallback de entorno se active solo), sin sumideros de telemetría de terceros
(`MEM0_TELEMETRY=false` es obligatorio), sin servicios gestionados de ningún tipo
—ni mem0 cloud, ni Qdrant Cloud— y sin un segundo proveedor de modelos para
tareas auxiliares.

La única excepción es la herramienta de **desarrollo** (el propio Claude Code, sus *skills*, los servidores MCP, las pruebas en navegador): nada de eso llega al código que se despliega.

---

## 11. Versiones exactas

Runtime: **Node ≥ 22.10** · gestor de paquetes: **pnpm 10.4.1** · workspace de 3 paquetes. La imagen de build es `node:22-bookworm-slim`; el runtime del sandbox donde corre el agente es `node24`.

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
| `better-auth` | **1.7.1** | Autenticación y los tres roles |
| `drizzle-orm` | **0.45.2** | ORM |
| `pg` | **8.23.0** | Driver de Postgres |
| `@trpc/server` · `@trpc/client` · `@trpc/tanstack-react-query` | **11.x** (11.18.0) | API tipada del oficial (7 mutaciones de adjudicación) y de la plataforma (14 procedimientos) |
| `@tanstack/react-query` | **5.101.4** | Caché de datos en el cliente |
| `zod` | **4.4.3** | Validación de esquemas |
| `@aws-sdk/client-s3` · `@aws-sdk/s3-request-presigner` | **3.x** | Almacenamiento y URLs prefirmadas |
| `mem0ai` | **3.1.6** | Capa de memoria — solo `mem0ai/oss`, autoalojada |
| `@qdrant/js-client-rest` | **1.18.0** | Cliente del índice vectorial (fijado a 1.18.x) |
| `ollama` | **0.6.3** | *Embeddings* locales `bge-m3` |
| `@anthropic-ai/sdk` | **0.40.1** | Extracción de hechos de mem0 — el único cliente Anthropic en código de app |
| `@open-policy-agent/opa-wasm` | **1.10.0** | Evaluación de la puerta de admisibilidad |
| `tailwindcss` | **3.4.x** | Estilos |
| `motion` | **13.1.1** | Animaciones de la página pública |
| `clsx` · `tailwind-merge` | **2.1.1** · **3.6.0** | Composición de clases |
| `streamdown` | **2.5.0** | Markdown en streaming |
| `@radix-ui/react-collapsible` | **1.1.x** | Primitiva de los elementos de IA |
| `lucide-react` | **1.32.x** | Iconos |
| `superjson` | **2.2.x** | Transformer de tRPC |
| `@t3-oss/env-nextjs` | **0.13.11** | Env tipado y validado |
| `use-stick-to-bottom` | **1.1.x** | Autoscroll del chat |
| `tsx` | **4.20.x** | Scripts (migrar, sembrar, crear cuentas y empresas, reindexar) |

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
| Qdrant | `qdrant/qdrant:v1.18.1` | 6333 (REST), 6334 (gRPC) |
| Ollama | `ollama/ollama:0.5.7` | **11435** → 11434 |
| App | multi-etapa: build `node:22-bookworm-slim`, runner `gcr.io/distroless/nodejs22-debian12:nonroot` (sin shell, uid 65532) | 3000 |
| Modelo del harness | `claude-sonnet-4-6` (`HARNESS_MODEL`) | — |
| Modelo de extracción de memoria | `claude-haiku-4-5-20251001` | — |
| Modelo de *embeddings* | `bge-m3`, 1024 dimensiones | — |
| Runtime del sandbox | `node24` | bridge 4000–4003 |

---

## 12. Modelo de datos

Todo el estado de registro vive en la base propia de la app (`vendra`), definida en `packages/db-vendor/drizzle/schema.ts`: **25 tablas** —21 de la aplicación y 4 de better-auth— y **11 migraciones commiteadas**. Qdrant guarda solo un índice derivado de una de esas tablas, desechable y reconstruible.

**Tenencia y proveedores**

| Tabla | Contenido |
|---|---|
| `organization` | El comprador (tenant). El `slug` es display/ruteo — **nunca** una entrada de permisos |
| `vendor_requirement_profile` | Qué exige ese comprador: categorías requeridas, obligatorias, descartables, umbrales (jsonb) y el tope de descartes manuales (2 por defecto) |
| `vendor` | El proveedor: nombre legal, DBA, últimos 4 del identificador tributario, perfil de trabajo (jsonb), categorías descartadas por él mismo, estado de cumplimiento, **firma del oficial** (`signoff_user_id`, `signoff_at`), metadata (jsonb: determinación de cobertura, overrides, reintentos), próxima expiración denormalizada y **dos anclas**: `requirement_profile_id` (qué se le exige) y `company_policy_id` (bajo qué versión de la política se le juzga) |
| `vendor_tag` · `vendor_tag_assignment` | Etiquetas por organización y su asignación a proveedores (únicas por nombre y por par) |

**Documentos y evidencia**

| Tabla | Contenido |
|---|---|
| `vendor_document` | Un archivo subido: estado (transicionado por CAS), llave en el almacén, metadata del archivo, tipo resuelto, fecha de expiración extraída |
| `vendor_document_extraction` | **Append-only en la clasificación**: una versión por clasificación, única por (documento, versión); recategorizar inserta `version+1` y jamás reescribe la anterior. Sobre la versión vigente se escriben después las reglas de validación, las categorías otorgadas y **la exención del oficial** (nota, alcance, vencimiento y actor). Guarda además la versión de política que la juzgó |
| `manual_requirement_grant` | Otorgamientos manuales del oficial, con índice parcial único: **un solo otorgamiento activo** por (documento, categoría). Guarda justificación, quién otorgó, quién revocó y por qué |
| `api_check_evidence` | Punto de extensión para verificaciones automáticas externas: el recálculo la lee, pero hoy ningún módulo del repositorio escribe en ella |

**Las tres preguntas humanas**

| Tabla | Contenido |
|---|---|
| **`document_confirmation`** | **El HITL del proveedor**: pregunta, tipo, entidad nombrada, respuesta por defecto, momento en que se levantó, vencimiento, respuesta y resultado (`answered` / `default` / `timeout`). Es la única que vence sola |
| **`requirement_referral`** | **El HITL de la política**: el requisito que el motor probó pero no tuvo permiso de conceder. Sin vencimiento y sin respuesta por defecto; índice parcial único de una derivación abierta por (proveedor, categoría); se resuelve `GRANTED` / `REJECTED` / `SUPERSEDED` |
| **`directive_proposal`** | **El HITL de la gobernanza**: el diff que redactó un asistente delegado, con la instantánea completa de la política propuesta, el motivo ya redactado, el veredicto asesor de la puerta y la versión que la aprobación activó. Índice parcial único: una propuesta abierta por proveedor |

**Gobernanza**

| Tabla | Contenido |
|---|---|
| `company_policy` | Una **versión** de la política de documentos de la empresa: `DRAFT` / `ACTIVE` / `ARCHIVED`, con unicidad por (organización, versión) y un índice parcial que garantiza como máximo **una activa por empresa**. Lleva el poder de árbitro y el privilegio del asistente |
| `company_policy_document` | El reglamento para UN tipo de documento: qué campos se extraen (vacío = todos) y qué validadores cuentan (nunca vacío) |
| `company_policy_decision` | El acta de cada decisión de la puerta y de cada acción de gobernanza (11 acciones), con el actor, la versión, los hallazgos, los umbrales evaluados y los hashes del rego y del wasm que decidieron |

**Bitácora y tiempo**

| Tabla | Contenido |
|---|---|
| `vendor_activity` | 20 tipos de evento: los del ciclo del documento (subida, verificación, rechazo, exención, recategorización, borrado), los del oficial (otorgamiento y revocación manual, reintento, cambio de estado), los del tiempo (vencimiento de exención, barrido), los de gobernanza (activación de política, derivación de requisito y su resolución, propuesta de directiva y su resolución) y los del propio proveedor (registro y envío de activación), más la verificación por API ejecutada — con actor, documento y metadata |
| `vendor_status_transition` | Cada cambio de estado con su origen: `gate` (la compuerta), `officer_decision` y `officer_reclassify` (el oficial) o `sweep` (el tiempo) |
| `renewal_notification` | Avisos de renovación a 30/14/1 día, únicos por (proveedor, categoría, horizonte, vencimiento) |

**Asistente**

| Tabla | Contenido |
|---|---|
| `assistant_chat_turn` | Dos espacios de nombres vivos por proveedor: la transcripción (`vendor-chat:<uuid>`, una fila por mensaje) y el estado de reanudación del harness (`vendor-session:<uuid>`, una sola fila con *upsert*). `UNIQUE(thread_id, message_id)` es la frontera de idempotencia |
| `assistant_memory` | **El sistema de registro de la memoria**: el hecho, su origen (`tool` / `extracted` / `directive`), su alcance (proveedor u organización) y su historial. Dos índices parciales únicos mantienen «un hecho vivo por id de mem0» y «una copia viva de cada hecho por alcance» sin borrar el pasado |
| `memory_ingest_queue` | El trabajo de memoria pendiente (`turn` o `fact`), con intentos, bloqueo y error — para que ningún proveedor espere una llamada a un LLM |

**Autenticación**

| Tabla | Contenido |
|---|---|
| `user` · `session` · `account` · `verification` | Tablas de better-auth, en la misma base. Toda credencial nace y se verifica por el SDK; la app solo lee `user` |

Seis índices únicos **parciales** llevan invariantes de verdad, hechas cumplir por Postgres y no por la lógica de aplicación: una política activa por empresa, un otorgamiento manual activo por (documento, categoría), una derivación abierta por (proveedor, categoría), una propuesta abierta por proveedor y los dos de la memoria sobre filas vivas. Y varias columnas de estado son `text` y no `pgEnum` a propósito (`company_policy.status`, el privilegio del asistente, la acción del acta, el origen de una transición): así un valor nuevo no exige una migración.

Cambiar el esquema:

```bash
# 1. edite packages/db-vendor/drizzle/schema.ts
pnpm --filter @vendra/db-vendor generate   # 2. genera SQL + journal + snapshot
# 3. commitee el trío generado junto con el cambio de schema.ts
```

Los archivos bajo `drizzle/` son artefactos de solo lectura: nunca se editan a mano y jamás se usa `push`. El servicio `migrate` del compose no genera nada — aplica las migraciones ya commiteadas, siembra la demo e instala las políticas de empresa faltantes.

---

## 13. Seguridad y privacidad

- **PII:** los identificadores tributarios completos y los números de cuenta bancaria nunca se piden, nunca se guardan, y se vuelven a enmascarar al persistir y al renderizar (defensa en profundidad). La salida de cada herramienta del asistente se enmascara otra vez antes de viajar por el stream, porque queda en la transcripción. **El texto de justificación del oficial nunca se registra en logs** (solo su largo): una decisión HITL deja rastro auditable en la base, no en la salida estándar.
- **Aislamiento del agente:** lista blanca de herramientas (`activeTools`), `permissionMode: "allow-reads"`, egreso denegado por defecto salvo dos hosts, y el documento montado en un directorio de trabajo por sesión.
- **Inyección de prompt:** el contenido de documentos y los hechos recordados se declaran como contexto, no instrucciones; el marcado se sanitiza al escribir, al inyectar y al volver del índice. El diff de una propuesta de directiva es de vocabulario cerrado: no existe un campo de texto libre que pueda llegar al prompt del carril de documentos.
- **Autorización:** cada ruta y cada procedimiento resuelve la sesión en el servidor. El rol y el tenant nunca vienen del cliente. Un no-oficial recibe `NOT_FOUND`, no `FORBIDDEN` (no filtra existencia), y lo mismo vale para la consola de plataforma.
- **Integridad del HITL:** una respuesta de confirmación solo vale para el documento al que pertenece (el `uuid` de la ruta y el de la ventana deben coincidir); la guardia de autenticación corre antes de parsear el cuerpo; y el arbitraje entre respuesta y vencimiento es atómico, así una ventana no puede resolverse dos veces con resultados distintos.
- **Alcances acotados en el servidor:** una exención por desajuste de nombre no puede, por construcción, eximir la identidad fiscal. El oficial decide; el servidor delimita hasta dónde llega esa decisión.
- **La configuración también pasa por una puerta:** la política de cada empresa se evalúa contra Rego compilado a Wasm antes de poder activarse, con el artefacto verificado por SHA-256 y un fallo cerrado si algo no cuadra. Cada veredicto queda registrado con los hashes bajo los que se decidió.
- **Nada de terceros en el navegador:** la app no carga tipografías, iconos ni imágenes remotas en ninguna de sus cuatro superficies. Las únicas salidas a internet son la API de Anthropic y Vercel Sandbox.
- **Secretos:** las cuatro llaves remotas viven solo en el entorno; nunca en código, commits, logs ni respuestas.

---

## 14. Desarrollo local sin Docker

Requisitos: Node ≥ 22.10, pnpm 10.4.1, y Docker para Postgres, MinIO y —si quiere el recuerdo semántico del asistente— Qdrant y Ollama.

```bash
nvm use 22
pnpm install
docker compose up -d postgres minio minio-init migrate
docker compose up -d qdrant ollama ollama-init     # opcional: la memoria semántica

# cree apps/vendra/.env.local con las mismas llaves que .env.docker, pero:
#   VENDOR_DATABASE_URL=postgresql://vendor:vendor@localhost:5436/vendra
#   S3_ENDPOINT_URL=http://localhost:9000
#   (S3_PUBLIC_ENDPOINT_URL puede omitirse — cae de vuelta a S3_ENDPOINT_URL)
#   VENDOR_QDRANT_URL=http://localhost:6333
#   VENDOR_OLLAMA_URL=http://localhost:11435   ← 11435, no 11434: compose lo mapea
#                                                así para no chocar con un Ollama nativo
#   MEM0_TELEMETRY=false

pnpm --filter vendra migrate     # aplica migraciones + siembra la demo + backfill de políticas
pnpm --filter vendra dev         # http://localhost:3000
pnpm --filter vendra type-check  # gate de tipos
pnpm --filter vendra build       # gate de build
```

Los cuatro scripts de la app —`migrate`, `create-account`, `create-company` y `memory-reindex`— cargan `apps/vendra/.env.local` por sí solos cuando existe (`--env-file-if-exists`), así que corren igual desde la terminal local y dentro del contenedor del migrador, donde el entorno llega por `.env.docker`.

Crear cuentas y empresas de prueba a demanda — las mismas banderas de [§2.4](#24-crear-más-cuentas-y-más-empresas):

```bash
pnpm --filter vendra create-account -- --role officer \
  --email officer2@acme-demo.test --password 'Officer2Demo123!' --name "Segunda Oficial"

pnpm --filter vendra create-account -- --role vendor \
  --email vendor@maple-demo.test --password 'MapleDemo123!' \
  --name "Robin Vale" --legal-name "Maple Works LLC"

pnpm --filter vendra create-account -- --role superadmin \
  --email super2@vendra.test --password 'Super2Demo123!' --name "Platform Op"

pnpm --filter vendra create-company -- --name "Delta Infraestructura SpA" --slug delta-infra
```

Tres palancas de entorno existen para no esperar los tiempos de producción:
`VENDOR_CONFIRMATION_WINDOW_MS` acorta la ventana de confirmación,
`VENDOR_SWEEP_INTERVAL_MS` acelera el barrido de vencimientos y
`VENDOR_MEMORY_DRAIN_INTERVAL_MS` acorta el intervalo de 20 s del drenaje de
memoria. Sin definir, se usan los valores de producción.

Si toca `policy/*.rego`, recompile el artefacto: `pnpm --filter vendra policy:build` (corre `opa check --strict` y `opa test` antes de compilar y reescribe el manifiesto), y valide con `pnpm policy:check`.

---

## 15. Solución de problemas

| Síntoma | Causa / arreglo |
|---|---|
| El PUT prefirmado falla desde el navegador | `S3_PUBLIC_ENDPOINT_URL` mal configurado — SigV4 firma el host, así que el endpoint de prefirma debe ser el que **el navegador** alcanza (`http://localhost:9000` en compose) |
| `/process` devuelve 503 nombrando llaves faltantes | La guardia de credenciales del harness — complete las cuatro llaves en `.env.docker` y `docker compose up -d app` |
| Documentos atascados en `PROCESSING` ~25 min y luego `FAILED` | El conserje funcionando como debe (una corrida huérfana, por ejemplo si la app se reinició). Use **Reintentar** en el portal, o **Reintentar procesamiento** desde el panel del oficial. El conserje también falla lo que quedó en `PENDING` o `UPLOADED` más de 10 minutos |
| La primera subida después de un rato tarda 1–3 min | El sandbox ocioso se retiró en vez de renovarse; esa corrida paga el arranque en frío |
| Una confirmación HITL desapareció sin que nadie contestara | Venció la ventana de 5 minutos: el sistema aplicó el criterio por defecto y siguió (*fail-open*). El resultado quedó en `document_confirmation` y en la línea de log `confirmation.expired` |
| Un documento de seguro quedó **Contado · cobertura** | No es un error: falló la identidad del nombre, pero sus límites siguen alimentando la determinación de cobertura |
| Una categoría dice «Esperando su decisión» y no avanza | La política de la empresa no deja que el sistema la apruebe: es una derivación y espera a un oficial. Se resuelve con «Otorgar requisito manualmente» ([§4.3](#43-el-hitl-de-la-política--el-requisito-derivado)) |
| La creación del sandbox falla con `402 payment_required` | Cuota de sandbox del equipo en Vercel — use un token con alcance de equipo en un plan pagado, u otro equipo |
| Error 4xx del modelo nombrando el modelo | La llave de Anthropic no tiene acceso a `HARNESS_MODEL` (habilitación, no credenciales). Elija un modelo que su llave pueda invocar |
| La tarjeta de cobertura no termina de calcular | Abra el proveedor en el panel del oficial — toda superficie del oficial dispara la determinación al verla; el portal también la dispara en su siguiente *poll*. Sin las cuatro llaves del harness, el carril se salta en silencio (`coverage.skipped`) |
| Una exención devuelve `CONFLICT` | El seguro de concurrencia optimista: otra persona cambió el estado de esa exención mientras usted trabajaba. Recargue y vuelva a intentar |
| `harness: unconfigured` en `/api/health` | Faltan una o más de las cuatro llaves remotas. La app funciona igual, pero los documentos quedan en cola |
| `memory: unconfigured` en `/api/health` | Falta `VENDOR_QDRANT_URL`, `VENDOR_OLLAMA_URL` o `ANTHROPIC_API_KEY` — el asistente recuerda por recencia y nada más se degrada |
| `memory: degraded` en `/api/health` | Qdrant u Ollama inalcanzables; el propio bloque dice cuál. El chat sigue funcionando |
| `[ollama-init] pull failed` en el log | Sin salida a internet en el primer arranque. La app arranca igual y el modelo se descarga en su primer uso |
| El índice de memoria quedó incompleto o duplicado | `pnpm --filter vendra memory-reindex -- --rebuild` — el volumen de Qdrant es desechable por diseño |
| No puedo activar una política | La puerta OPA la rechazó: la consola lista las violaciones traducidas. Si el mensaje habla del artefacto, recompílelo con `pnpm --filter vendra policy:build` |
| No veo la consola de plataforma | Esa cuenta no es `SUPERADMIN`. Entre como `superadmin@vendra.test` o cree una con `create-account --role superadmin` |

---

## Estructura del repositorio

```
apps/vendra/               la app Next.js (las cuatro superficies + APIs + harness)
  src/app/                   rutas: páginas y /api
  src/server/harness/        los carriles de documento y cobertura, el sandbox
                             compartido, las ventanas HITL (confirmations.ts) y
                             las derivaciones (db/referrals.ts)
  src/server/assistant/      el asistente (sesión, herramientas, prompt, store)
  src/server/memory/         la memoria: mem0 OSS, Qdrant, Ollama, cola e índice
  src/server/trpc/           las APIs tipadas: el oficial y la plataforma
  src/server/company-policy.ts · policy-admission.ts · directive-proposals.ts
                             la gobernanza: versiones, puerta OPA y propuestas
  src/features/landing/      la página pública de `/` y sus demostraciones
  src/features/…/lib/vendor-harness-contract.ts   EL contrato compartido
  src/features/…/components/hitl-prompt.tsx       la tarjeta de confirmación
  src/features/…/components/officer/              el panel del oficial
  src/features/…/components/platform/             la consola de plataforma
  src/components/ai-elements/  primitivas de render vendorizadas
packages/workflow/         motores puros (catálogo, validadores, compuerta,
                           cobertura, política) — sin IA, sin IO
packages/db-vendor/        el esquema Drizzle propio + migraciones commiteadas
policy/                    la suite Rego ejecutable y el artefacto Wasm de la
                           puerta de admisibilidad
docs/landing/              los archivos de la galería de este README
docker-compose.yml         postgres + minio + qdrant + ollama + migrate + app
.env.docker.example        la matriz completa de variables, documentada línea por línea
```

## Licencia

MIT — vea [LICENSE](LICENSE).
