# Diseño: Proxy Registry para DevLink

## Arquitectura

```
devlink install --dev (manager: "proxy")
        │
        ▼
┌─────────────────────────────────────────────────┐
│              install.ts (flujo proxy)            │
│                                                   │
│  1. Adquirir project lock (.devlink.pid)         │
│  2. Encontrar puerto libre                        │
│  3. Fork proxy server (child process)            │
│  4. Escribir .npmrc → registry=localhost:{port}  │
│  5. npm install (todo va por el proxy)           │
│     npm resuelve TODO: store pkgs + transitivas  │
│  6. Matar proxy                                   │
│  7. Restaurar .npmrc                              │
│  8. Liberar lock + cleanup                        │
└─────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────┐
│              proxy/server.ts                      │
│                                                   │
│  HTTP Server en puerto aleatorio                  │
│                                                   │
│  GET /__devlink__/health → { ok, pid, port }     │
│                                                   │
│  GET /@scope/pkg (metadata)                       │
│    ├─ En store? → Generar metadata + tarball URL │
│    └─ No? → npm view + rewrite tarball URL       │
│                                                   │
│  GET /@scope/pkg/-/file.tgz (tarball)            │
│    ├─ En store? → Servir .tgz generado           │
│    └─ No? → npm pack + servir resultado          │
│                                                   │
│  (audit deshabilitado via --no-audit en npm)      │
└─────────────────────────────────────────────────┘
```

## Nuevos Archivos

```
src/
├── proxy/
│   ├── server.ts        # Servidor HTTP proxy (se ejecuta como child process)
│   ├── lifecycle.ts     # Start/stop/health del proxy
│   ├── npmrc.ts         # Generación y restauración de .npmrc
│   ├── project-lock.ts  # Lock a nivel de proyecto (.devlink.pid)
│   ├── tarball.ts       # Generación de tarballs desde el store
│   └── npm-delegate.ts  # Delegación a npm CLI para paquetes externos
└── __tests__/
    └── proxy.spec.ts    # Tests del proxy
```

## Archivos Modificados

```
src/
├── types.ts             # Agregar "proxy" a ModeConfig.manager
└── commands/
    └── install.ts       # Agregar flujo proxy cuando manager === "proxy"
```

## Diseño Detallado

### 1. types.ts — Cambio en ModeConfig

```typescript
export interface ModeConfig {
  manager: "store" | "npm" | "proxy";  // Agregar "proxy"
  // ... resto igual
}
```

### 2. proxy/project-lock.ts — Lock de Proyecto

```typescript
interface ProjectLockInfo {
  pid: number;
  port: number;
  acquired: string;
  command: string;
}

// Archivo: .devlink.pid en el directorio del proyecto
// Detección de stale: process.kill(pid, 0) — si falla, el lock es stale
// Formato: JSON con pid, port, acquired, command

export async function acquireProjectLock(projectPath: string): Promise<ProjectLockHandle>;
export async function releaseProjectLock(handle: ProjectLockHandle): Promise<void>;
export async function isProjectLocked(projectPath: string): Promise<boolean>;
```

Flujo:
1. Intentar crear `.devlink.pid` con `O_CREAT | O_EXCL`
2. Si existe, leer PID y verificar si está vivo con `process.kill(pid, 0)`
3. Si el PID está muerto → lock stale → eliminar y re-adquirir
4. Si el PID está vivo → error "Another devlink is running on this project"

### 3. proxy/server.ts — Servidor Proxy

El servidor se ejecuta como proceso hijo (fork). Recibe configuración via IPC message del padre.

```typescript
// Mensaje de inicialización del padre
interface ProxyConfig {
  port: number;
  storePath: string;
  namespaces: string[];
  packages: Record<string, string>;  // name → version
  workDir: string;                    // Carpeta temporal para tarballs
  homeNpmrc: string;                  // Path al .npmrc del usuario
}
```

Endpoints:
- `GET /__devlink__/health` → `{ ok: true, pid, port, devlink: true }`
- `GET /<package-name>` → Metadata JSON (npm registry format)
- `GET /<package-name>/-/<filename>.tgz` → Tarball binario
- Todo lo demás → 404

Nota: `npm install` se ejecuta con `--no-audit` para evitar que npm intente auditar contra el proxy local. Los paquetes del store no están en el registry real, así que el audit daría resultados incompletos. El usuario puede correr `npm audit` manualmente después si lo necesita.

Resolución de metadata:
1. Verificar si el paquete está en la lista de paquetes configurados
2. Si sí → leer `package.json` del store, generar metadata con tarball URL local
3. Si no → ejecutar `npm view <pkg> --json --userconfig ~/.npmrc`, reescribir tarball URLs

Resolución de tarballs:
1. Si es paquete local → generar `.tgz` desde el store con `tar.create()` (nativo)
2. Si es paquete externo → ejecutar `npm pack <pkg> --userconfig ~/.npmrc`

### 4. proxy/lifecycle.ts — Ciclo de Vida

```typescript
export async function startProxy(config: ProxyConfig): Promise<ProxyHandle>;
export async function stopProxy(handle: ProxyHandle): Promise<void>;
export async function waitForProxy(port: number, timeout?: number): Promise<boolean>;
```

Flujo de `startProxy`:
1. Fork `proxy/server.ts` como child process (detached: false)
2. Enviar config via IPC message
3. Esperar mensaje "ready" del hijo (con timeout)
4. Retornar handle con `{ process, port, pid }`

Flujo de `stopProxy`:
1. Enviar SIGTERM al proceso hijo
2. Esperar que termine (con timeout)
3. Si no termina, SIGKILL

`waitForProxy`: HTTP GET a `/__devlink__/health`, reintentar con backoff hasta timeout.

### 5. proxy/npmrc.ts — Gestión de .npmrc

```typescript
export async function writeProxyNpmrc(projectPath: string, port: number): Promise<NpmrcBackup>;
export async function restoreNpmrc(backup: NpmrcBackup): Promise<void>;
```

- Backup: si existe `.npmrc`, leer contenido y guardarlo en memoria
- Escribir: `registry=http://localhost:{port}\n`
- Restaurar: si había backup, escribir contenido original; si no, eliminar `.npmrc`

### 6. proxy/tarball.ts — Generación de Tarballs

```typescript
export async function createTarball(packagePath: string, destDir: string): Promise<string>;
```

- Lee `package.json` del store para obtener nombre y versión
- Usa `child_process.execSync('tar czf ...')` para crear el `.tgz`
- El tarball sigue la convención npm: `{name}-{version}.tgz` (con scope normalizado)
- Cache: si el tarball ya existe en `destDir`, no lo regenera

### 7. proxy/npm-delegate.ts — Delegación a npm CLI

```typescript
export async function npmViewMeta(name: string, homeNpmrc: string, workDir: string): Promise<NpmMeta | null>;
export async function npmPackTarball(name: string, version: string, homeNpmrc: string, workDir: string): Promise<string | null>;
```

- `npmViewMeta`: ejecuta `npm view <pkg> --json --userconfig <homeNpmrc>` y parsea resultado
- `npmPackTarball`: ejecuta `npm pack <pkg>@<version> --pack-destination <workDir> --userconfig <homeNpmrc>`
- Cache en memoria (Map) para ambas operaciones durante la vida del proxy

### 8. commands/install.ts — Flujo Proxy

Nuevo branch en `installPackages()` cuando `modeConfig.manager === "proxy"`.

Con `manager: "proxy"`, npm hace todo el trabajo de instalación. El proxy le sirve los paquetes del store como si fueran de un registry normal, y npm los instala incluyendo todas las transitivas. No hay paso de "copiar del store a node_modules" — npm ya lo hizo.

El flag `--npm` no tiene efecto con `manager: "proxy"` porque el `npm install` es inherente al flujo.

```typescript
if (modeConfig.manager === "proxy") {
  // 1. Adquirir project lock
  const lock = await acquireProjectLock(projectPath);
  
  try {
    // 2. Crear carpeta temporal
    const workDir = await createWorkDir(storePath);
    
    // 3. Encontrar puerto libre
    const port = await findFreePort();
    
    // 4. Levantar proxy
    const proxy = await startProxy({ port, storePath, namespaces, packages, workDir, homeNpmrc });
    
    // 5. Escribir .npmrc
    const npmrcBackup = await writeProxyNpmrc(projectPath, port);
    
    try {
      // 6. npm install — npm resuelve TODO a través del proxy:
      //    - Paquetes del store (servidos localmente)
      //    - Transitivas de esos paquetes (delegadas a npm CLI)
      //    - Paquetes normales del package.json (delegados a npm CLI)
      await runNpmInstall(options.runScripts);
    } finally {
      // 7. Restaurar .npmrc
      await restoreNpmrc(npmrcBackup);
      
      // 8. Matar proxy
      await stopProxy(proxy);
      
      // 9. Cleanup workDir
      await cleanupWorkDir(workDir);
    }
  } finally {
    // 10. Liberar lock
    await releaseProjectLock(lock);
  }
  
  // Registrar proyecto en installations + escribir devlink.lock
  // (para tracking y push, igual que con manager: "store")
}
```

### 9. Signal Handlers

En el flujo proxy de `install.ts`, registrar handlers para SIGINT/SIGTERM que ejecuten el cleanup:

```typescript
const cleanup = async () => {
  await restoreNpmrc(npmrcBackup);
  await stopProxy(proxy);
  await cleanupWorkDir(workDir);
  await releaseProjectLock(lock);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
```

## Flujo de Datos

```
npm install
    │
    ▼
npm → GET http://localhost:{port}/@webforgeai/ioc
    │
    ▼
proxy: ¿@webforgeai/ioc está en el store?
    ├─ SÍ → Leer package.json del store
    │        Generar metadata con tarball URL local
    │        Retornar JSON
    │
    └─ NO → npm view @webforgeai/ioc --json --userconfig ~/.npmrc
             Reescribir tarball URLs a localhost
             Retornar JSON
    │
    ▼
npm → GET http://localhost:{port}/@webforgeai/ioc/-/ioc-0.1.0.tgz
    │
    ▼
proxy: ¿tarball local?
    ├─ SÍ → tar czf desde store → servir
    └─ NO → npm pack → servir
    │
    ▼
npm resuelve transitivas de @webforgeai/ioc (ej: reflect-metadata)
    │
    ▼
npm → GET http://localhost:{port}/reflect-metadata
    │
    ▼
proxy: no está en store → npm view → npm pack → servir
```

## Formato del .devlink.pid

```json
{
  "pid": 12345,
  "port": 48291,
  "acquired": "2026-02-24T10:00:00.000Z",
  "command": "install --dev --npm"
}
```

## Formato del .npmrc generado

```
registry=http://localhost:48291
```

## Consideraciones

1. El proxy NO modifica el store — es read-only respecto al store
2. El proxy NO necesita lock del store — solo lee
3. El lock de proyecto es independiente del lock del store
4. Con `manager: "proxy"`, npm hace toda la instalación — no hay paso de copia manual a `node_modules/`
5. `peerOptional` no es necesario con `manager: "proxy"` — npm resuelve las transitivas correctamente via el proxy
6. El flag `--npm` no tiene efecto con `manager: "proxy"` — el `npm install` es inherente al flujo
7. El puerto se busca con `net.createServer().listen(0)` para obtener uno aleatorio del OS
8. DevLink aún registra el proyecto en `installations.json` y escribe `devlink.lock` para tracking y `push`
