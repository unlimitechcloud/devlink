# Tareas: Proxy Registry para DevLink

## Task 1: Agregar "proxy" a ModeConfig.manager
- [x] Modificar `src/types.ts`: cambiar `manager: "store" | "npm"` a `manager: "store" | "npm" | "proxy"`
- [x] Verificar que no hay validaciones hardcodeadas que rechacen "proxy"

## Task 2: Implementar project-lock (src/proxy/project-lock.ts)
- [x] Crear `src/proxy/project-lock.ts`
- [x] Implementar `ProjectLockInfo` interface (pid, port, acquired, command)
- [x] Implementar `acquireProjectLock(projectPath)` — crea `.devlink.pid` con O_CREAT|O_EXCL
- [x] Implementar detección de stale locks (PID muerto → re-adquirir)
- [x] Implementar `releaseProjectLock(handle)` — elimina `.devlink.pid`
- [x] Implementar `isProjectLocked(projectPath)` — lectura no-bloqueante
- [x] Tests: adquirir/liberar lock, detección de stale, concurrencia rechazada

## Task 3: Implementar tarball generator (src/proxy/tarball.ts)
- [x] Crear `src/proxy/tarball.ts`
- [x] Implementar `createTarball(packagePath, destDir)` — genera .tgz desde directorio del store
- [x] Seguir convención npm para nombre: `{scope}-{name}-{version}.tgz`
- [x] Cache: no regenerar si ya existe en destDir
- [x] Tests: generar tarball desde fixture, verificar contenido, verificar cache

## Task 4: Implementar npm-delegate (src/proxy/npm-delegate.ts)
- [x] Crear `src/proxy/npm-delegate.ts`
- [x] Implementar `npmViewMeta(name, homeNpmrc, workDir)` — ejecuta `npm view --json --userconfig`
- [x] Implementar `npmPackTarball(name, version, homeNpmrc, workDir)` — ejecuta `npm pack --userconfig`
- [x] Cache en memoria (Map) para metadata y tarballs
- [x] Reescritura de tarball URLs en metadata para apuntar al proxy local
- [x] Tests: mock de execSync para verificar comandos generados, parseo de respuestas

## Task 5: Implementar npmrc manager (src/proxy/npmrc.ts)
- [x] Crear `src/proxy/npmrc.ts`
- [x] Implementar `writeProxyNpmrc(projectPath, port)` — backup + escribir registry local
- [x] Implementar `restoreNpmrc(backup)` — restaurar original o eliminar
- [x] Idempotencia: restaurar múltiples veces no falla
- [x] Tests: backup/restore con .npmrc existente, backup/restore sin .npmrc previo

## Task 6: Implementar proxy server (src/proxy/server.ts)
- [x] Crear `src/proxy/server.ts`
- [x] Implementar servidor HTTP que escucha en puerto configurado
- [x] Endpoint `/__devlink__/health` → `{ ok: true, pid, port, devlink: true }`
- [x] Endpoint metadata: `GET /<pkg>` → JSON con metadata npm registry format
- [x] Endpoint tarball: `GET /<pkg>/-/<file>.tgz` → binario
- [x] Resolución: store local primero, luego npm-delegate
- [x] Comunicación con padre via IPC (recibe config, envía "ready")
- [x] npm install se ejecuta con `--no-audit` (audit no funciona contra proxy local)
- [x] Tests: levantar servidor, verificar health, servir paquete local, servir paquete externo (mock)

## Task 7: Implementar proxy lifecycle (src/proxy/lifecycle.ts)
- [x] Crear `src/proxy/lifecycle.ts`
- [x] Implementar `findFreePort()` — usa `net.createServer().listen(0)`
- [x] Implementar `startProxy(config)` — fork server.ts, enviar config via IPC, esperar "ready"
- [x] Implementar `stopProxy(handle)` — SIGTERM, timeout, SIGKILL si necesario
- [x] Implementar `waitForProxy(port, timeout)` — HTTP GET a health endpoint con retry
- [x] Tests: start/stop lifecycle, health check, timeout handling

## Task 8: Integrar flujo proxy en install.ts
- [x] Agregar branch `manager === "proxy"` en `installPackages()`
- [x] Flujo: lock → workDir → port → proxy → npmrc → npm install → cleanup
- [x] npm install resuelve TODO via proxy (no hay copia manual a node_modules)
- [x] El flag `--npm` no tiene efecto con `manager: "proxy"` (npm install es inherente)
- [x] `peerOptional` no aplica con proxy (npm resuelve transitivas correctamente)
- [x] Signal handlers (SIGINT/SIGTERM) para cleanup robusto
- [x] Cleanup idempotente en finally blocks
- [x] Registrar proyecto en installations.json + escribir devlink.lock (para tracking/push)
- [x] Mantener compatibilidad total con `manager: "store"` y `manager: "npm"`

## Task 9: Crear fixtures para tests del proxy
- [x] Crear `fixtures/packages/@test/with-deps/` — paquete con dependencies externas (ej: lodash)
- [x] Crear `fixtures/packages/@test/with-internal-deps/` — paquete con deps internas (@test/sample-lib)
- [x] Crear `fixtures/proxy-project/` — proyecto consumidor con devlink.config.mjs y package.json

## Task 10: Tests de integración del proxy
- [x] Test: project lock previene ejecución concurrente
- [x] Test: stale lock se re-adquiere correctamente
- [x] Test: cleanup en terminación normal
- [x] Test: .npmrc se restaura correctamente después de install
- [x] Test: paquetes del store se sirven correctamente via proxy
- [x] Test: paquetes externos se delegan a npm CLI
