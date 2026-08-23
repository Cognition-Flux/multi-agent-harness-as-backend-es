# Vendra

**Onboarding de proveedores y cumplimiento continuo, adjudicado con IA — un backend construido sobre un *agent harness* de Claude Code, con el humano en el centro de las decisiones.**

<p align="center">
  <a href="docs/screenshots/01-portal-y-asistente.png">
    <img src="docs/screenshots/01-portal-y-asistente.png" width="100%"
         alt="Portal del proveedor con el asistente de cumplimiento abierto: documentos verificados a la izquierda, los nueve requisitos y la determinación de cobertura al centro, y el asistente explicando el límite efectivo a la derecha.">
  </a>
</p>

<p align="center">
  <sub>
    <b>El portal del proveedor, con el asistente abierto.</b><br>
    A la izquierda, los documentos ya procesados; al centro, los nueve requisitos y la determinación de
    cobertura; a la derecha, el asistente — que consulta el expediente en vivo antes de responder y explica
    por qué el límite efectivo llegó a $5.000.000.
  </sub>
</p>

<br>

<table>
  <tr>
    <td width="53%" valign="top" align="center">
      <a href="docs/screenshots/02-procesamiento-en-vivo.png">
        <img src="docs/screenshots/02-procesamiento-en-vivo.png" width="100%"
             alt="Dos documentos verificados y un tercero en la etapa 4 de 8, con el carril de cobertura revisando las pólizas en paralelo.">
      </a>
    </td>
    <td width="25%" valign="top" align="center">
      <a href="docs/screenshots/03-extraccion-y-validacion.png">
        <img src="docs/screenshots/03-extraccion-y-validacion.png" width="100%"
             alt="Tarjetas de documento abiertas mostrando el razonamiento de la clasificación, los campos extraídos y las reglas de validación, más la cadena de herramientas del agente en curso.">
      </a>
    </td>
    <td width="22%" valign="top" align="center">
      <a href="docs/screenshots/04-requisitos-y-cobertura.png">
        <img src="docs/screenshots/04-requisitos-y-cobertura.png" width="100%"
             alt="Nueve de nueve requisitos acreditados y la cobertura resuelta apilando la póliza primaria con la umbrella hasta cinco millones de dólares.">
      </a>
    </td>
  </tr>
  <tr>
    <td valign="top" align="center">
      <sub>
        <b>Procesamiento en vivo</b><br>
        Cada documento abre su propia sesión de agente y transmite su avance: ocho etapas, el razonamiento
        del modelo y una narración en lenguaje llano. El contador marca 1 de 9 porque las tres categorías de
        seguro aún esperan la determinación: el sistema prefiere decir <i>“revisando”</i> antes que mostrar
        una cifra que todavía no es cierta.
      </sub>
    </td>
    <td valign="top" align="center">
      <sub>
        <b>Nada se acepta a ciegas</b><br>
        Cada tarjeta abre por qué se clasificó así, los campos que se extrajeron y el resultado regla por
        regla. Abajo, la cadena de herramientas del agente en curso: leer, clasificar, extraer y finalizar.
      </sub>
    </td>
    <td valign="top" align="center">
      <sub>
        <b>El resultado</b><br>
        Nueve de nueve requisitos acreditados, sin gastar descartes. La cobertura se resuelve apilando la
        póliza primaria ($1M) con la umbrella ($4M): $5M efectivos. La nota explica por qué la umbrella
        <i>no</i> se apila sobre compensación laboral.
      </sub>
    </td>
  </tr>
</table>

<br>

Un proveedor sube los documentos de cumplimiento que tenga (certificados de seguro, W-9, licencias, historial de seguridad…). **Cada documento abre su propia sesión de agente Claude Code** dentro de una MicroVM desechable en la nube: el agente lee las páginas, clasifica el documento contra un catálogo y extrae datos estructurados — todo transmitido **en vivo** al navegador. Todo lo que viene después es código determinista del host: validación, mapeo de requisitos, matemática de cobertura, bitácora de auditoría. Un segundo carril de agente resuelve la **cobertura agregada de seguros** (¿la póliza umbrella se apila sobre la de responsabilidad civil para alcanzar el límite exigido?). Y un tercer carril es el **asistente conversacional** del proveedor: el mismo harness, esta vez como chat.

**El sistema se detiene y le pregunta a una persona en los dos puntos donde el juicio humano es insustituible.** Cuando un documento nombra a otra empresa —la póliza de la matriz, un nombre de fantasía—, el pipeline **abre una ventana HITL durable y le pregunta al proveedor** en pleno procesamiento: la pregunta sobrevive a un refresh, tiene 5 minutos de vigencia y, si nadie contesta, continúa de forma explícita y auditada en vez de quedarse bloqueada. Y del otro lado del mostrador, **el oficial de cumplimiento es quien adjudica**: dispensa validaciones fallidas, recategoriza documentos, otorga o revoca requisitos a mano, reintenta procesamientos y firma el estado final — cada acción con justificación obligatoria, alcance acotado por el servidor y una fila de auditoría escrita en la misma transacción.

> **La regla de oro del proyecto:** el modelo nunca decide el cumplimiento. Solo lee documentos y responde preguntas. Las decisiones las calcula código puro y determinista, o las toma **una persona**: el proveedor en su ventana de confirmación, el oficial en su panel de adjudicación.

---

## Índice

- [**La página pública**](#la-página-pública) — la landing, sección por sección

1. [¿Qué hace esta app? (explicación para principiantes)](#1-qué-hace-esta-app-explicación-para-principiantes)
2. [Arranque rápido y cómo probar la app](#2-arranque-rápido-y-cómo-probar-la-app)
3. [La idea central: *harness* como backend](#3-la-idea-central-harness-como-backend)
4. [**Los dos puntos HITL: dónde decide una persona**](#4-los-dos-puntos-hitl-dónde-decide-una-persona)
5. [Carril 1 — el pipeline por documento](#5-carril-1--el-pipeline-por-documento)
6. [Carril 2 — la determinación de cobertura](#6-carril-2--la-determinación-de-cobertura)
7. [Carril 3 — el asistente LLM del proveedor](#7-carril-3--el-asistente-llm-del-proveedor)
8. [Arquitectura completa](#8-arquitectura-completa)
9. [El rol de cada pieza del stack](#9-el-rol-de-cada-pieza-del-stack)
10. [Versiones exactas](#10-versiones-exactas)
11. [Modelo de datos](#11-modelo-de-datos)
12. [Seguridad y privacidad](#12-seguridad-y-privacidad)
13. [Desarrollo local sin Docker](#13-desarrollo-local-sin-docker)
14. [Solución de problemas](#14-solución-de-problemas)

---

## La página pública

La ruta `/` no es un folleto: es **el producto funcionando**. Cada texto que
aparece en ella está citado, carácter por carácter, de los módulos reales del
portal, del panel del oficial, de la consola de gobernanza y del asistente; y
cada una de sus **doce demostraciones animadas** repite un compás real del
sistema. Lo que sigue es esa página, sección por sección, con las animaciones
capturadas del navegador y el resto reconstruido en vector.

> Las capturas animadas duran exactamente un ciclo del demo original —
> 8 600 ms el héroe, 8 100 ms el HITL, 11 200 ms el asistente — de modo que el
> bucle cierra sin salto. Todas las piezas son archivos locales del
> repositorio: la página no carga tipografías, iconos ni imágenes de terceros.

### Recorrido

La barra fija recorre ocho anclas y siempre deja a mano las dos acciones.

| Ancla | Sección | Qué muestra |
|---|---|---|
| `#como-funciona` | Cómo funciona | los cuatro pasos, del archivo a la activación |
| `#casos` | Casos | cuatro casos difíciles, animados |
| `#paneles` | Paneles | las cuatro superficies de la plataforma |
| `#asistente` | Asistente | el turno de cuatro herramientas |
| `#adjudicacion` | Oficial | las cinco acciones de rescate |
| `#gobernanza` | Gobernanza | políticas, versionado y la puerta OPA |
| `#funcionalidades` | Funciones | las seis capas del producto |
| `#arquitectura` | Arquitectura | dónde corre cada cosa |

### El héroe

<p align="center">
  <a href="docs/landing/01-hero-documento.webp">
    <img src="docs/landing/01-hero-documento.webp" width="100%"
         alt="La tarjeta del héroe recorre las ocho etapas de revisión de un certificado ACORD 25: la barra avanza de «Etapa 2 de 8» a «Revisión completada», el agente narra cada etapa y al cerrar aparecen los campos extraídos —asegurado, límite por ocurrencia, asegurado adicional y fecha de vencimiento— junto al requisito que el documento acredita.">
  </a>
</p>

<p align="center">
  <sub>
    <b>Cumplimiento de proveedores, revisado en vivo por agentes de IA.</b><br>
    Cada documento recibe su propio agente de Claude, transmitido en vivo a su navegador. La validación,
    la cobertura y la activación las decide código determinista — y su oficial de cumplimiento conserva la
    última palabra. Las dos fichas flotantes son reales: la pregunta HITL con su cuenta regresiva, y la
    cobertura efectiva de $2.000.000 una vez apiladas la póliza primaria y la umbrella. Abajo a la
    izquierda, el control <i>Pausar animaciones</i> — un requisito WCAG 2.2.2, no un adorno.
  </sub>
</p>

La insignia sobre el titular dice **Adjudicación por IA · gobernada por personas**,
y es la tesis entera de la página en cinco palabras.

### Las cifras

<p align="center">
  <img src="docs/landing/02-cifras.svg" width="100%"
       alt="Cuatro contadores que suben desde cero hasta sus valores finales: 16 tipos de documento, 11 categorías de requisitos, 8 etapas de revisión en vivo y 7 estados de cumplimiento.">
</p>

<p align="center">
  <sub>
    Las cuatro cifras no están escritas a mano: se derivan del catálogo real.
    <b>16 tipos de documento</b> (del W-9 al ACORD 25 y SOC 2), <b>11 categorías de requisitos</b>
    (con trazabilidad documento a documento), <b>8 etapas de revisión en vivo</b>
    (transmitidas a su navegador) y <b>7 estados de cumplimiento</b> (de «No iniciado» a «Aprobado»).
  </sub>
</p>

### 16 tipos de documento

<p align="center">
  <img src="docs/landing/03-tipos-documento.svg" width="100%"
       alt="Marquesina que desplaza los dieciséis tipos de documento aceptados, desde el Certificado de seguro (ACORD 25) hasta el Acuerdo de confidencialidad firmado.">
</p>

<details>
<summary><b>Los dieciséis tipos, en texto</b></summary>

Certificado de seguro (ACORD 25) · Página de declaraciones de la póliza de seguro ·
Póliza umbrella / de exceso de responsabilidad · Formulario W-9 del IRS ·
Formulario W-8BEN-E del IRS · Licencia comercial · Certificación de diversidad ·
Carta de EMR (tasa de modificación por experiencia) · Resumen del Formulario 300A de OSHA ·
Informe SOC 2 · Certificado ISO 27001 · Póliza de responsabilidad cibernética ·
Carta de verificación bancaria · Cheque anulado · Contrato marco de servicios firmado ·
Acuerdo de confidencialidad firmado

</details>

### Cómo funciona

**Del documento a la activación, sin cajas negras.** Un flujo de cuatro pasos
donde la IA trabaja a la vista y las decisiones son de código determinista y de
personas.

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

### Casos en vivo

**Los casos difíciles, manejados a la vista.** Pólizas que se apilan,
certificados a nombre de la filial, credenciales que vencen y preguntas que
merecen un humano.

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
        Apilamiento de cobertura: el host re-deriva cada cifra — un payload incoherente rebota al agente
        antes de persistir.
      </sub>
    </td>
    <td valign="top" align="center">
      <sub>
        <b>La duda se pregunta</b><br>
        Humano en el circuito: ventanas de confirmación durables con cuenta regresiva — la duda genuina se
        pregunta, no se adivina.
      </sub>
    </td>
  </tr>
</table>

Los otros dos casos de la sección no se animan aquí, pero su texto es el mismo:

- **Falla acotada:** un certificado a nombre de la filial no acredita identidad, pero sus límites sí cuentan — y el oficial puede eximir solo lo que la falla bloquea.
- **Cumplimiento continuo:** aviso de renovación a 30 días, la expiración pasa APROBADO→VENCIDO sola y una renovación válida restaura la aprobación.

### Cuatro superficies

<p align="center">
  <a href="docs/landing/06-paneles.webp">
    <img src="docs/landing/06-paneles.webp" width="100%"
         alt="Las cuatro pestañas de la plataforma con «Portal del proveedor» seleccionada: la zona de carga, tres documentos en distintos estados y la lista de requisitos marcando 9 de 11, junto al texto del panel.">
  </a>
</p>

**Una plataforma, cuatro superficies.** Proveedores, oficiales de cumplimiento y
administradores de plataforma trabajan sobre el mismo expediente — cada uno con
su propio panel.

<details>
<summary><b>Portal del proveedor</b> — Incorporación con agentes a la vista</summary>

El proveedor arrastra sus documentos y ve trabajar a cada agente en vivo, con la lista de requisitos y la puerta de activación siempre al lado.

- Zona de carga con verificación en vivo: barra «Etapa X de 8», narración del agente y razonamiento visible.
- Confirmaciones humano-en-el-circuito con cuenta regresiva cuando el agente duda de verdad.
- Lista de 11 categorías con medidor de avance, descartes «No aplica» y aviso de renovación a 30 días.
- Activación con compuerta determinista: el botón explica exactamente qué falta para habilitarse.

</details>

<details>
<summary><b>Panel del oficial</b> — Adjudicación con herramientas de rescate</summary>

Un directorio ordenado por próximo vencimiento y un expediente por proveedor con todo el kit: eximir, recategorizar, otorgar, revocar y reintentar.

- Directorio con búsqueda, filtros por estado y auto-refresco — lo próximo a vencer, primero.
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

### El asistente

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

- Cuatro herramientas encadenadas en el mismo turno: consultar el expediente, revisar un documento, tomar nota y redactar una propuesta.
- El razonamiento del modelo queda a la vista, plegado — se abre cuando usted quiere verlo, y el texto llega transmitido token a token.
- Memoria semántica local: mem0 OSS, Qdrant y Ollama en contenedores propios, con la PII redactada antes de almacenar.
- En el nivel «Delegado — puede proponer directivas» la propuesta aterriza en la consola de gobernanza y espera una decisión humana.

### El oficial

<p align="center">
  <a href="docs/landing/08-acciones-oficial.webp">
    <img src="docs/landing/08-acciones-oficial.webp" width="100%"
         alt="El expediente de Beta Logística Ltda. en la pestaña Documentos, con las cinco acciones de rescate —eximir, recategorizar, otorgar manualmente, revocar y reintentar procesamiento—, el bloque para finalizar el estado y un registro de actividad con las cinco líneas que esas acciones escribieron.">
  </a>
</p>

<p align="center">
  <sub>
    <b>Cinco acciones de rescate, cada una con su rastro.</b><br>
    Cuando el motor determinista se detiene, su oficial de cumplimiento tiene herramientas — y cada una
    escribe su propia línea en el registro de auditoría antes de tocar nada.
  </sub>
</p>

- Eximir, recategorizar, otorgar, revocar y reintentar: el kit completo sobre el documento, sin salir del expediente del proveedor.
- Toda acción exige una justificación escrita que queda en el registro de auditoría — no hay atajos silenciosos.
- El servidor vuelve a acotar el alcance de cada exención: una falla nunca puede eximir más de lo que realmente bloquea.
- El estado final es una decisión aparte y explícita: otorgar cierra una categoría, no aprueba al proveedor.

### La gobernanza

<p align="center">
  <a href="docs/landing/09-gobernanza.webp">
    <img src="docs/landing/09-gobernanza.webp" width="100%"
         alt="La consola de plataforma de Acme Constructora SpA con los cuatro pasos de configuración resueltos —oficiales, privilegios del asistente, documentos aceptados y aprobación automática— y el veredicto de la puerta de admisibilidad OPA listando sus dos advertencias antes de permitir activar la política.">
  </a>
</p>

<p align="center">
  <sub>
    <b>Roles y políticas, configurados a la vista.</b><br>
    Cada empresa define quién revisa, qué puede hacer el asistente, qué documentos se aceptan y qué
    requisitos aprueba el sistema por su cuenta — todo antes de que un proveedor suba su primer archivo.
  </sub>
</p>

- Cuentas de oficial creadas desde la consola, con alcance exacto a una empresa y a ninguna otra.
- Dos niveles de privilegio para el asistente del proveedor: solo explicar, o proponer cambios que una persona aprueba.
- Por tipo de documento: qué campos se extraen —con los estructurales bloqueados— y qué validaciones cuentan de verdad.
- Poder de árbitro por categoría, y una puerta de admisibilidad OPA que revisa la configuración antes de dejar activarla.

### Funcionalidades

**Capas que se gobiernan entre sí.** Agentes que trabajan, reglas que deciden,
personas que aprueban — y todo queda registrado.

<p align="center">
  <img src="docs/landing/10-bento.svg" width="100%"
       alt="Las seis funcionalidades en retícula: políticas del agente gobernadas por un gate OPA, documentos y extracción, memoria semántica local, humano en el circuito, auditoría inmutable y cumplimiento continuo.">
</p>

<details>
<summary><b>Las seis fichas, en texto</b></summary>

| Ficha | Qué cubre |
|---|---|
| **Políticas del agente, gobernadas** | Un gate OPA/Rego compilado a Wasm admite cada política antes de activarla: documentos aceptados, campos extraídos, validaciones que cuentan y qué categorías aprueba el sistema solo. |
| **Documentos y extracción** | 16 tipos de documento con campos estructurales bloqueados, identificadores fiscales siempre enmascarados y una versión de extracción por cada revisión. |
| **Memoria semántica local** | El asistente recuerda hechos entre sesiones con búsqueda semántica en español — mem0 OSS, Qdrant y Ollama, autoalojados. |
| **Humano en el circuito** | Confirmaciones con cuenta regresiva, derivaciones por política de empresa y propuestas de directivas que solo una persona puede aprobar. |
| **Auditoría inmutable** | Libro de actividad transaccional y trazabilidad por requisito: el artefacto que se le entrega a un auditor, siempre al día. |
| **Cumplimiento continuo** | El tiempo es un disparador de primera clase: expiración automática, aviso de renovación en el portal a 30 días y restauración sin fricción al renovar. |

</details>

### Arquitectura

**Confianza por diseño, no por promesa.** La inteligencia corre aislada, las
decisiones son reproducibles y sus datos nunca salen de sus propios
contenedores.

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

### El cierre

La página termina donde empieza el trabajo: **Empiece con su primer documento
hoy mismo.** Registre su empresa, arrastre un certificado y vea a su primer
agente trabajar en vivo — la activación queda a un expediente de distancia. Las
dos acciones son **Registre su empresa** y *Ya tengo cuenta — iniciar sesión*.

### El pie

El pie repite las ocho anclas bajo *Producto*, las dos entradas bajo *Acceso*, y
cierra con una sola línea que resume la postura del proyecto:
*sus datos viven en sus propios contenedores.*

### La estética

Un solo tema, claro, sin tipografías web: toda la letra es la pila del sistema y
todo el arte es CSS. El naranja quemado es actividad de IA en vivo, nunca
decoración — y los botones son grafito, no naranja.

<p align="center">
  <img src="docs/landing/11-tokens.svg" width="100%"
       alt="La paleta de la plataforma: cada token con su muestra de color, su valor hexadecimal y su función, del naranja de marca al grafito de los botones y los cuatro colores de estado.">
</p>

<p align="center">
  <img src="docs/landing/12-badges.svg" width="100%"
       alt="Las variantes de insignia con sus colores semánticos: verificado y aprobado en verde, procesando y delegado en naranja, vencido y requiere revisión en ámbar, rechazado en rojo y no aplica en gris.">
</p>

<p align="center">
  <sub>
    Los colores de estado no son decorativos: <b>vencido</b> es ámbar y nunca rojo, porque una credencial
    que caducó no es un rechazo; <b>procesando</b> lleva el punto que late mientras el agente trabaja.
  </sub>
</p>

---

## 1. ¿Qué hace esta app? (explicación para principiantes)

### El problema del mundo real

Antes de que una empresa grande (el *comprador*) le pague a un proveedor nuevo, alguien tiene que revisar papeles: ¿tiene seguro vigente y con el monto suficiente?, ¿entregó su formulario tributario?, ¿su licencia comercial está al día?, ¿venció algo desde la última revisión? Hoy eso lo hace una persona abriendo PDFs uno por uno. Es lento, se equivoca y no queda registro de por qué se aprobó algo.

**Vendra automatiza la lectura y deja la decisión donde corresponde: en las personas.**

### Los dos usuarios — y las dos decisiones humanas

| Rol | Quién es | Qué ve | **Su decisión HITL** |
|---|---|---|---|
| **Contacto del proveedor** (`VENDOR_CONTACT`) | La empresa que quiere venderle al comprador | Su portal: sube documentos, ve el progreso en vivo, revisa qué le falta y conversa con un asistente | Responde las **confirmaciones sobre sus propios documentos** (¿esta póliza de la matriz lo cubre?), marca categorías como "no aplica" y decide cuándo activar su cuenta |
| **Oficial de cumplimiento** (`COMPLIANCE_OFFICER`) | Quien revisa y aprueba del lado del comprador | Un panel aparte: listado de proveedores, detalle completo, trazabilidad de requisitos | **Adjudica**: dispensa, recategoriza, otorga o revoca requisitos, reintenta y firma el estado final |

Los dos puntos son distintos a propósito: **el proveedor aporta el conocimiento que solo él tiene** (la estructura societaria de su negocio), **el oficial aporta el criterio que solo él puede ejercer** (aceptar una excepción y hacerse responsable). El sistema no le pide a ninguno lo que le corresponde al otro. El detalle completo está en la [sección 4](#4-los-dos-puntos-hitl-dónde-decide-una-persona).

### El recorrido del proveedor, paso a paso

1. **Se registra** con correo y contraseña, e ingresa los datos del negocio (nombre legal, tipo de entidad, estados donde trabaja, si es 100% remoto…). Esos datos definen su **perfil de requisitos**: por ejemplo, un proveedor totalmente remoto no necesita seguro de auto ni compensación laboral.
2. **Sube sus documentos** (hasta 40 archivos, 10 MB cada uno; PDF o imagen). El navegador los sube directo al almacenamiento con una URL prefirmada — no pasan por el servidor de la app.
3. **Mira el procesamiento en vivo.** Cada tarjeta de documento muestra 8 etapas (`leyendo → analizando → clasificando → extrayendo → guardando → validando → mapeando → finalizando`), el razonamiento del agente y frases cortas del tipo *"Leyendo ambas páginas de su certificado."* Todo llega por streaming, en español.
4. 🧑‍⚖️ **Responde la confirmación cuando aparece — este es el HITL del proveedor.** Si un documento nombra a otra empresa, la app se detiene y pregunta: *"Esta póliza nombra a «ACME Holdings» como asegurado. ¿Es esa su empresa matriz y la cobertura se extiende a su negocio?"*. Hay 5 minutos para contestar; la pregunta sobrevive a un refresh de la página y se puede responder desde otra pestaña o incluso desde otra instancia del servidor. Si nadie contesta, el sistema **continúa** con el criterio por defecto y deja registrado que fue por vencimiento — nunca se queda colgado.
5. **Ve su checklist de requisitos** — 11 categorías (identidad fiscal, responsabilidad civil, compensación laboral, auto, licencia, diversidad, seguridad, bancaria, seguridad de datos, acuerdos firmados, sanciones) — con lo cubierto, lo que falta y lo que **él mismo** puede marcar como "no aplica" (dentro de lo que el perfil permite; nunca las categorías obligatorias).
6. **Consulta al asistente** cuando algo no le calza: *"¿Por qué falló mi certificado?"*, *"¿Qué me falta para activar?"*. El asistente consulta el estado real en el momento, no adivina — y tiene prohibido prometer resultados o pasar por encima de una decisión del oficial.
7. **Activa su cuenta** cuando el checklist se completa → el estado pasa a `PRE_APPROVED`. Es una acción deliberada del proveedor, y el servidor vuelve a calcular la compuerta antes de aceptarla.

### El recorrido del oficial

Entra a `/vendors`, filtra el listado, abre un proveedor y ve: los requisitos con su **trazabilidad** (qué documento otorgó qué categoría), cada documento con su clasificación / datos extraídos / reglas de validación, y la determinación de cobertura con el desglose de qué póliza aportó cuánto.

🧑‍⚖️ **Desde ahí adjudica — este es el HITL del oficial.** Nada de lo que hace es automático, y nada de lo que hace queda sin registro:

- **Dispensar** una validación fallida (con justificación obligatoria, fecha de vencimiento y un alcance que el servidor **recorta** a lo que esa falla realmente bloquea),
- **Recategorizar** un documento mal tipificado (inserta una versión nueva; nunca sobrescribe la anterior),
- **Otorgar manualmente** una categoría, reconociendo explícitamente la anulación si el documento de respaldo falló,
- **Revocar** ese otorgamiento,
- **Reintentar** el procesamiento,
- **Firmar el estado final** (`APPROVED` / `NEED_REVIEW` / `REJECTED` / `PRE_APPROVED`), que queda sellado con su identidad y la hora,
- **Etiquetar** al proveedor.

Cada acción escribe una fila de actividad y recalcula el estado del proveedor **en la misma transacción**. Nada queda a medias, y toda la bitácora es reconstruible.

### Y el tiempo también decide

Un barrido horario revisa vencimientos: cuando un documento obligatorio caduca, el proveedor `APPROVED` pasa a `EXPIRED` solo; a 30, 14 y 1 día del vencimiento se generan avisos de renovación. Si el proveedor sube la renovación y valida, vuelve a `APPROVED` **sin que un oficial tenga que tocar nada** — el HITL se reserva para lo que de verdad exige criterio.

### Glosario mínimo

| Término | Qué significa aquí |
|---|---|
| **HITL** (*human in the loop*) | El punto donde el sistema se detiene y le pregunta a una persona. En Vendra hay dos: la confirmación del proveedor durante el procesamiento y la adjudicación del oficial en su panel |
| **Ventana durable** | Una pregunta HITL que vive en la base de datos, no solo en memoria: sobrevive a recargas, se puede responder desde cualquier instancia y vence de forma explícita |
| **Fail-open** | Si la ventana vence sin respuesta, el proceso **continúa** con un criterio por defecto registrado, en vez de quedarse bloqueado |
| **Harness** | Un agente de codificación ya hecho (Claude Code) con su propio ciclo de razonamiento y herramientas. Este backend lo *arrienda* en vez de armar el loop a mano |
| **Sandbox / MicroVM** | Una máquina virtual desechable donde corre el agente, aislada del servidor y con salida a internet restringida |
| **Host tool** | Una herramienta que el agente llama, pero que se ejecuta en el servidor Next.js (no dentro de la VM). Así el agente pide "guarda esta clasificación" y el host decide qué hacer con eso |
| **Compuerta de activación** | La matemática que decide si el proveedor puede activar su cuenta |
| **SSE / streaming** | La técnica para que el navegador reciba el avance en vivo mientras el agente trabaja |

---

## 2. Arranque rápido y cómo probar la app

Esta sección va completa: levantar el stack, entrar, **crear sus propias cuentas de proveedor y de oficial**, y qué documentos subir para ver funcionar cada parte del sistema. Si logra correr la app, debería poder usarla.

### 2.1 Requisitos previos

Solo **Docker** con Docker Compose v2 (`docker compose version` debe responder). No hace falta Node ni pnpm para el camino de Docker.

Y cuatro credenciales de las dos dependencias remotas:

| Variable | De dónde sale |
|---|---|
| `ANTHROPIC_API_KEY` | Consola de Anthropic → API Keys. La llave debe tener habilitado el modelo de `HARNESS_MODEL` (por defecto `claude-sonnet-4-6`) |
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens. Créelo **con alcance del equipo**, no personal |
| `VERCEL_TEAM_ID` | Vercel → Team Settings → General (empieza con `team_`) |
| `VERCEL_PROJECT_ID` | Vercel → cualquier proyecto → Settings → General (empieza con `prj_`) |

> **Se puede arrancar sin ellas.** La app igual levanta, sirve las dos interfaces, permite registrarse y aceptar subidas: los documentos quedan en cola y `/api/health` reporta `harness: unconfigured`. Lo que no ocurre es el procesamiento con agentes.

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

La primera vez la construcción de la imagen tarda algunos minutos. Ese único comando levanta **cinco servicios**:

| Servicio | Qué hace | Cuándo termina |
|---|---|---|
| `postgres` | Postgres 16, la base propia de la app (puerto host **5436**) | queda corriendo |
| `minio` | Almacenamiento de objetos compatible con S3 (**9000** API / **9001** consola) | queda corriendo |
| `minio-init` | Crea el bucket `vendor-docs` | one-shot |
| `migrate` | Aplica las migraciones y siembra la demo — **mire su log: ahí salen las credenciales** | one-shot |
| `app` | El servidor Next.js en **http://localhost:3000** | queda corriendo |

El servicio `app` espera a que `migrate` y `minio-init` terminen bien, así que cuando el puerto 3000 responde, la base ya está lista.

**Comprobar que quedó sano:**

```bash
curl -s http://localhost:3000/api/health
# {"db":"ok","storage":"ok","harness":"ok","sweeper":{...}}
# harness:"unconfigured" + "missing":[...] = falta alguna de las cuatro llaves
```

**Comandos del día a día:**

```bash
docker compose up -d                 # levantar en segundo plano
docker compose logs -f app           # seguir los logs de la app
docker compose logs migrate          # volver a ver las credenciales sembradas
docker compose restart app           # reiniciar solo la app (tras cambiar .env.docker)
docker compose down                  # detener; los datos sobreviven (volúmenes con nombre)
docker compose down -v               # detener Y BORRAR todo: base, archivos, cuentas
```

La consola de MinIO queda en http://localhost:9001 (`minioadmin` / `minioadmin`) si quiere ver los archivos subidos.

### 2.3 Las cuentas sembradas

El servicio `migrate` deja creadas una organización compradora (**Acme Construction Group**), dos perfiles de requisitos y dos cuentas:

| Rol | Correo | Contraseña |
|---|---|---|
| Oficial de cumplimiento | `officer@acme-demo.test` | `OfficerDemo123!` |
| Contacto de proveedor | `vendor@summit-demo.test` | `VendorDemo123!` |

Son credenciales de demo local, no secretos. La semilla es idempotente: si la organización ya existe, no hace nada.

### 2.4 Crear más cuentas de prueba

Para probar de punta a punta conviene tener varios proveedores (cada uno con su propio expediente) y más de un oficial. Hay dos caminos, y son distintos a propósito.

#### Proveedores → desde el navegador, sin tocar la terminal

Vaya a **http://localhost:3000/register** y complete cuatro campos: razón social, nombre del contacto, correo y contraseña (mínimo 8 caracteres). Eso crea la cuenta, crea la fila del proveedor dentro de `acme-construction` y la vincula con el primer perfil de requisitos (`construction-sub`). Es el mismo camino que usaría un proveedor real.

Repítalo con distintas razones sociales para tener varios expedientes en el listado del oficial.

#### Oficiales → por script, porque no hay registro público

Un oficial adjudica expedientes ajenos: por diseño **no existe** una página de registro para ese rol. Se crean con el script `create-account`, que usa la propia instancia de better-auth de la app (nunca escribe en las tablas de auth a mano).

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

El mismo script crea proveedores, si prefiere la terminal al navegador:

```bash
docker compose run --rm migrate \
  pnpm --filter vendra create-account -- \
    --role vendor \
    --email vendor@maple-demo.test \
    --password 'MapleDemo123!' \
    --name "Robin Vale" \
    --legal-name "Maple Works LLC"
```

**Banderas disponibles:**

| Bandera | Obligatoria | Qué hace |
|---|---|---|
| `--role` | sí | `officer` o `vendor` |
| `--email` | sí | Correo de inicio de sesión (único) |
| `--password` | sí | 8–128 caracteres (política de better-auth) |
| `--name` | sí | Nombre de la persona |
| `--legal-name` | solo `vendor` | Razón social — es el nombre contra el que se comparan los documentos |
| `--org` | no | Slug de la organización (por defecto `acme-construction`) |
| `--profile` | no | Nombre del perfil de requisitos: `construction-sub` (9 categorías) o `general-supplier` (5). Por defecto, el primero de la organización |

Imprime una línea JSON con lo creado, útil para guionar:

```json
{"userId":"NDKs…","role":"COMPLIANCE_OFFICER","email":"officer2@acme-demo.test"}
{"userId":"9C2D…","role":"VENDOR_CONTACT","email":"vendor@maple-demo.test","vendorId":4,"vendorUuid":"2e2b…"}
```

Si corre la app sin Docker (§13), el mismo comando funciona directo: `pnpm --filter vendra create-account -- --role officer …`.

### 2.5 Qué documentos subir

El agente clasifica por **lo que el documento muestra**, no por el nombre del archivo. Se aceptan **PDF, PNG, JPEG y WebP**, hasta 40 archivos de 10 MB cada uno. Esta es la tabla que importa: qué debe verse en la página para que el documento se reconozca, y qué categoría otorga si además pasa la validación.

| Suba esto | Debe mostrar | Otorga |
|---|---|---|
| **Certificado de seguro ACORD 25** | El título "CERTIFICATE OF LIABILITY INSURANCE", la casilla INSURED y la grilla de límites por línea | Responsabilidad civil, compensación laboral y/o auto |
| **Página de declaraciones de póliza** | Página "Declarations" de la aseguradora con asegurado, número de póliza, vigencia y límites de UNA póliza | Las mismas líneas de seguro |
| **Póliza umbrella / exceso** | Un documento "Umbrella" o "Excess Liability" con su propio límite | Responsabilidad civil y auto (apilándose sobre la primaria) |
| **Formulario W-9** | El encabezado "Form W-9" y la casilla del TIN en la Parte I | Identidad fiscal |
| **Formulario W-8BEN-E** | El encabezado "Form W-8BEN-E" (entidades extranjeras) | Identidad fiscal |
| **Licencia comercial** | Licencia o registro emitido por un estado/condado/ciudad, con número y fecha de vencimiento | Licencia comercial |
| **Certificación de diversidad** | Certificado de un organismo certificador (MBE / WBE / DBE / VOSB / 8(a) / HUBZone) | Certificación de diversidad |
| **Carta de EMR** | Carta de la aseguradora o del buró que indica la tasa de modificación por experiencia | Historial de seguridad |
| **OSHA 300A** | El encabezado del formulario 300A con los totales anuales | Historial de seguridad |
| **Carta bancaria** o **cheque anulado** | Carta en papel membretado del banco confirmando la cuenta, o un cheque marcado "VOID" | Verificación bancaria |
| **MSA o NDA firmado** | Contrato titulado "Master Services Agreement" o "Non-Disclosure Agreement", con bloques de firma | Acuerdos firmados |
| **SOC 2 / ISO 27001 / póliza cíber** | El informe, el certificado o la póliza correspondiente | Seguridad de datos (perfil `general-supplier`) |

**De dónde sacar archivos de prueba.** El W-9 y el OSHA 300A son formularios públicos que se descargan en blanco desde los sitios oficiales del IRS y de OSHA — sirven tal cual (un W-9 en blanco se clasifica igual; la extracción registra lo que falta). Para lo demás, plantillas de ejemplo de ACORD 25 y de cartas bancarias abundan en la web.

**O fabrique el suyo en 30 segundos**, que es la vía más rápida para probar un caso concreto: escriba un HTML con los identificadores de la tabla e imprímalo a PDF sin abrir nada.

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

Ese PDF de prueba se clasifica como W-9, pasa la validación y otorga identidad fiscal. Cambiando el contenido se arma cualquier caso: una licencia comercial vencida, un certificado con límites por debajo del umbral, una póliza a nombre de otra empresa para disparar la ventana HITL.

**No use documentos reales con datos personales**: los identificadores tributarios y las cuentas bancarias se enmascaran, pero no hay razón para arriesgarlos.

**Un archivo que no calza con nada** se clasifica como `UNKNOWN` a propósito — cotizaciones de seguros, material de marketing o correspondencia deberían dar exactamente eso. Es una prueba válida, no un error.

### 2.6 Cuatro guiones de prueba

El perfil sembrado por defecto, `construction-sub`, exige nueve categorías: identidad fiscal, responsabilidad civil, compensación laboral, auto, licencia comercial, historial de seguridad, verificación bancaria, acuerdos firmados y certificación de diversidad. De esas, **identidad fiscal y responsabilidad civil son obligatorias** (no se pueden descartar), y sus umbrales son 1 M USD por ocurrencia / 2 M agregado, con asegurado adicional requerido.

#### Guión A — el camino corto hasta la activación

El objetivo es llegar a `PRE_APPROVED` con la menor cantidad de documentos.

1. Regístrese en `/register` como **"Northwind Remote Services LLC"**.
2. En "Datos de la empresa" marque **"Solo remoto (sin trabajo presencial)"** y guarde. Eso descarta automáticamente seguro de auto y compensación laboral (no son obligatorias en este perfil) — y **sin gastar** ninguno de sus dos descartes manuales: quedará en 7 categorías pendientes y "0 de 2 descartes utilizados".
3. Marque **"No aplica"** en certificación de diversidad e historial de seguridad — los dos descartes manuales que permite el perfil. Quedan 5 pendientes: identidad fiscal, responsabilidad civil, licencia comercial, verificación bancaria y acuerdos firmados.
4. Suba cinco documentos: **W-9**, **certificado ACORD 25**, **licencia comercial**, **carta bancaria** y un **MSA firmado**.
5. Cuando el checklist quede completo → **Activar cuenta** → `PRE_APPROVED`.

#### Guión B — la ventana HITL del proveedor

Hay tres formas de provocarla, y cada una dispara una pregunta distinta:

| Para ver… | Suba… |
|---|---|
| *"¿Es esa su empresa matriz?"* | Una póliza o certificado a nombre de **otra empresa** claramente distinta (regístrese como "Cedar Grove Electric LLC" y suba un COI a nombre de "Cedar Holdings Group Inc.") |
| *"¿Es el mismo negocio bajo otro nombre?"* | Un documento con un nombre **parecido pero no igual** al registrado (registrado "Cedar Grove Electric LLC", documento "Cedar Grove Electrical Co.") |
| *"¿Aplica un endoso general de asegurado adicional?"* | Un **ACORD 25 que no indique** la condición de asegurado adicional — el perfil `construction-sub` la exige |

Con la pregunta en pantalla, pruebe las tres salidas: respóndala, **recargue la página** (sigue ahí, con su reloj corriendo), o **déjela vencer** los 5 minutos para ver el *fail-open* — el documento continúa y el resultado queda registrado como vencimiento.

#### Guión C — el apilamiento de cobertura

1. Suba un certificado o declaración con responsabilidad civil de **500.000 USD por ocurrencia** — por debajo del umbral de 1 M. La determinación quedará en `BELOW`.
2. Suba ahora una **póliza umbrella de 2.000.000 USD**.
3. Espere a que el carril de cobertura vuelva a correr. El veredicto pasa a `MEETS` con límite efectivo de 2,5 M, y el desglose muestra qué documento aportó como `primary` y cuál como `umbrella`.

Esa categoría **solo** la otorga la determinación: ningún documento suelto la concede por su cuenta.

#### Guión D — el rescate del oficial

1. Como proveedor, suba un documento que **falle** la validación: un certificado vencido, o uno cuyos límites no alcanzan el umbral.
2. Entre como oficial (`officer@acme-demo.test`), abra `/vendors` y luego el proveedor.
3. Pruebe las herramientas de adjudicación: **dispensar** la validación fallida (pide justificación de al menos 10 caracteres y fecha de vencimiento), **recategorizar** un documento mal tipificado, **otorgar a mano** una categoría, **revocarla** y **firmar** el estado final.
4. Abra la actividad del proveedor: cada acción quedó con actor, hora y justificación. Ese es el punto — el expediente explica por qué está como está.

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
│  • Las ventanas HITL del proveedor       │   │  • La herramienta interna `read`     │
│  • Las HOST TOOLS:                       │   │  • El archivo del documento          │
│      saveClassification                  │   │                                      │
│      saveExtraction                      │   │  Sin shell, sin escritura, sin web.  │
│      finalizeDocument   ← aquí se decide │   │  Egreso permitido SOLO hacia         │
│      failDocument                        │   │  api.anthropic.com y *.npmjs.org     │
└──────────────────────────────────────────┘   └──────────────────────────────────────┘
```

El agente **solo** puede: leer el archivo y llamar cuatro herramientas del host. No puede escribir archivos, no puede correr comandos, no puede navegar. Y cuando llama a `finalizeDocument`, quien valida, decide si hay que preguntarle al proveedor, mapea requisitos y escribe en la base es el host — con código puro y determinista.

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
- **El contrato vive en un solo módulo**: `features/vendor-compliance/lib/vendor-harness-contract.ts` — etapas, constantes de subida, tipos de *data part* (incluidas las partes de confirmación HITL) y esquemas zod de las herramientas. Lo importan las rutas, las herramientas del servidor y el cliente React, así el contrato del stream no puede desincronizarse entre capas.

---

## 4. Los dos puntos HITL: dónde decide una persona

Vendra automatiza la **lectura**, no el **criterio**. Hay exactamente dos lugares donde el sistema entrega el control a un ser humano, y están diseñados con reglas opuestas porque resuelven problemas opuestos.

| | **HITL del proveedor** | **HITL del oficial** |
|---|---|---|
| **Quién decide** | El contacto del proveedor, sobre su propio negocio | El oficial de cumplimiento, sobre el expediente ajeno |
| **Cuándo** | **Durante** el procesamiento — el pipeline está esperando | **Después**, en cualquier momento, sobre el estado ya calculado |
| **Qué aporta** | Conocimiento que solo él tiene (estructura societaria, DBA, endosos) | Criterio y responsabilidad (aceptar una excepción y firmarla) |
| **Si no responde** | *Fail-open*: el proceso continúa con el criterio por defecto, registrado | No hay vencimiento: el expediente simplemente espera |
| **Superficie** | Una tarjeta de pregunta en el portal, ventana de 5 min | Siete mutaciones tRPC en el panel `/vendors` |
| **Rastro** | Fila en `document_confirmation` con pregunta, respuesta, hora y resultado | Fila en `vendor_activity` + transición de estado, en la misma transacción |
| **Dónde vive** | `server/harness/confirmations.ts` | `server/trpc/router.ts` |

### 4.1 HITL del proveedor — la ventana de confirmación durable

**Cuándo se abre.** Después de extraer, el host compara el nombre de la entidad que aparece en el documento con la razón social registrada (con comparación difusa: variantes de nombres, sufijos societarios, abreviaturas). Si no calzan, o si falta información que solo el proveedor puede aclarar, el host abre una ventana con una de tres preguntas:

| Tipo | La pregunta que ve el proveedor |
|---|---|
| `PARENT_POLICY_COVERS_SUBSIDIARY` | *"Esta póliza nombra a «X» como asegurado. ¿Es esa su empresa matriz y la cobertura de dicha empresa se extiende a su negocio?"* |
| `DBA_SAME_ENTITY` | *"Este documento muestra el nombre «X». ¿Se trata de la misma empresa registrada bajo su razón social (es decir, un DBA o nombre comercial)?"* |
| `BLANKET_ENDORSEMENT_APPLIES` | *"El certificado no indica la condición de asegurado adicional. ¿Aplica a esta relación un endoso general (blanket) de asegurado adicional en la póliza?"* |

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

**Mientras tanto, el agente espera sin morirse.** El agente llama a `finalizeDocument`, el host le responde "confirmación pendiente" y el agente vuelve a llamar. Cada espera se trocea en tramos de 30 segundos para mantener vivo el bridge, y el presupuesto de turnos de la sesión se calcula con holgura explícita para eso: `28 + 2 × (ventana / 30 s)`.

**Garantías de seguridad de la ventana:**
- El `[uuid]` de la ruta debe coincidir con el documento de la confirmación: un POST cruzado **no puede** ganar la ventana de otro documento.
- La guardia de autenticación corre **antes** de parsear el cuerpo, para no entregar un oráculo 400-vs-401 sobre la forma del payload.
- Una corrida que ya abrió o resolvió una ventana **nunca se reintenta**: el reintento transitorio solo aplica mientras la corrida sigue siendo invisible para el proveedor.
- Preferencia por la vivacidad sobre la consistencia: si la base falla en el arbitraje, se registra la advertencia y el pipeline continúa — jamás se cuelga un documento por un problema de base.

**Los otros dos momentos del proveedor.** Además de la ventana, el proveedor toma dos decisiones propias, ambas verificadas en el servidor:

- **"No aplica"**: puede descartar categorías, pero el servidor filtra la lista contra las que el perfil marca como descartables, respeta el tope `maxManualDismissable` y **nunca** deja descartar una categoría obligatoria. Una categoría descartada tampoco cuenta como satisfecha (nada de doble crédito).
- **Activar la cuenta**: la matemática de la compuerta que corre en el cliente es solo experiencia de usuario; el servidor **la vuelve a derivar** y rechaza en tres niveles — `412` si la cobertura todavía se está determinando, `400` **nombrando** las categorías obligatorias que faltan, o `400` con el rechazo genérico por conteo. Y un proveedor en `REJECTED` no puede reactivarse solo: eso es una decisión del oficial (`EXPIRED`, en cambio, sí es autoservicio).

### 4.2 HITL del oficial — la adjudicación

El oficial no "revisa lo que hizo la IA": es la autoridad del expediente. Sus siete mutaciones comparten un mismo **contrato de atomicidad**, sin excepción:

```
bloqueo de fila (FOR UPDATE)
   → mutación
   → fila de actividad con actor y justificación
   → recálculo del proveedor
todo dentro de la MISMA transacción, con tramos de latencia registrados
   → después, fuera de la transacción, dispara la determinación de cobertura
```

| Mutación | Qué hace y qué la protege |
|---|---|
| `waiveDocumentValidation` | **Dispensa** una validación fallida. Exige justificación (10–1000 caracteres) y fecha de vencimiento. El **alcance se recorta en el servidor**: se toma lo que ese tipo de documento podría otorgar, se cruza con lo que la falla realmente bloquea y se intersecta con la intención del oficial — por construcción, un desajuste de nombre **jamás** puede dispensar la identidad fiscal. Lleva además un seguro de concurrencia optimista: si el estado de la dispensa cambió mientras el oficial trabajaba, devuelve `CONFLICT` |
| `reclassifyDocument` | **Recategoriza** un documento mal tipificado. Inserta `version + 1` en la tabla de extracciones — **append-only, jamás sobrescribe**. Rechaza `UNKNOWN` y rechaza cualquier tipo que el perfil del proveedor no acepte |
| `grantManualRequirement` | **Otorga** una categoría a mano. Si el documento de respaldo falló, exige un `acknowledgeOverride` explícito: el oficial declara que sabe lo que está haciendo. Rechaza otorgar lo ya satisfecho — **salvo en las tres categorías de seguro**, donde la determinación es la única autoridad y por lo tanto el otorgamiento manual es el único remedio disponible |
| `revokeManualRequirement` | **Revoca** un otorgamiento, con justificación. Un índice parcial único garantiza un solo otorgamiento activo por (documento, categoría) |
| `retryDocumentProcessing` | **Reintenta** el pipeline de un documento |
| `finalizeStatus` | **Firma el estado final** (`PRE_APPROVED` / `NEED_REVIEW` / `APPROVED` / `REJECTED`). Sella `signoffUserId` y `signoffAt`: el expediente queda con nombre y hora. Es idempotente — refirmar el mismo estado no altera el reloj de la firma |
| `setVendorTags` | Etiqueta al proveedor para la gestión del listado |

**Privacidad dentro del propio HITL:** el texto de justificación del oficial es información sensible de negocio y **nunca se escribe en los logs** — solo su largo (`noteLen`). Queda íntegro en la base, accesible desde el panel, no desparramado en la salida estándar.

**Autorización:** todas viven detrás de `complianceAdminProcedure`, que resuelve la sesión en el servidor, verifica el rol y acota a la organización del oficial. Un no-oficial recibe `NOT_FOUND`, no `FORBIDDEN` — el sistema no filtra ni siquiera la existencia del expediente.

### 4.3 Lo que el HITL *no* es

- **No es una aprobación ciega de lo que dijo el modelo.** El agente nunca propone "apruebo/rechazo": propone una clasificación y unos datos. Lo que se valida, se mapea y se aprueba es responsabilidad del código puro y del oficial.
- **No es un cuello de botella.** El HITL del proveedor solo se abre cuando hay una ambigüedad real de identidad, y vence solo. Las renovaciones rutinarias se resuelven sin intervención de nadie.
- **No es opcional en su rastro.** Toda respuesta y toda adjudicación quedan en la base con actor, hora, justificación y resultado. La pregunta "¿por qué este proveedor está aprobado?" siempre tiene respuesta.

---

## 5. Carril 1 — el pipeline por documento

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
   │                                │ 6. compara nombres de entidad    │
   │ 🧑‍⚖️ HITL ◄────────────────────│    → ventana durable de 5 min    │
   │ respuesta ───────────────────►│      (el agente reintenta        │
   │  (o vence → fail-open)         │       finalizeDocument cada 30s) │
   │                                │ 7. mapea requisitos              │
   │                                │ 8. CAS: →PROCESSED / FAILED      │
   │                                │ 9. recalcula el proveedor        │
   │                                │10. dispara el carril de cobertura│
```

Puntos finos que importan:

- **CAS en cada reclamo y cada terminal** (*compare-and-swap*): dos clics simultáneos o el conserje automático nunca pueden procesar dos veces ni pisar un estado final.
- **Semántica de desconexión:** el `abortSignal` de la ruta **excluye a propósito `req.signal`** — cerrar la pestaña no debe matar el procesamiento, y menos aún abandonar una ventana HITL abierta. El cliente se re-sincroniza con un *poll* de snapshot cada 10 s, y la pregunta pendiente reaparece.
- **Recuperación transitoria:** si la sesión se cae y todavía no se escribió nada hacia el proveedor (sin terminal, **sin ventana HITL abierta ni resuelta**), se reintenta en una sesión nueva. Si ya hubo efectos visibles para la persona, no se reintenta.
- **El catálogo manda:** 17 tipos de documento (16 reales + `UNKNOWN`), y el agente solo puede elegir entre los tipos que el perfil del proveedor exige. Las descripciones de cada campo del esquema (`.describe()` en Zod) **son literalmente** las instrucciones de extracción que recibe el modelo.
- **Sin fallo silencioso:** si la corrida termina sin estado final, el host escribe la falla con una razón accionable en español.

---

## 6. Carril 2 — la determinación de cobertura

Un certificado de seguro rara vez alcanza solo: la póliza primaria da 1 M USD, la umbrella agrega 4 M encima, y el requisito es 5 M. Decidir eso exige leer varios documentos juntos.

Ese es el único trabajo del segundo carril: **una sesión por proveedor** que lee las pólizas ya extraídas y reporta, por línea (`GENERAL_LIABILITY`, `WORKERS_COMP`, `AUTO`), el límite efectivo, qué documento aportó cuánto (`primary` / `umbrella` / `excess` / `rejected`) y un veredicto (`MEETS` / `BELOW` / `UNDETERMINED`).

Disciplina de este carril:

- **Coalescido por proveedor:** si llega un disparo mientras corre, se marca `rerun` en vez de apilar sesiones.
- **Caché por firma:** un hash del conjunto de entradas corta las recorridas idénticas; la firma lleva un eje de versión (la palanca para purgar la política).
- **Fail-open explícito:** tras 3 intentos se persiste un registro `UNDETERMINED`. Los lectores muestran "sin determinar", **nunca** una cifra vieja disfrazada de fresca.
- **El host es la autoridad:** el validador rebota los payloads malos de vuelta al agente, y las cifras persistidas se re-derivan de las contribuciones.
- **Solo la determinación otorga** las tres categorías de seguro. Un documento suelto no puede otorgarlas por su cuenta — y por eso, como se explicó en §4.2, el otorgamiento manual del oficial siempre está permitido ahí: es su único remedio cuando la máquina no alcanza a concluir.

El progreso se ve en vivo en el navegador con un `useChat` de solo-adjuntar que reconecta al stream GET (`resumeStream()` + `prepareReconnectToStreamRequest`).

---

## 7. Carril 3 — el asistente LLM del proveedor

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

### El asistente también respeta el HITL

Sus instrucciones lo dicen explícitamente: **"usted nunca decide el cumplimiento"**. Puede explicar por qué un documento falló, qué falta para activar o qué significa una dispensa, pero tiene prohibido pasar por encima de una decisión del oficial, prometer un resultado o inventar un estado. Es un traductor del expediente, no un adjudicador — el complemento natural de los dos puntos HITL, no un tercero.

### Memoria de largo plazo: cómo está implementada

El asistente recuerda cosas entre sesiones — no solo dentro de una conversación. Así funciona, en concreto.

#### Dónde vive

Una sola tabla genérica de turnos, `assistant_chat_turn`, con la forma `{ thread_id, vendor_id, message_id, role, parts, metadata, created_at }` y `UNIQUE(thread_id, message_id)`. Sobre esa misma tabla conviven **tres espacios de nombres** por proveedor, separados por el prefijo del `thread_id`:

| `thread_id` | Contenido | Forma de las filas |
|---|---|---|
| `vendor-chat:<uuid>` | La transcripción visible del chat | Una fila por mensaje |
| `vendor-session:<uuid>` | El estado de reanudación del harness | **Una** fila, `message_id` fijo `harness-resume-state`, escrita con *upsert* |
| `vendor-memory:<uuid>` | **Los hechos recordados** | Una fila por hecho, `role: "memory"`, `parts: [{ type: "text", text: <hecho> }]` |

La memoria está **acotada al proveedor**, no al usuario, ni a la sesión, ni al hilo de chat: sobrevive a cerrar sesión, a que se destruya la sesión del harness y a que se pode la transcripción. Solo desaparece si se borra el proveedor (`ON DELETE CASCADE`). El `id` serial de la tabla es el desempate monotónico para ordenar y podar cuando dos filas caen en el mismo instante.

#### El ciclo completo — el "sándwich de memoria"

```
ANTES del turno  │ ¿sesión fresca? → recallMemory() → bloque <long_term_memory> en el prompt
DURANTE el turno │ el agente conversa y, si el proveedor le contó algo duradero,
                 │ llama a la herramienta rememberFacts(...)
                 │   host: redactar → deduplicar → insertar → podar
DESPUÉS          │ nada que hacer: los hechos ya están en la base para la próxima sesión
```

#### Qué dispara la escritura: la decide el LLM, no el host

No hay ninguna heurística del servidor que analice la conversación y decida guardar. **La escritura la dispara el modelo**, llamando a una herramienta — igual que el agente de documentos llama a `saveClassification`. El host no propone: solo ofrece la herramienta, valida y ejecuta.

La cadena completa, paquete por paquete:

```
1. ai (núcleo v7)                     tools.ts  → tool({ description, inputSchema, execute })
       │                                          la DESCRIPTION es lo que el modelo lee
       ▼                                          para decidir; execute es código del host
2. @ai-sdk/harness                   session.ts → new HarnessAgent({ tools, activeTools })
       │                                          activeTools es la lista blanca: sin
       ▼                                          "rememberFacts" ahí, no existe para el modelo
3. @ai-sdk/harness-claude-code                  → createClaudeCode(): corre el CLI de Claude
       │                                          Code dentro de la MicroVM y le publica
       ▼                                          las herramientas del host
4. EL MODELO decide                              → emite la llamada rememberFacts({ facts: [...] })
       │                                          guiado por dos textos: la description de la
       ▼                                          herramienta y el bloque instructions
5. el bridge (puertos 4000-4003)                → la llamada viaja de la VM al proceso Next.js
       │
       ▼
6. zod valida el payload                        → 1-5 hechos, 1-300 caracteres cada uno
       │
       ▼
7. execute() corre EN EL HOST        memory.ts → redactar → deduplicar → insertar → podar
       │                              (Drizzle) → Postgres
       ▼
8. devuelve { stored: n } al modelo             → sigue su turno sabiendo cuántos se guardaron
```

**Los dos textos que gobiernan la decisión** están a la vista en el repositorio (en el código están escritos en inglés, porque los lee el modelo; aquí van traducidos):

- La **descripción de la herramienta** (`server/assistant/tools.ts`): *"Guarda hasta 5 hechos breves y duraderos que el proveedor le contó sobre su negocio, para sesiones futuras. Nunca guarde salida del asistente, contenido de documentos ni datos de contacto o tributarios."*
- El **bloque de instrucciones** de la sesión (`server/assistant/prompt.ts`), que agrega el criterio: solo lo que **el proveedor dijo** —circunstancias del negocio, preferencias, correcciones—, y *"omita las cortesías"*.

Cambiar cuándo se recuerda algo es, entonces, **editar esos dos textos** — no escribir lógica nueva.

Y el proveedor lo ve pasar: la parte de herramienta se renderiza en el chat como *"Tomando nota…"* → *"Anotado para la próxima vez"* con un ícono de bombilla (`assistant-chat.tsx`). La memoria no se escribe a espaldas de nadie.

#### 1. Escritura — qué pasa exactamente al llamar `rememberFacts`

1. **Validación en el borde:** el esquema zod acepta entre **1 y 5 hechos por llamada**, cada uno de **1 a 300 caracteres**.
2. **Redacción de PII**, en este orden exacto — y el orden importa:
   1. marcado `<…>` y después cualquier `<` o `>` suelto → espacio. *(Un hecho guardado vuelve a entrar al prompt dentro de una cerca XML: los ángulos son el vector de escape.)*
   2. dígitos con forma de identificador personal → `[redacted-ssn]`. *(Antes que el detector de teléfonos alcance a comérselos.)*
   3. EIN en forma con guion → `[redacted-ein]`. *(La forma de nueve dígitos corridos se deja pasar a propósito: es indistinguible de cualquier otro identificador.)*
   4. teléfonos → `[redacted-phone]`
   5. correos → `[redacted-email]`
   6. colapso de espacios múltiples y recorte.
3. **Deduplicación:** se cargan los hechos ya almacenados, se normalizan a minúsculas sin espacios extremos y se descarta todo lo que ya esté. Es una comparación **literal**, no semántica: la regla es predecible y auditable.
4. **Inserción** con `onConflictDoNothing` sobre `(thread_id, message_id)`, donde el `message_id` es un uuid generado en el host — un reintento del turno no puede duplicar un hecho.
5. **Poda:** se borran las filas más viejas fuera de las **40 más recientes** por `(created_at DESC, id DESC)`.
6. La herramienta le devuelve `{ stored: n }` al agente: sabe cuántos quedaron realmente guardados en vez de suponerlo.

#### 2. Recuperación — cuándo se inyecta, y cuánto

- **Solo cuando la sesión arranca fresca.** Si el turno reanudó una sesión estacionada, los hechos ya viven en el historial de esa sesión; reinyectarlos sería duplicarlos y gastar contexto. La ruta consulta `isFreshSession` y solo entonces llama a `recallMemory()`.
- **La selección tiene dos topes y gana el que se agote primero:** se leen hasta 40 hechos en orden cronológico, se toman los **20 más recientes**, y de esos se acumulan **del más nuevo al más viejo** hasta llegar a **2.000 caracteres**. En la práctica manda el tope de caracteres.
- Lo seleccionado se **re-emite en orden cronológico**, para que el modelo lea la historia del proveedor en el orden en que ocurrió.
- Se inyecta en el prompt del turno dentro de una cerca `<long_term_memory>`, con cada hecho **sanitizado otra vez** y recortado a 300 caracteres — defensa en profundidad, aunque ya se haya redactado al escribir.
- Las instrucciones de la sesión declaran explícitamente que ese bloque es **contexto, no instrucciones**: nada de lo que diga un hecho recordado puede cambiar las reglas del asistente.

#### 3. Qué no se guarda

La descripción de la herramienta y las instrucciones lo acotan: **solo hechos que el proveedor dijo sobre su negocio** (circunstancias, preferencias, correcciones que hizo). Nunca lo que el asistente respondió o recomendó, nunca contenido de documentos, nunca identificadores tributarios, teléfonos ni correos. Si algo se cuela igual, la redacción del paso 2 lo ataja.

#### 4. Falla suave en las dos direcciones

Una lectura fallida devuelve `[]` y el chat sigue funcionando sin memoria; una escritura fallida devuelve `0` y el turno continúa. Ninguna rompe el stream en vivo, y las dos dejan su línea de log (`assistant.memory_recall_failed` / `assistant.memory_write_failed`) — el log **es** la alarma, porque una memoria que muere en silencio es la trampa operativa clásica.

#### Los topes, de una mirada

| Límite | Valor | Dónde está definido |
|---|---|---|
| Hechos por llamada a la herramienta | 1–5 | `rememberFactsInputSchema` (zod) |
| Largo de un hecho al escribirlo | 1–300 caracteres | `rememberFactsInputSchema` (zod) |
| Hechos almacenados por proveedor | **40** (más allá se poda) | `MAX_STORED_FACTS` |
| Hechos considerados al recordar | 20 | `RECALL_MAX_FACTS` |
| Caracteres inyectados en el prompt | 2.000 | `RECALL_MAX_CHARS` |
| Largo de un hecho al inyectarlo | 300 caracteres | `sanitizeInline` |
| Mensajes de transcripción conservados | 80 | `ASSISTANT_HISTORY_LIMIT` |

`server/assistant/memory.ts` es el **único** módulo que sabe cómo se guardan los hechos: hacia afuera solo expone `recallMemory()` y `rememberFacts()`. Si algún día cambia el almacenamiento, ese archivo es la costura — nadie más se entera.

### Identidad, límites y desconexión

La identidad se implica por cookie: la sesión de better-auth nombra al proveedor — **el cuerpo del request nunca**. Límite: 20 turnos por proveedor cada 5 minutos, con devolución del cupo si el turno se rechaza. Cada escritura en `assistant_chat_turn` cae sobre `UNIQUE(thread_id, message_id)`, que es la frontera de idempotencia de los tres espacios de nombres: la transcripción se inserta con `onConflictDoNothing` y el estado de reanudación es un *upsert* sobre un `message_id` fijo, así que un reintento nunca duplica ni pisa. A diferencia del carril de documentos, aquí el abort **sí** compone `req.signal`: un turno de chat solo le importa a quien lo está mirando. La pregunta del usuario se pre-persiste de forma optimista, así un turno abandonado nunca pierde lo que se escribió, y la transcripción se poda a los 80 mensajes más recientes desde el `onEnd` del stream, en modo tolerante a fallos.

---

## 8. Arquitectura completa

```mermaid
flowchart TB
    subgraph browser["Navegador"]
        VP["Portal del proveedor<br/>useChat · SSE · AI Elements"]
        HITL["🧑‍⚖️ Tarjeta de confirmación<br/>ventana de 5 min"]
        OD["Panel del oficial<br/>🧑‍⚖️ 7 mutaciones de adjudicación"]
    end

    subgraph host["Contenedor app — Next.js 16 (Node)"]
        AUTH["better-auth<br/>correo+clave · 2 roles"]
        API["Rutas /api/vendor/*<br/>streams SSE"]
        CONF["Ventanas HITL durables<br/>confirmations.ts"]
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
    VP --- HITL
    HITL --> CONF
    OD --> TRPC
    VP -.->|cookie| AUTH
    OD -.->|cookie| AUTH
    API --> LANES
    LANES --> CONF
    CONF --> DRIZ
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
| **🧑‍⚖️ Ventanas HITL del proveedor** | `server/harness/confirmations.ts` + `/api/vendor/documents/[uuid]/confirmation` | Registro durable primero, ventana de 5 min, poll cruzado cada 5 s entre instancias, esperas troceadas de 30 s que mantienen vivo el bridge, arbitraje atómico entre respuesta y vencimiento, expiración *fail-open*. Ver [§4.1](#41-hitl-del-proveedor--la-ventana-de-confirmación-durable) |
| **🧑‍⚖️ Kit de adjudicación del oficial** | `server/trpc/router.ts` | 7 mutaciones bajo el mismo contrato de atomicidad: bloqueo de fila → mutación → fila de actividad → recálculo, todo en la misma transacción. Alcances de dispensa recortados en el servidor, recategorización *append-only*, firma con actor y hora. Ver [§4.2](#42-hitl-del-oficial--la-adjudicación) |
| **Contrato del stream** | `features/vendor-compliance/lib/vendor-harness-contract.ts` | UN archivo compartido por rutas, herramientas y cliente: *data parts* tipados (etapas, extracción, validación, **confirmación**, terminal), esquemas zod de las herramientas, constantes de subida |
| **Asistente del proveedor** | `server/assistant/` + `/api/vendor/assistant` | Sesión estacionada por hilo, 3 herramientas del host, memoria de 40 hechos con redacción de PII, transcripción en Postgres |
| **Carril de cobertura** | `server/harness/coverage-runner.ts` | Sesión coalescida por proveedor, caché por firma de entradas, pensamiento deshabilitado, validación del payload en el host, registro `UNDETERMINED` a prueba de fallos |
| **Elementos de IA vendorizados** | `src/components/ai-elements/` | Primitivas de render del AI SDK como código propio: `Tool` con su máquina de estados, `Reasoning` que se abre y cierra solo, `Task` como checklist de etapas, `Conversation`, `PromptInput`, `Response` |
| **Motores puros** | `packages/workflow/src/vendor/` | Sin IA, sin IO: catálogo de 17 tipos + esquemas de extracción, validadores, mapa documento→categoría, matemática de la compuerta, trazabilidad, comparación difusa de nombres de entidad (lo que dispara el HITL), núcleo de cobertura |
| **Motor de recálculo** | `server/recompute.ts` | Todo terminal, toda adjudicación del oficial y todo tic del barrido pasan por un único pliegue: lecturas sobre la transacción del llamante, categorías de cobertura solo desde la determinación, un solo *merge* jsonb, bloqueos `FOR UPDATE` |
| **Barrido de vencimientos** | `server/sweep.ts` | Tic horario con *advisory lock*: `APPROVED → EXPIRED` cuando caduca un documento requerido; avisos a 30/14/1 día; la renovación válida revierte el estado sola, sin HITL |
| **Conserje** | `server/harness/janitor.ts` | Rescata corridas huérfanas (por ejemplo si la app se reinició a mitad del procesamiento) |

### Reglas de diseño no negociables

- **Veracidad ante todo:** una corrida que no terminó **no escribe nada**; una determinación vieja se muestra como "actualizando", nunca como cifra fresca; un documento fallido trae una razón real y accionable.
- **El humano nunca queda bloqueado ni ignorado:** una ventana HITL siempre se cierra (con respuesta o con vencimiento registrado), y una adjudicación del oficial siempre se refleja en el estado dentro de la misma transacción.
- **Observabilidad desde el día uno:** cada evento del pipeline es una línea grepeable — `[vendra:<evento>] k=v k=v` — desde `process.start` hasta `process.done`, incluyendo `confirmation.answered` / `confirmation.expired` y `officer.waive`, con tramos de latencia por fase.
- **Cero confianza en el cliente:** toda ruta `/api/vendor/*` y todo procedimiento tRPC resuelve la sesión en el servidor. El cuerpo del POST de `/process` se ignora deliberadamente: las entradas se cargan de la fila y del almacenamiento.

---

## 9. El rol de cada pieza del stack

### Capa de IA — AI SDK v7

| Paquete | Rol exacto en Vendra |
|---|---|
| **`ai`** (núcleo v7) | Solo tres cosas: `tool()` para definir las herramientas del host, `createUIMessageStream` / `createUIMessageStreamResponse` para abrir el stream hacia el navegador, y `toUIMessageStream` para fusionar el stream del agente. **Ninguna llamada directa a `generateText` / `streamText`** |
| **`@ai-sdk/harness`** | La clase `HarnessAgent`: crear sesión, transmitir, reanudar, detener, destruir. También `prepareSandboxForHarness` (pre-horneado) y `createFileReporter` (telemetría de turnos fallidos a `.harness-logs/`) |
| **`@ai-sdk/harness-claude-code`** | El adaptador concreto: `createClaudeCode({ model, thinking, maxTurns, auth })`. Instala y opera el CLI de Claude Code dentro de la VM y expone sus herramientas internas |
| **`@ai-sdk/sandbox-vercel`** | El proveedor de sandbox: `createVercelSandbox({ sandbox, bridgePorts })` en modo *wrap* — este repo es dueño del ciclo de vida de la VM |
| **`@vercel/sandbox`** | El SDK crudo de la MicroVM: `Sandbox.create({ runtime, ports, networkPolicy, timeout, env })`, y sus tipos de error (`APIError`, `StreamError`) que se aplanan en campos de log |
| **`@ai-sdk/react`** | `useChat` en el cliente: consume los *data parts* tipados del stream — incluida la parte de confirmación que **renderiza la tarjeta HITL** —, maneja `resumeStream()` para reconectar al progreso de cobertura y renderiza las partes de herramienta |

> Nota sobre el HITL y el SDK: v7 ofrece `toolApproval` para aprobaciones humanas con alcance de stream. Vendra **no lo usa** a propósito — ver [§4.1](#41-hitl-del-proveedor--la-ventana-de-confirmación-durable): la ventana debe sobrevivir a recargas y resolverse desde cualquier instancia, y eso exige un registro durable en base, no un estado de stream.

### Autenticación — better-auth

Instancia local, **solo correo y contraseña**. Sin SSO, sin captcha, sin envío de correos, sin *haveibeenpwned*: crear cuenta e iniciar sesión funcionan **100% offline** contra los contenedores propios del repo.

- Dos roles reales (`VENDOR_CONTACT`, `COMPLIANCE_OFFICER`, más `ADMIN`), guardados como `additionalFields` en la fila de usuario junto con `organizationId` y `vendorId`. **Ese rol es lo que separa los dos puntos HITL**: quién puede responder una ventana y quién puede adjudicar.
- **`input: false` en cada campo adicional**: el rol y el vínculo con el tenant nunca son seteables desde el cliente — se asignan en el servidor al registrar.
- `disabledPaths: ["/sign-up/email"]`: el registro va por `/api/vendor/register`, que es quien asigna rol y tenant. El `auth.api.signUpEmail` interno sigue disponible para la semilla y los scripts.
- **Rate limiting activo en todos los modos** (la librería por defecto solo lo activa en producción) y telemetría explícitamente apagada.
- Habla con la base **solo** por su `drizzleAdapter(getDb())`; el código de la app nunca consulta las tablas de auth directamente.

### Base de datos — Drizzle ORM + Postgres 16

Este repositorio **es dueño de su esquema**. Nada de apuntar a una base ajena.

- El esquema vive en un solo archivo: `packages/db-vendor/drizzle/schema.ts`.
- Los cambios se generan con `drizzle-kit generate` y se aplican con el migrador programático de `drizzle-orm` (servicio `migrate` del compose). **Nunca `push`, nunca DDL a mano por psql.**
- **Toda interacción con la base pasa por Drizzle.** El *query builder* es la regla; el tag parametrizado `` sql`` `` se permite solo donde el builder no tiene equivalente (advisory locks, *merge* de hermanos jsonb, `NULLS LAST`). Nunca SQL armado con strings, nunca `sql.raw`, nunca un segundo cliente `pg`.
- Es también **el sustrato del HITL**: la durabilidad de la ventana de confirmación y la atomicidad de cada adjudicación (bloqueo + mutación + actividad + recálculo en una transacción) son garantías de Postgres expresadas en Drizzle.

### Almacenamiento — MinIO (compatible con S3)

Dos clientes S3 sobre un mismo bucket, y la razón es sutil: **SigV4 firma el host**.

- `storageClient` → operaciones del servidor contra el endpoint interno (`http://minio:9000`).
- `presignClient` → prefirma contra el endpoint que **el navegador** puede alcanzar (`http://localhost:9000`), y con `requestChecksumCalculation: "WHEN_REQUIRED"` (el default nuevo del SDK de AWS mete un checksum CRC32 de cuerpo vacío que una subida de navegador no puede satisfacer).

En AWS real basta con no definir los endpoints: la resolución por defecto toma el control, un solo camino de código.

### API y UI

| Pieza | Rol |
|---|---|
| **Next.js 16** (App Router) | Un solo servidor para las dos interfaces + todas las APIs. `runtime: "nodejs"`, `instrumentation.ts` para calentar el sandbox y arrancar el barrido |
| **React 19** | Componentes de servidor para las páginas, cliente para las superficies en vivo (streaming, tarjeta HITL, diálogos de adjudicación) |
| **tRPC 11 + TanStack Query 5** | La superficie del oficial: tipos punta a punta, `superjson` como transformer, `complianceAdminProcedure` que valida rol y organización en el servidor (un no-oficial recibe `NOT_FOUND`, indistinguible de "no existe") |
| **Rutas SSE** | La superficie del proveedor: el streaming en vivo y la ventana HITL no caben en tRPC, así que son rutas `/api/vendor/*` con `createUIMessageStream` |
| **Tailwind CSS 3** + `clsx` + `tailwind-merge` | Estilos, sin CDN ni fuentes externas |
| **AI Elements vendorizados** + **streamdown** | Render de partes de herramienta, razonamiento y markdown en streaming |
| **Zod 4** | La frontera de validación: entradas de las herramientas del host, cuerpos de las rutas (incluida la respuesta HITL), justificaciones del oficial con largos mínimos y máximos, variables de entorno (vía `@t3-oss/env-nextjs`), y los esquemas de extracción cuyas descripciones son el prompt del modelo |

### Los motores puros — `@vendra/workflow`

Un paquete con **cero** imports de `ai`, de proveedores o de red, por contrato. Ahí vive todo lo que decide: catálogo de documentos, esquemas de extracción, validadores, mapa documento→categoría, matemática de la compuerta de activación, trazabilidad de requisitos, comparación difusa de nombres de entidad —el motor que determina **cuándo hay que abrir una ventana HITL**— y el núcleo de la determinación de cobertura. Es puro y con el `now` inyectado, así el barrido de vencimientos puede evaluarlo como simple aritmética.

### El conjunto de dependencias externas: exactamente dos

Vale la pena decirlo explícitamente, porque explica muchas decisiones de este repo:

> **Vendra depende de dos servicios externos y de ninguno más: la API de Anthropic (detrás de Claude Code) y Vercel Sandbox.** Ambos son llamadas de **solo egreso**. Todo lo demás —base de datos, almacenamiento de objetos, autenticación, sesiones, memoria del asistente, colas, temporizadores— corre en contenedores que este repositorio levanta y administra.

Eso significa, en la práctica: sin CDN, sin fuentes remotas, sin gateway de modelos entremedio (la autenticación con Anthropic se fija de forma directa, para que ningún fallback de entorno se active solo), sin sumideros de telemetría de terceros, sin servicios gestionados de ningún tipo, y sin un segundo proveedor de modelos para tareas auxiliares.

De ahí sale, por ejemplo, la forma de la memoria del asistente: se implementó sobre la propia base de datos de la app, con deduplicación literal y topes explícitos ([§7](#7-carril-3--el-asistente-llm-del-proveedor)), en vez de apoyarse en un servicio de memoria o en búsqueda semántica — que exigiría un modelo de *embeddings* y, con él, una tercera dependencia externa.

La única excepción a esta regla es la herramienta de **desarrollo** (el propio Claude Code, sus *skills*, los servidores MCP, las pruebas en navegador): nada de eso llega al código que se despliega.

---

## 10. Versiones exactas

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
| `better-auth` | **1.7.1** | Autenticación y los dos roles |
| `drizzle-orm` | **0.45.2** | ORM |
| `pg` | **8.23.0** | Driver de Postgres |
| `@trpc/server` · `@trpc/client` · `@trpc/tanstack-react-query` | **11.x** (11.18.0) | API tipada del oficial (las 7 mutaciones de adjudicación) |
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

## 11. Modelo de datos

Todo en la base propia de la app (`vendra`), definido en `packages/db-vendor/drizzle/schema.ts`.

| Tabla | Contenido |
|---|---|
| `organization` | El comprador (tenant). El `slug` es display/ruteo — **nunca** una entrada de permisos |
| `vendor_requirement_profile` | Qué exige ese comprador: categorías requeridas, obligatorias, descartables, umbrales (jsonb) |
| `vendor` | El proveedor: nombre legal, DBA, últimos 4 del identificador tributario, perfil de trabajo (jsonb), categorías descartadas por él mismo, estado de cumplimiento, **firma del oficial** (`signoff_user_id`, `signoff_at`), metadata (jsonb: determinación de cobertura, overrides, reintentos), próxima expiración denormalizada |
| `vendor_document` | Un archivo subido: estado (transicionado por CAS), llave en el almacén, metadata del archivo, tipo resuelto, fecha de expiración extraída |
| `vendor_document_extraction` | **Append-only**: una versión por clasificación. Recategorizar inserta `version+1`, jamás muta. Guarda tipo, confianza, razonamiento, datos extraídos (con el TIN ya enmascarado), reglas de validación, categorías otorgadas y **la dispensa del oficial** (con nota, alcance, vencimiento y actor) |
| `manual_requirement_grant` | Otorgamientos manuales del oficial, con índice parcial único: **un solo otorgamiento activo** por (documento, categoría). Guarda justificación, quién otorgó, quién revocó y por qué |
| **`document_confirmation`** | **El registro durable del HITL del proveedor**: pregunta, tipo, entidad nombrada, respuesta por defecto, momento en que se levantó, vencimiento, respuesta y resultado (`answered` / `default` / `timeout`) |
| `vendor_activity` | La bitácora: 15 tipos de evento (subida, verificación, rechazo, **dispensa**, **recategorización**, **otorgamiento y revocación manual**, reintento, cambio de estado, vencimientos…), actor, documento, metadata |
| `vendor_status_transition` | Cada cambio de estado con su origen: `gate` (la compuerta), `officer_decision` (el HITL del oficial) o `sweep` (el tiempo) |
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

## 12. Seguridad y privacidad

- **PII:** los identificadores tributarios completos y los números de cuenta bancaria nunca se piden, nunca se guardan, y se vuelven a enmascarar al momento de persistir (defensa en profundidad). **El texto de justificación del oficial nunca se registra en logs** (solo su largo): una decisión HITL deja rastro auditable en la base, no en la salida estándar.
- **Aislamiento del agente:** lista blanca de herramientas (`activeTools`), `permissionMode: "allow-reads"`, egreso denegado por defecto salvo dos hosts, y el documento montado en un directorio de trabajo por sesión.
- **Inyección de prompt:** el contenido de documentos y los hechos recordados se declaran como contexto, no instrucciones; el marcado se sanitiza al escribir y al inyectar.
- **Autorización:** cada ruta y cada procedimiento resuelve la sesión en el servidor. El rol y el tenant nunca vienen del cliente. Un no-oficial recibe `NOT_FOUND`, no `FORBIDDEN` (no filtra existencia).
- **Integridad del HITL:** una respuesta de confirmación solo vale para el documento al que pertenece (el `uuid` de la ruta y el de la ventana deben coincidir); la guardia de autenticación corre antes de parsear el cuerpo; y el arbitraje entre respuesta y vencimiento es atómico, así una ventana no puede resolverse dos veces con resultados distintos.
- **Alcances acotados en el servidor:** una dispensa por desajuste de nombre no puede, por construcción, dispensar la identidad fiscal. El oficial decide; el servidor delimita hasta dónde llega esa decisión.
- **Secretos:** las cuatro llaves remotas viven solo en el entorno; nunca en código, commits, logs ni respuestas.

---

## 13. Desarrollo local sin Docker

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
pnpm --filter vendra type-check  # gate de tipos
pnpm --filter vendra build       # gate de build
```

Los scripts `migrate` y `create-account` cargan `apps/vendra/.env.local` por sí solos cuando existe (`--env-file-if-exists`), así que corren igual desde la terminal local y dentro del contenedor del migrador, donde el entorno llega por `.env.docker`.

Crear cuentas de prueba a demanda — las mismas banderas de [§2.4](#oficiales--por-script-porque-no-hay-registro-público):

```bash
pnpm --filter vendra create-account -- --role officer \
  --email officer2@acme-demo.test --password 'Officer2Demo123!' --name "Segunda Oficial"

pnpm --filter vendra create-account -- --role vendor \
  --email vendor@maple-demo.test --password 'MapleDemo123!' \
  --name "Robin Vale" --legal-name "Maple Works LLC"
```

Para probar el HITL del proveedor sin esperar 5 minutos, existe una palanca de entorno: `VENDOR_CONFIRMATION_WINDOW_MS` acorta la ventana de confirmación (y `VENDOR_SWEEP_INTERVAL_MS` acelera el barrido de vencimientos). Sin definir, se usan los valores de producción.

---

## 14. Solución de problemas

| Síntoma | Causa / arreglo |
|---|---|
| El PUT prefirmado falla desde el navegador | `S3_PUBLIC_ENDPOINT_URL` mal configurado — SigV4 firma el host, así que el endpoint de prefirma debe ser el que **el navegador** alcanza (`http://localhost:9000` en compose) |
| `/process` devuelve 503 nombrando llaves faltantes | La guardia de credenciales del harness — complete las cuatro llaves en `.env.docker` y `docker compose up -d app` |
| Documentos atascados en `PROCESSING` ~25 min y luego `FAILED` | El conserje funcionando como debe (una corrida huérfana, por ejemplo si la app se reinició). Use "Intentar de nuevo" |
| Una confirmación HITL desapareció sin que nadie contestara | Venció la ventana de 5 minutos: el sistema aplicó el criterio por defecto y siguió (*fail-open*). El resultado quedó en `document_confirmation` y en la línea de log `confirmation.expired` |
| La creación del sandbox falla con `402 payment_required` | Cuota de sandbox del equipo en Vercel — use un token con alcance de equipo en un plan pagado, u otro equipo |
| Error 4xx del modelo nombrando el modelo | La llave de Anthropic no tiene acceso a `HARNESS_MODEL` (habilitación, no credenciales). Elija un modelo que su llave pueda invocar |
| La cobertura queda "determinando" | Abra el proveedor en el panel del oficial — toda superficie del oficial dispara la determinación al verla; el portal también la dispara en su siguiente *poll* |
| Una dispensa devuelve `CONFLICT` | El seguro de concurrencia optimista: otra persona cambió el estado de esa dispensa mientras usted trabajaba. Recargue y vuelva a intentar |
| `harness: unconfigured` en `/api/health` | Faltan una o más de las cuatro llaves remotas. La app funciona igual, pero los documentos quedan en cola |

---

## Estructura del repositorio

```
apps/vendra/               la app Next.js (ambas interfaces + APIs + harness)
  src/app/                   rutas: páginas y /api
  src/server/harness/        los carriles de documento y cobertura, el sandbox
                             compartido y las ventanas HITL (confirmations.ts)
  src/server/assistant/      el asistente LLM (sesión, herramientas, memoria, prompt, store)
  src/server/trpc/           la API del oficial — las 7 mutaciones de adjudicación
  src/features/…/lib/vendor-harness-contract.ts   EL contrato compartido
  src/features/…/components/hitl-prompt.tsx       la tarjeta de confirmación del proveedor
  src/features/…/components/officer/mutation-dialogs.tsx  los diálogos de adjudicación
  src/components/ai-elements/  primitivas de render vendorizadas
packages/workflow/         motores puros (catálogo, validadores, compuerta) — sin IA, sin IO
packages/db-vendor/        el esquema Drizzle propio + migraciones commiteadas
docker-compose.yml         postgres + minio + minio-init + migrate + app
.env.docker.example        la matriz completa de variables, documentada línea por línea
```

## Licencia

MIT — vea [LICENSE](LICENSE).
