# 📢 Anuncio Discord — gentle-cowork (Español)

---

## Versión corta (copiar/pegar)

> **🌹 gentle-cowork v0.1 — Orquestación multi-rol para Pi / gentle-shell**
>
> Convierte delegación aprobada por ODD en un flujo de trabajo estructurado, verificado y multi-rol.
>
> **3 roles:**
> 🧠 **Planner** (solo lectura) — descompone objetivos en planes con alcance y criterios
> 🔨 **Implementer** (escritura acotada) — ejecuta un paso del plan, devuelve resumen de artefactos
> ✅ **Verifier** (lectura + tests) — valida por requisito de especificación ODD, emite veredicto `APPROVE` / `CHANGES`
>
> **Principios:** Delegar por razón nombrada · Spec por referencia · Árbol plano · Sin artefactos SDD
>
> **Pipeline:** 3 checks obligatorios (typecheck + tests + PR-Agent con Nemotron-3-Ultra) — nada se mergea sin GREEN
>
> **🔑 Modelos/Keys:** El usuario configura sus propias keys/modelos/providers (OpenAI, Anthropic, NVIDIA, locales vía Ollama, etc.). El pipeline usa Nemotron-3-Ultra por defecto para reviews, pero el usuario elige qué modelo usar para sus agentes.
>
> 👉 **Repo:** https://github.com/ipproyectosysoluciones/gentle-cowork
> 📖 **README** tiene install, uso, arquitectura, contributing — empieza ahí.

---

## Versión visual (con rosa)

> **🌹 gentle-cowork v0.1** — *Orquestación multi-rol para Pi / gentle-shell*
>
> Convierte delegación aprobada por ODD en un flujo de trabajo estructurado, verificado y multi-rol.
>
> **3 roles:**
> 🧠 **Planner** (solo lectura) — descompone + planifica
> 🔨 **Implementer** (escritura acotada) — ejecuta un paso
> ✅ **Verifier** (lectura + tests) — veredicto por requisito de spec
>
> **Principios:** Delegar por razón nombrada · Spec por referencia · Árbol plano · Sin artefactos SDD
>
> **Pipeline:** 3 checks obligatorios (typecheck + tests + PR-Agent con Nemotron-3-Ultra) — nada se mergea sin GREEN
>
> **🔑 Modelos/Keys 100% configurables:** El usuario pone sus propias API keys (OpenAI, Anthropic, NVIDIA, locales vía Ollama, etc.) y elige qué modelo usar para cada rol. El pipeline de reviews usa Nemotron-3-Ultra por defecto, pero los agentes de usuario usan lo que el usuario configure.
>
> 👉 **Repo:** https://github.com/ipproyectosysoluciones/gentle-cowork
> 📖 **README** tiene install, uso, arquitectura, contributing — empieza ahí.