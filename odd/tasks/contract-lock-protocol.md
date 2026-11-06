# Lock del contract store — rediseño a directorio con evidencia de reclamo

Cierra #69: la ventana de tres procesos que sobrevive al robo atómico de #65, el cleanup
vacuo de `createLock` y los `*.steal-*` sin GC. Es un cambio de protocolo, no un parche:
la liberación deja de ser "borrar el path".

## Specs

- **S1** Exclusión total. Mientras cualquier proceso esté dentro de la sección crítica,
  ningún otro proceso puede adquirir el lock — en ninguna ventana intermedia, incluida la
  de un reclamo en curso. El escenario a refutar es el que reprodujo el verificador en
  #69: _«A compared S, B removed it, C installed its lock and entered the CS, A renamed
  C's lock away, D created its lock and entered the CS»_ → C y D concurrentes.
- **S2** Ninguna transición de propiedad sobre un nombre ajeno. El lock se libera sólo si
  el `owner` publicado es propio, y ningún reclamante borra ni mueve un nombre que otro
  pueda haber creado en el mismo instante: la disputa ocurre **dentro** de un contenedor
  que nadie más puede adquirir.
- **S3** Evidencia de muerte. Un holder legible nunca se desplaza por edad: sólo `ESRCH`
  (o ilegible tras el grace) habilita un reclamo. Se conserva el comportamiento actual.
- **S4** Recuperación de un reclamante caído. Si un reclamante muere con la disputa a
  medio hacer, lo que quedó en disco es evidencia suficiente para terminar la operación:
  un token de un pid vivo se restaura (el holder sigue adentro, sin interrupción); uno de
  un pid muerto se limpia y el lock se libera.
- **S5** Compatibilidad declarada. Un `<file>.lock` que sea un archivo regular es un
  artefacto de la versión previa: se reclama con las reglas viejas (pid / grace) para no
  quedar trabado, pero una versión previa **no** puede interpretar el directorio. Durante
  el rollout todos los nodos que comparten el store se actualizan juntos; la ventana se
  documenta y el lock es efímero, así que no hay migración de datos.
- **S6** Sin huérfanos. Los artefactos de una disputa se eliminan o se restauran; no se
  acumulan archivos por cada reclamo fallido.
- **S7** Sin cambios de contrato público. `openContractStore`, `ContractStore`,
  `ContractStoreOptions` y `ContractStoreBusyError` conservan firma y mensaje; el timeout
  sigue lanzando `ContractStoreBusyError` y no escribe nada.
- **S8** El cleanup de una creación fallida no compara snapshots: libera sólo el
  directorio propio (unlink del `owner` propio + rmdir), sin tocar lo que haya tomado el
  nombre en el medio (`createLock` tomaba su snapshot después del hecho, así que su
  comparación era vacua).

## Tasks

- [x] **T1** [S1,S2,S3] Protocolo de directorio en `src/contract/store.ts`: adquisición por
  `mkdir`, `owner` propio publicado dentro, liberación por `unlink(owner)` + `rmdir`,
  reclamo por `rename(owner → taken-<uuid>)` verificado y restaurado con `link`.
  ✅ `feat(contract): hold the store lock in a directory with a contained dispute`.
- [x] **T2** [S1] RED del escenario de tres procesos, dentro del repo y determinista: en la
  ventana del reclamo, un tercer writer recibe `ContractStoreBusyError` y no escribe.
- [x] **T3** [S4,S6] Reclamante caído: `taken-*` con pid vivo se restaura; con pid muerto se
  limpia; no quedan huérfanos tras un reclamo fallido.
- [x] **T4** [S5] Archivo `.lock` previo: holder vivo → se espera; holder muerto → se reclama.
- [x] **T5** [S8] Fallo al publicar el `owner`: se libera sólo el directorio propio y no se
  desplaza a nadie. ✅ `b14f37f` + la corrección de W1 (el test que la pinnea llegó después
  de que la verificación independiente refutara la versión original).
- [x] **T6** [S7] Suite completa + typecheck + verificación independiente (item de riesgo 4) y
  revisión nativa antes de la entrega.

## Log

- **L1** Pedido del dueño, verbatim:

  > Proceder con esto
  >
  > > Lo que NO está cerrado — #69
  >
  > El verificador reprodujo de forma determinista una ventana de tres procesos: A compara
  > S, B lo remueve, C instala su lock y entra, A mueve el lock de C a un costado, D toma
  > el path liberado → C y D concurrentes. Es la misma pérdida silenciosa, en una ventana
  > de instrucciones; el código nuevo no destruye nada y el release de C ya no puede borrar
  > el lock de D, pero la exclusión no es total. Cerrarla exige tokens de generación en vez
  > de liberar borrando: es un rediseño del protocolo, no un parche, y eso es exactamente
  > lo que registra #69 junto con dos items preexistentes que encontró el verificador (el
  > cleanup de createLock con snapshot tomado después del hecho, y los *.steal-* sin GC).

  Aceptadas también sus dos advertencias: no mergear con un check pendiente (regla nueva:
  se espera el CI completo) y el registro de T6/T9/T10 en L21.

- **L2** Diseño e implementación. La raíz de los tres defectos era una sola: **liberar
  borrando**. Si el path tiene que desaparecer para que otro entre, existe una ventana en
  la que "el path no está" significa a la vez *libre* y *en transición*, y ninguna
  comparación posterior puede distinguirlas — de ahí el check-then-delete de #65, la
  carrera de restauración de #69 y el snapshot vacuamente comparado de `createLock`.
  El lock pasa a ser un **directorio**: adquirir es `mkdir(2)` (atómico, create-only) y su
  sola existencia bloquea a todos los demás writers, así que la propiedad se disputa
  **adentro** del contenedor (`owner` → `taken-<pid>-<uuid>` → verificación → `link` de
  vuelta o limpieza) y en ningún momento el nombre compartido queda libre. Un reclamante
  que muere a mitad deja la evidencia en disco (`taken-*`): el siguiente writer la lee, y
  si el token es de un pid vivo lo restaura (el holder sigue adentro sin enterarse), si es
  de uno muerto lo limpia. Los `taken-*` no se acumulan y desaparece el `*.steal-*`.
  RED del escenario del verificador, ahora dentro del repo: la sonda del tercer writer en
  la ventana del reclamo **entró** (`expected { …(4) } to be an instance of
  ContractStoreBusyError`); GREEN: `store.test.ts` 30/30 y suite 274 passed | 3 todo (277),
  `pnpm run typecheck` exit 0. Cuatro tests se reescribieron para el layout nuevo: el de
  #65 (el holder fresco vuelve byte a byte, sin `taken-*`), el de R3-003 (queda como
  recuperación de reclamante caído con holder vivo), el de liberación (un ladrón dentro de
  la sección crítica sobrevive al release ajeno) y el de #69. `createLock` ya no compara
  snapshots: si publicar el `owner` falla, se libera sólo el contenedor propio.
  **Riesgo declarado (S5):** una versión previa no puede interpretar el directorio — ve un
  path que no puede leer, y tras el grace lo mueve como si fuera un lock viejo. Durante el
  rollout, todos los nodos que comparten el store se actualizan juntos; el lock es efímero,
  así que no hay datos que migrar. El sentido inverso sí se tolera: un `<file>.lock` de
  archivo regular (artefacto previo o crash) se reclama con las reglas viejas.

  **Frontera del slice:** la unidad quedó en **732 líneas autoradas** en 5 commits (protocolo,
  tests, hardening R4-003), por encima de la norma ~400. Se entrega como **una** unidad y un
  solo PR (#71): partir el protocolo dejaría el árbol con la liberación vieja y el contenedor
  nuevo, un estado intermedio roto, y no hay un corte natural dentro de un cambio de
  protocolo. Decisión registrada acá, en el mismo commit (AGENTS.md, norma del slice).

- **L3** Revisión nativa del rediseño (`review-bd4d13b3eb483bf5`, tres lentes, 3 corridas de
  modelo): cerró **`escalated`** por causalidad desconocida, con dos CRITICAL y el resto
  advisory. El admitidor mismo las marcó `unverified_location`. Contra evidencia:
  **R4-001 es falsa** — dice que `sleepSync(LOCK_RETRY_MS)` está definido y nunca usado en
  `acquireLock`, y el sleep está en `store.ts:454`, dentro del mismo loop que la finding
  cita (443-458); además el loop previo tenía el mismo backoff, así que tampoco sería
  introducido. **R4-002** describe que un error de I/O transitorio propaga en vez de
  convertirse en `ContractStoreBusyError`: ese es exactamente el fail-closed que el módulo
  declara (un `EIO` no es "el store está ocupado, nada se escribió" — es un fallo real y
  debe verse), y el código previo ya propagaba cualquier error distinto de `EEXIST`.
  **R4-003 sí era real y se corrigió**: `viewLock` trataba cualquier fallo de `readdirSync`
  como contenedor vacío, así que un `EACCES` ocultaba los `taken-*` y podía dejar tomar un
  contenedor cuya evidencia nombraba a un holder vivo; ahora sólo `ENOENT` es "ausente" y
  cualquier otro fallo devuelve el contenedor como ilegible (se aparta, no se toca).
  **R4-004** (rmdir que traga todos los errores) y **R4-005** (grace de 30s no
  configurable, preexistente) quedan como follow-up: ninguno cambia el veredicto de
  exclusión y el contenedor sin owner lo limpia el siguiente pasada tras el grace.

- **L4** Verificación independiente (item 4) y lo que encontró. El verificador **refutó S1,
  S2 y S8** con dos interleavings demonstrables sobre procesos reales, y tenía razón: los
  dos se reducen a un solo error mío — `releaseLockContainer()` borraba el `owner` **por
  path** sin comprobar de quién era.
  **W1 (pérdida silenciosa):** un writer P hace `mkdir`, se cuelga más de 30 s antes de
  publicar su `owner`; R reclama el contenedor abandonado y entra en la sección crítica; P
  despierta, su publicación falla (`EEXIST`) y su cleanup **borra el `owner` y el
  contenedor de R**; D entra mientras R sigue adentro. R y D adentro a la vez, y la
  enmienda de D desaparece del changelog.
  **W2 (pérdida silenciosa):** un snapshot "contenedor vacío y viejo" se vuelve obsoleto
  (otro settler lo libera, un writer lo toma) y el `rmSync(ownerPath)` del release borra al
  holder nuevo.
  **W3:** un `taken-*` cuyo contenido no se puede leer quedaba invisible para el settle
  (`viewLock` lo filtraba) → el contenedor no se podía liberar nunca.
  **Corrección (una sola regla, tres aplicaciones):** la liberación de algo que **no**
  verificamos como propio pasa a ser `retireEmptyContainer()` = **sólo `rmdir`**. `rmdir`
  rechaza un contenedor donde alguien publicó, y ese rechazo es justamente el chequeo que
  un borrado por path no puede hacer. `withLock` conserva la liberación con verificación de
  token (ahí el `owner` es nuestro y la comparación precede al borrado). Además: los
  `taken-*` se listan por **nombre** y su edad sale del contenedor cuando el contenido no
  se puede leer, así que se limpian tras el grace; y un contenedor que **nosotros** acabamos
  de limpiar se retira en el acto (no puede haber nadie en la ventana de creación, porque
  publicar un owner exige que el contenedor no exista) — eso cierra el stall de 30 s de W6.
  Tres tests nuevos y deterministas: W1 (publicación que falla con un `owner` ajeno
  adentro), W2 (snapshot obsoleto con un holder fresco), W3 (`taken-*` ilegible por symlink
  colgado). GREEN: `store.test.ts` 33/33.
  **Lo que corrijo del registro anterior:** mi afirmación en L2 y en el PR ("`createLock`
  ya no compara snapshots: libera sólo el contenedor propio") era **falsa tal como estaba
  escrita** y encima T5 [S8] estaba tildada sin test que la cubriera. Ahora sí es cierta y
  está pinneada.
  **Residuales que quedan, con su clase:** W4 (un `taken-*` que nombra el pid vivo de un no
  holder queda hasta que ese proceso muera: basura, no corrupción), W5 (un "owner fantasma"
  restaurado para un proceso que ya salió de la sección crítica bloquea escrituras hasta que
  muera: disponibilidad, no pérdida), y el caveat heredado de que `process.kill(pid, 0)` sólo
  vale dentro de un mismo PID namespace. El hazard de S5 quedó **peor de lo que escribí**:
  una versión previa no pierde datos contra el directorio, pero **no puede escribir** —
  el rollout conjunto no es recomendación, es requisito operativo.

- **L5** Re-verificación independiente (item 4) tras las correcciones. **W1, W2 y W3:
  PROVEN-CLOSED** con procesos reales, y con discriminación: revirtiendo cada arreglo en una
  copia, las tres ventanas vuelven a REFUTED con la pérdida silenciosa exacta (M1 borra el
  `owner` ajeno y el tercero **entra**; M2 deja entrar al settler con snapshot viejo; M3 deja
  el contenedor trabado). Mutación de los tres tests nuevos: cada una los hace **fallar**
  (M1/M2/M3), y M4 —reabrir #69 liberando el path en la rama de mismatch— hace fallar el test
  de #69, así que tampoco es vacuo.
  **Exclusión re-corrida con procesos reales:** 8 racers × 15 rondas, detector de solapamiento
  adentro de la sección crítica → `totalEntered 120, totalOverlaps 0, lostUpdates 0,
  changelogEntries 121, finalVersion 121`; con SIGKILL de un racer en el medio →
  `survivors 7, totalEntered 105, totalOverlaps 0, lostUpdates 0`. Recuperación: holder vivo
  estacionado se restaura sin interrumpirlo, muerto se limpia, owner fantasma sin pid se
  libera tras el grace, `taken-*` de un pid vivo ajeno se respeta.
  **Auditoría de call-sites:** el único borrado de `owner` por path que queda es el release
  con verificación de token de `withLock` (único caller); `rmdir` no puede sacar un
  contenedor repoblado; `link`/`write` son create-only; `rename` verifica el inodo movido.
  Confirmado: **no queda ningún borrado por path fuera del release verificado**.
  Suite: `store.test.ts` **33/33**, `pnpm test` **277 passed | 3 todo (280)**, `typecheck`
  exit 0, repo limpio antes y después.
  **Residuales que quedan (todos de disponibilidad o basura, ninguno de pérdida, salvo el
  caveat declarado):** W5 owner fantasma restaurado para un pid vivo que ya salió de la
  sección crítica (bloquea escrituras hasta que ese proceso muera), W4 `taken-*` de un pid
  vivo no-holder (basura hasta lo mismo), el errno crudo (`ENOENT`/`EEXIST`) que puede ver un
  writer que estuvo colgado más de 30 s en la ventana de creación —donde el contrato documenta
  `ContractStoreBusyError` (desviación cosmética de S7)—, y el caveat heredado de que
  `process.kill(pid, 0)` sólo es válido dentro de un mismo PID namespace: el único camino a
  pérdida silenciosa es un despliegue multi-nodo sin namespace compartido. Los tres primeros
  quedan como follow-up en #72; el último está declarado como límite de alcance (S5).
  **Veredicto:** `Risk: item 4` con W1/W2/W3 cerradas y verificadas; los residuales no
  bloquean la entrega.
