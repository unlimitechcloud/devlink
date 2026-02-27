# Documento de Diseño: devlink-monorepo-support

## Resumen

DevLink actualmente opera en un solo nivel: carga un `devlink.config.mjs`, resuelve paquetes desde el store global (`~/.devlink`), los copia/inyecta en `node_modules` o `.devlink/` local, y ejecuta `npm install`. Este modelo funciona para proyectos simples pero no soporta monorepos multinivel donde existen sub-monorepos con sus propios workspaces, paquetes aislados fuera de globs de workspace, y configuraciones DevLink independientes en distintos niveles.

Este diseño extiende DevLink con cuatro capacidades nuevas: (1) un tree scanner que descubre y clasifica la estructura completa de un monorepo recursivamente, (2) instalación multinivel que ejecuta staging en la raíz, inyecta `file:` protocols de forma persistente en TODOS los `package.json` del árbol, y ejecuta `npm install` en cada nivel, (3) deduplicación por symlinks entre stores padre-hijo para evitar copias redundantes del mismo paquete@versión, y (4) soporte para paquetes sintéticos que se resuelven al store pero no se instalan en `node_modules`. Además, el formato de configuración evoluciona para soportar el campo `synthetic` manteniendo compatibilidad con el formato actual.

El modelo de inyección es persistente: los `file:` protocols se escriben en todos los `package.json` del árbol (raíz, workspace members, sub-monorepo roots, sus workspace members) y NO se restauran después de `npm install`. Esto elimina el mecanismo anterior de backup/restore que era destructivo y causaba que npm limpiara paquetes DevLink en sub-monorepos. Para deployment, `devlink install --mode remote` reescribe los mismos campos con versiones de registry.

El diseño se origina del spec `webforgeai install`, donde se identificó que DevLink debe absorber las responsabilidades de tree scanning e instalación multinivel en lugar de reimplementarlas en el CLI de WebForge.AI. El tree scanner se expone como comando `dev-link tree` con salida JSON para consumo por herramientas externas.

## Arquitectura

```mermaid
graph TD
    CLI["dev-link CLI<br/>(Commander.js)"]
    
    CLI --> TreeCmd["dev-link tree<br/>--json --depth"]
    CLI --> InstallCmd["dev-link install<br/>--recursive --npm --mode"]
    
    TreeCmd --> Scanner["Tree Scanner<br/>(src/core/tree.ts)"]
    InstallCmd --> MultiInstaller["Multi-Level Installer<br/>(src/core/multilevel.ts)"]
    
    Scanner --> |"Lee package.json<br/>Resuelve globs"| FS["Filesystem<br/>(package.json, workspaces)"]
    Scanner --> |"Produce"| Tree["MonorepoTree<br/>(módulos, niveles, aislados)"]
    
    MultiInstaller --> |"Usa"| Tree
    MultiInstaller --> |"Nivel raíz"| SingleInstall["Install existente<br/>(src/commands/install.ts)"]
    MultiInstaller --> |"Niveles 2+"| NpmOnly["npm install<br/>(sin staging ni inyección)"]
    
    SingleInstall --> ConfigLoader["Config Loader<br/>(src/config.ts)"]
    SingleInstall --> Resolver["Resolver<br/>(src/core/resolver.ts)"]
    SingleInstall --> Staging["Staging<br/>(src/core/staging.ts)"]
    SingleInstall --> Injector["Tree-Wide Injector<br/>(src/core/injector.ts)"]
    
    Injector --> |"Inyecta file: en TODOS<br/>los package.json"| FS
    
    ConfigLoader --> |"Formato nuevo<br/>+ backward compat"| ConfigNorm["Config Normalizer"]
    
    Staging --> |"Filtra"| SyntheticFilter["Synthetic Filter<br/>(excluye de inyección)"]
    
    MultiInstaller --> |"Deduplicación"| SymlinkDedup["Symlink Deduplicator<br/>(src/core/dedup.ts)"]
    SymlinkDedup --> |"Symlink a padre"| ParentStore[".devlink/ padre"]
    SymlinkDedup --> |"Copia propia"| ChildStore[".devlink/ hijo"]
```

## Diagramas de Secuencia

### Flujo Principal: `dev-link install --recursive --npm --mode dev`

```mermaid
sequenceDiagram
    participant User
    participant CLI as dev-link install
    participant Scanner as Tree Scanner
    participant MI as Multi-Level Installer
    participant Injector as Tree-Wide Injector
    participant Install as Single Install
    participant Dedup as Symlink Dedup
    participant NPM as npm install

    User->>CLI: dev-link install --recursive --npm --mode dev
    CLI->>Scanner: scanTree(cwd)
    Scanner->>Scanner: Leer package.json (workspaces)
    Scanner->>Scanner: Resolver globs → rutas
    Scanner->>Scanner: Detectar sub-monorepos
    Scanner->>Scanner: Detectar paquetes aislados
    Scanner-->>CLI: MonorepoTree

    CLI->>MI: installMultiLevel(tree, mode, options)
    
    Note over MI: Nivel 1 — Raíz
    MI->>Install: installPackages(root, mode)
    Install->>Install: Resolver paquetes desde store
    Install->>Install: Stage a .devlink/staging/

    Note over MI: Inyección tree-wide (ANTES de npm install)
    MI->>Injector: injectTreeWide(tree, stagedPackages, registryPackages, removeNames, syntheticPackages)
    Injector->>Injector: Escanear TODOS los package.json del árbol
    Injector->>Injector: Reemplazar versiones con file: protocol (paths relativos)
    Injector->>Injector: Inyectar registry packages como versiones exactas
    Injector->>Injector: Eliminar paquetes sin versión para el modo
    Injector-->>MI: ✓ Inyección persistente completa

    MI->>NPM: npm install (raíz — procesa todo el workspace tree)
    NPM-->>MI: ✓
    Install-->>MI: ✓ Root instalado

    Note over MI: Nivel 2 — Sub-monorepos (solo npm install)
    loop Cada sub-monorepo
        MI->>Dedup: checkParentStore(pkg@ver, parentPath)
        alt Existe en padre
            Dedup->>Dedup: Crear symlink hijo → padre
            Dedup-->>MI: symlinked
        else No existe
            Dedup-->>MI: no dedup
        end
        MI->>NPM: npm install (sin staging ni inyección — ya hecho en raíz)
        NPM-->>MI: ✓
    end

    Note over MI: Nivel 3 — Paquetes aislados
    loop Cada paquete aislado
        MI->>NPM: npm install (independiente)
        NPM-->>MI: ✓
    end

    MI-->>User: ✅ Install completo (file: protocols persisten en package.json)
```

### Flujo: `dev-link tree --json`

```mermaid
sequenceDiagram
    participant User
    participant CLI as dev-link tree
    participant Scanner as Tree Scanner
    participant FS as Filesystem

    User->>CLI: dev-link tree --json
    CLI->>Scanner: scanTree(cwd)
    
    Scanner->>FS: readPackageJson(root)
    FS-->>Scanner: { workspaces: ["packages/*", ...] }
    
    Scanner->>FS: glob(workspaces)
    FS-->>Scanner: [path1, path2, ...]
    
    loop Cada workspace resuelto
        Scanner->>FS: readPackageJson(wsPath)
        FS-->>Scanner: { name, scripts, workspaces? }
        Scanner->>Scanner: classifyModule(pkg)
        
        alt Tiene workspaces propios (sub-monorepo)
            Scanner->>FS: glob(subWorkspaces)
            FS-->>Scanner: [childPath1, ...]
            Scanner->>Scanner: Escanear hijos
            Scanner->>Scanner: Detectar aislados
        end
    end
    
    Scanner-->>CLI: MonorepoTree
    CLI->>User: JSON.stringify(tree)
```

### Flujo: Deduplicación por Symlinks

```mermaid
sequenceDiagram
    participant MI as Multi-Level Installer
    participant Dedup as Symlink Dedup
    participant FS as Filesystem

    Note over MI: Nivel hijo tiene @webforgeai/sdk@0.3.0
    MI->>Dedup: deduplicatePackage("@webforgeai/sdk", "0.3.0", childPath, parentPath)
    
    Dedup->>FS: exists(parentPath/.devlink/@webforgeai/sdk/0.3.0)?
    
    alt Existe en store del padre
        FS-->>Dedup: true
        Dedup->>FS: mkdir(childPath/.devlink/@webforgeai/sdk/)
        Dedup->>FS: symlink(parentStore/sdk/0.3.0 → childStore/sdk/0.3.0)
        Dedup-->>MI: { deduplicated: true, type: "symlink" }
    else No existe en padre
        FS-->>Dedup: false
        Dedup-->>MI: { deduplicated: false }
        Note over MI: Copiar normalmente desde store global
    end
```


## Componentes e Interfaces

### Componente 1: Tree Scanner (`src/core/tree.ts`)

**Propósito**: Descubrir y clasificar la estructura completa de un monorepo recursivamente. Produce un árbol genérico (tool-agnostic) que expone scripts y metadata sin hardcodear campos específicos de SST u otras herramientas.

**Interfaz**:
```typescript
/** Tipo de módulo inferido por heurísticas */
type ModuleType = 'library' | 'infrastructure' | 'service' | 'app' | 'unknown';

/** Módulo descubierto en el monorepo */
interface MonorepoModule {
  name: string;              // nombre del package.json
  path: string;              // ruta absoluta
  relativePath: string;      // ruta relativa a la raíz del monorepo
  type: ModuleType;          // clasificación por heurísticas
  hasWorkspaces: boolean;    // tiene campo workspaces en package.json
  isIsolated: boolean;       // no pertenece a ningún workspace glob del padre
  scripts: string[];         // nombres de scripts disponibles (ej: ["build", "sst:install"])
  hasDevlinkConfig: boolean; // tiene devlink.config.mjs en su directorio
  children: MonorepoModule[];
}

/** Nivel de instalación (dónde ejecutar npm install / dev-link install) */
interface InstallLevel {
  path: string;              // ruta absoluta
  relativePath: string;      // ruta relativa a la raíz
  hasDevlinkConfig: boolean; // tiene config DevLink propia
  workspaces: string[];      // globs de workspaces del package.json
}

/** Árbol completo del monorepo */
interface MonorepoTree {
  root: string;                    // ruta absoluta de la raíz
  modules: MonorepoModule[];      // módulos de primer nivel
  installLevels: InstallLevel[];   // niveles ordenados para instalación
  isolatedPackages: string[];      // rutas absolutas de paquetes aislados
}

/** Opciones del scanner */
interface ScanOptions {
  maxDepth?: number;   // profundidad máxima de recursión (default: 3)
}

// Función principal
function scanTree(rootDir: string, options?: ScanOptions): Promise<MonorepoTree>;
```

**Responsabilidades**:
- Leer `package.json` en la raíz para obtener workspaces
- Resolver globs de workspaces a rutas concretas usando `fs.glob` (Node 22+)
- Recorrer cada workspace y detectar sub-monorepos (package.json con workspaces propios)
- Identificar paquetes aislados: directorios con `package.json` dentro de un sub-monorepo que NO están cubiertos por los globs de workspace del padre
- Clasificar módulos por tipo usando heurísticas (scripts, path patterns)
- Detectar presencia de `devlink.config.mjs` en cada nivel
- Producir niveles de instalación ordenados: raíz → sub-monorepos → aislados
- Exponer scripts genéricos (no hardcodear campos como `hasSstInstall`)

### Componente 2: Multi-Level Installer (`src/core/multilevel.ts`)

**Propósito**: Orquestar la instalación de dependencias en cada nivel del monorepo, respetando orden y fail-fast. Coordina el staging en la raíz, la inyección tree-wide de `file:` protocols en todos los `package.json` del árbol, y ejecuta `npm install` en cada nivel.

**Interfaz**:
```typescript
interface MultiLevelInstallOptions {
  tree: MonorepoTree;
  mode: string;
  runNpm: boolean;
  runScripts?: boolean;
  config?: string;       // path explícito a config (override)
}

interface LevelResult {
  path: string;
  relativePath: string;
  success: boolean;
  duration: number;
  hasDevlinkConfig: boolean;
  error?: string;
}

interface MultiLevelInstallResult {
  levels: LevelResult[];
  totalDuration: number;
  success: boolean;
}

// Función principal
async function installMultiLevel(
  options: MultiLevelInstallOptions
): Promise<MultiLevelInstallResult>;
```

**Responsabilidades**:
- Ejecutar staging y resolución de paquetes en la raíz del monorepo (nivel 1)
- Invocar `injectTreeWide()` para inyectar `file:` protocols en TODOS los `package.json` del árbol ANTES de ejecutar `npm install`
- Ejecutar UN `npm install` en la raíz que procesa todo el workspace tree
- Para cada sub-monorepo (nivel 2+): ejecutar solo `npm install` (sin staging ni inyección — ya hecho en raíz)
- Para cada paquete aislado: ejecutar `npm install` independiente
- Antes de instalar en un nivel hijo, ejecutar deduplicación por symlinks si tiene config DevLink
- NO restaurar `package.json` — los `file:` protocols persisten
- Fail-fast: si un nivel falla, no ejecutar niveles posteriores
- Reportar progreso y duración por nivel

### Componente 3: Symlink Deduplicator (`src/core/dedup.ts`)

**Propósito**: Evitar copias redundantes del mismo paquete@versión entre stores padre-hijo creando symlinks.

**Interfaz**:
```typescript
interface DeduplicationResult {
  packageName: string;
  version: string;
  deduplicated: boolean;
  type: 'symlink' | 'copy';
  sourcePath: string;    // de dónde viene (padre o store global)
  targetPath: string;    // dónde se colocó
}

interface DeduplicationOptions {
  parentStorePath: string;   // ruta al .devlink/ del padre
  childStorePath: string;    // ruta al .devlink/ del hijo
  packages: { name: string; version: string }[];
}

// Función principal
async function deduplicatePackages(
  options: DeduplicationOptions
): Promise<DeduplicationResult[]>;
```

**Responsabilidades**:
- Para cada paquete@versión declarado en el nivel hijo, verificar si existe en el store del padre
- Si existe en padre: crear symlink en `childStore/{name}/{version}` → `parentStore/{name}/{version}`
- Si no existe en padre: no deduplicar (se copiará normalmente desde el store global)
- Solo deduplicar en relación padre-hijo (no entre siblings)
- Crear directorios intermedios necesarios para scoped packages (`@scope/`)

### Componente 4: Config Normalizer (extensión de `src/config.ts`)

**Propósito**: Soportar el nuevo formato de configuración con `synthetic` y `version` anidado, manteniendo compatibilidad con el formato actual.

**Interfaz**:
```typescript
/** Formato nuevo de paquete en config */
interface PackageSpecNew {
  version: Record<string, string>;  // { dev: "0.3.0", remote: "0.3.0" }
  synthetic?: boolean;
}

/** Formato legacy (actual) */
interface PackageSpecLegacy {
  [mode: string]: string;  // { dev: "0.3.0", remote: "0.3.0" }
}

/** Formato unificado interno */
interface NormalizedPackageSpec {
  versions: Record<string, string>;
  synthetic: boolean;
}

/** Config normalizada */
interface NormalizedConfig {
  packages: Record<string, NormalizedPackageSpec>;
  modes: Record<string, ModeConfig>;
}

// Función principal
function normalizeConfig(raw: DevLinkConfig): NormalizedConfig;

// Detección de formato
function isNewFormat(spec: unknown): spec is PackageSpecNew;
function isLegacyFormat(spec: unknown): spec is PackageSpecLegacy;
```

**Responsabilidades**:
- Detectar si un paquete usa formato nuevo (`{ version: {...}, synthetic?: true }`) o legacy (`{ dev: "0.3.0" }`)
- Normalizar ambos formatos a una estructura interna unificada
- Extraer mode factories del config (propiedades que son funciones)
- Ignorar `detectMode` si existe (deprecado, modo siempre viene del CLI)
- Validar que al menos un paquete y un modo estén definidos

### Componente 5: Tree Command (`src/commands/tree.ts`)

**Propósito**: Exponer el tree scanner como comando CLI con salida humana y JSON.

**Interfaz**:
```typescript
interface TreeCommandOptions {
  json?: boolean;      // salida JSON para consumo por herramientas
  depth?: number;      // profundidad máxima de escaneo
}

// Handler del comando
async function handleTree(options: TreeCommandOptions): Promise<void>;
```

**Responsabilidades**:
- Invocar `scanTree()` desde el directorio actual
- En modo `--json`: imprimir el `MonorepoTree` como JSON a stdout
- En modo normal: imprimir árbol visual con clasificación de módulos
- Mostrar resumen: cantidad de módulos, niveles de instalación, paquetes aislados

### Componente 6: Tree-Wide Package.json Injector (`src/core/injector.ts`)

**Propósito**: Inyectar `file:` protocols de forma persistente en TODOS los `package.json` del árbol del monorepo que referencien paquetes gestionados por DevLink. Esto reemplaza el mecanismo anterior de backup/restore que solo inyectaba en el `package.json` raíz y restauraba después de `npm install`.

**Interfaz**:
```typescript
/** Resultado de inyección para un package.json individual */
interface InjectionResult {
  packageJsonPath: string;     // ruta absoluta al package.json modificado
  relativePath: string;        // ruta relativa a la raíz del monorepo
  injectedCount: number;       // cantidad de dependencias reescritas con file:
  removedCount: number;        // cantidad de dependencias eliminadas (sin versión para el modo)
  registryCount: number;       // cantidad de dependencias inyectadas desde registry
}

/** Resultado global de inyección tree-wide */
interface TreeWideInjectionResult {
  results: InjectionResult[];  // resultado por cada package.json modificado
  totalInjected: number;       // total de dependencias reescritas
  totalRemoved: number;        // total de dependencias eliminadas
  totalFiles: number;          // cantidad de package.json procesados
}

/** Opciones de inyección */
interface InjectTreeWideOptions {
  tree: MonorepoTree;
  stagedPackages: StagedPackage[];       // paquetes staged con file: protocol
  registryPackages: { name: string; version: string }[];  // paquetes de registry
  removePackageNames: string[];          // paquetes a eliminar (sin versión para el modo)
  syntheticPackages: Set<string>;        // paquetes sintéticos (excluir de inyección)
  rootDir: string;                       // raíz del monorepo (donde está .devlink/staging/)
}

// Función principal
async function injectTreeWide(
  options: InjectTreeWideOptions
): Promise<TreeWideInjectionResult>;

// Función auxiliar: recopilar todos los package.json del árbol
async function collectAllPackageJsonPaths(
  tree: MonorepoTree
): Promise<string[]>;
```

**Responsabilidades**:
- Recopilar TODOS los `package.json` del árbol: raíz, workspace members, sub-monorepo roots, sus workspace members, paquetes aislados
- Para cada `package.json`, verificar si alguna dependencia (`dependencies` o `devDependencies`) coincide con un paquete gestionado por DevLink
- Reemplazar la versión de dependencias coincidentes con `file:` protocol apuntando al staging directory, usando paths relativos desde la ubicación del `package.json`
- Inyectar paquetes de registry como versiones exactas
- Eliminar paquetes que no tienen versión para el modo actual
- Excluir paquetes sintéticos de la inyección (no se inyectan en `package.json`)
- NO crear backups — los cambios son persistentes
- Cuando se ejecuta en modo `remote` (`--mode remote`), reescribir los mismos campos con versiones de registry en lugar de `file:` protocols
- Calcular paths relativos correctos desde cada `package.json` al directorio de staging en la raíz

**Modelo de persistencia**:
- Los `file:` protocols persisten en `package.json` y se commitean a git
- Cada desarrollador ejecuta `devlink install` después de clonar — eso configura todo
- Para deployment, `devlink install --mode remote` reescribe `file:` con versiones de registry
- No existe mecanismo de backup/restore — es innecesario con este modelo

## Modelos de Datos

### Modelo 1: Formato de Configuración (nuevo con backward compat)

```typescript
// Formato NUEVO (recomendado)
const configNew = {
  packages: {
    "@webforgeai/sdk": {
      version: { dev: "0.3.0", remote: "0.3.0" },
    },
    "@webforgeai/sst": {
      version: { dev: "0.3.0", remote: "0.3.0" },
      synthetic: true,  // solo store, no node_modules
    },
  },
  // Mode factories como propiedades top-level (sin cambios)
  dev: (ctx) => ({ manager: "store", namespaces: ["global"] }),
  remote: (ctx) => ({ manager: "npm", args: ["--no-save"] }),
};

// Formato LEGACY (sigue funcionando)
const configLegacy = {
  packages: {
    "@webforgeai/sdk": { dev: "0.3.0", remote: "0.3.0" },
  },
  dev: (ctx) => ({ manager: "store", namespaces: ["global"] }),
  remote: (ctx) => ({ manager: "npm", args: ["--no-save"] }),
  detectMode: (ctx) => { /* deprecado, ignorado */ },
};
```

**Reglas de Validación**:
- `packages` es requerido y debe tener al menos un paquete
- Formato nuevo: `version` debe ser un objeto con al menos un modo
- Formato legacy: al menos una propiedad string (modo → versión)
- `synthetic` es opcional, default `false`
- Al menos una mode factory debe existir como propiedad top-level
- `detectMode` se ignora si existe (deprecado)

**Regla de Detección de Formato**:
- Si un paquete tiene propiedad `version` que es un objeto → formato nuevo
- Si un paquete tiene propiedades string directas (ej: `dev: "0.3.0"`) → formato legacy
- No se permite mezclar formatos dentro del mismo config

### Modelo 2: MonorepoTree (salida del scanner)

```typescript
// Ejemplo para el monorepo HCAMSWS
const tree: MonorepoTree = {
  root: "/path/to/mastertech.hcamsws",
  modules: [
    {
      name: "@mastertech/hcamsws.libs.core",
      path: "/path/to/packages/libs/node/core",
      relativePath: "packages/libs/node/core",
      type: "library",
      hasWorkspaces: false,
      isIsolated: false,
      scripts: ["build", "prewatch", "watch"],
      hasDevlinkConfig: false,
      children: [],
    },
    {
      name: "@mastertech/hcamsws.cloud.core",
      path: "/path/to/packages/cloud/core",
      relativePath: "packages/cloud/core",
      type: "infrastructure",
      hasWorkspaces: false,
      isIsolated: false,
      scripts: ["cloud.core", "sst:install", "sst:dev", "sst:deploy"],
      hasDevlinkConfig: false,
      children: [],
    },
    {
      name: "@mastertech/hcamsws.srv.web",
      path: "/path/to/packages/services/web",
      relativePath: "packages/services/web",
      type: "service",
      hasWorkspaces: true,
      isIsolated: false,
      scripts: ["srv.web", "build", "sst:install"],
      hasDevlinkConfig: false,
      children: [
        {
          name: "connector",
          path: "/path/to/packages/services/web/packages/connector",
          relativePath: "packages/services/web/packages/connector",
          type: "infrastructure",
          hasWorkspaces: false,
          isIsolated: false,
          scripts: ["sst:install", "sst:dev"],
          hasDevlinkConfig: false,
          children: [],
        },
        {
          name: "service",
          path: "/path/to/packages/services/web/packages/service",
          relativePath: "packages/services/web/packages/service",
          type: "service",
          hasWorkspaces: false,
          isIsolated: false,
          scripts: ["build"],
          hasDevlinkConfig: false,
          children: [],
        },
      ],
    },
    {
      name: "@mastertech/hcamsws.app.web",
      path: "/path/to/packages/apps/web",
      relativePath: "packages/apps/web",
      type: "app",
      hasWorkspaces: true,
      isIsolated: false,
      scripts: ["app.web", "build", "sst:install"],
      hasDevlinkConfig: false,
      children: [
        {
          name: "connector",
          path: "/path/to/packages/apps/web/packages/connector",
          relativePath: "packages/apps/web/packages/connector",
          type: "infrastructure",
          hasWorkspaces: false,
          isIsolated: false,
          scripts: ["sst:install"],
          hasDevlinkConfig: false,
          children: [],
        },
        {
          name: "app",
          path: "/path/to/packages/apps/web/packages/app",
          relativePath: "packages/apps/web/packages/app",
          type: "app",
          hasWorkspaces: false,
          isIsolated: true,  // NO está en workspace glob "packages/connector"
          scripts: ["build", "dev"],
          hasDevlinkConfig: false,
          children: [],
        },
      ],
    },
  ],
  installLevels: [
    {
      path: "/path/to/mastertech.hcamsws",
      relativePath: ".",
      hasDevlinkConfig: true,
      workspaces: ["packages/apps/web", "packages/cloud/*", "packages/libs/node/*", "packages/services/*"],
    },
    {
      path: "/path/to/packages/services/web",
      relativePath: "packages/services/web",
      hasDevlinkConfig: false,
      workspaces: ["packages/*"],
    },
    {
      path: "/path/to/packages/services/data",
      relativePath: "packages/services/data",
      hasDevlinkConfig: false,
      workspaces: ["packages/*"],
    },
    {
      path: "/path/to/packages/apps/web",
      relativePath: "packages/apps/web",
      hasDevlinkConfig: false,
      workspaces: ["packages/connector"],
    },
  ],
  isolatedPackages: [
    "/path/to/packages/apps/web/packages/app",
  ],
};
```

### Modelo 3: Resultado de Deduplicación

```typescript
// Ejemplo: sub-monorepo srv.web hereda @webforgeai/sdk@0.3.0 del root
const dedupResults: DeduplicationResult[] = [
  {
    packageName: "@webforgeai/sdk",
    version: "0.3.0",
    deduplicated: true,
    type: "symlink",
    sourcePath: "/root/.devlink/@webforgeai/sdk/0.3.0",
    targetPath: "/root/packages/services/web/.devlink/@webforgeai/sdk/0.3.0",
  },
  {
    packageName: "@custom/lib",
    version: "1.0.0",
    deduplicated: false,
    type: "copy",
    sourcePath: "~/.devlink/namespaces/global/@custom/lib/1.0.0",
    targetPath: "/root/packages/services/web/.devlink/@custom/lib/1.0.0",
  },
];
```

## Pseudocódigo Algorítmico

### Algoritmo: Tree Scanner

```typescript
async function scanTree(rootDir: string, options?: ScanOptions): Promise<MonorepoTree> {
  const maxDepth = options?.maxDepth ?? 3;
  const rootPkg = await readPackageJson(rootDir);
  assert(rootPkg !== null, "Root package.json must exist");

  const modules: MonorepoModule[] = [];
  const installLevels: InstallLevel[] = [];
  const isolatedPackages: string[] = [];

  // Registrar nivel raíz
  const rootWorkspaces: string[] = rootPkg.workspaces ?? [];
  const rootHasConfig = await hasDevlinkConfig(rootDir);
  installLevels.push({
    path: rootDir,
    relativePath: ".",
    hasDevlinkConfig: rootHasConfig,
    workspaces: rootWorkspaces,
  });

  // Resolver globs de workspaces a rutas concretas
  const resolvedPaths = await resolveWorkspaceGlobs(rootDir, rootWorkspaces);

  for (const wsPath of resolvedPaths) {
    const module = await scanModule(wsPath, rootDir, resolvedPaths);
    modules.push(module);

    // Si el módulo tiene workspaces propios → es sub-monorepo
    if (module.hasWorkspaces && maxDepth > 1) {
      const subPkg = await readPackageJson(wsPath);
      const subWorkspaces: string[] = subPkg.workspaces ?? [];
      const subHasConfig = await hasDevlinkConfig(wsPath);

      installLevels.push({
        path: wsPath,
        relativePath: path.relative(rootDir, wsPath),
        hasDevlinkConfig: subHasConfig,
        workspaces: subWorkspaces,
      });

      const subResolvedPaths = await resolveWorkspaceGlobs(wsPath, subWorkspaces);

      // Listar TODOS los subdirectorios con package.json
      const allSubPackages = await listSubPackages(wsPath);

      for (const childPath of allSubPackages) {
        const child = await scanModule(childPath, rootDir, subResolvedPaths);
        module.children.push(child);

        // Detectar paquete aislado
        if (!isPathInResolvedGlobs(childPath, subResolvedPaths)) {
          child.isIsolated = true;
          isolatedPackages.push(childPath);
        }
      }
    }
  }

  return { root: rootDir, modules, installLevels, isolatedPackages };
}
```

**Precondiciones:**
- `rootDir` contiene un `package.json` válido
- Los globs de workspaces son resolubles a directorios existentes
- Node.js >= 22 (para `fs.glob`)

**Postcondiciones:**
- `tree.modules` contiene todos los módulos del monorepo (sin duplicados)
- `tree.installLevels[0].path === rootDir` (raíz siempre primero)
- `tree.isolatedPackages` contiene solo paquetes que no pertenecen a ningún workspace glob
- Cada módulo tiene `type`, `scripts`, `hasDevlinkConfig` asignados

**Invariantes de Loop:**
- Cada directorio con `package.json` se escanea exactamente una vez
- Los hijos solo se escanean si el padre tiene workspaces y `depth < maxDepth`

### Algoritmo: Clasificación de Módulos

```typescript
function classifyModule(
  pkg: PackageManifest,
  modulePath: string,
  rootDir: string
): ModuleType {
  const scripts = pkg.scripts ?? {};
  const relativePath = path.relative(rootDir, modulePath);

  // Heurística 1: Scripts de infraestructura sin build → infrastructure
  if (scripts["sst:dev"] && !scripts["build"]) return "infrastructure";
  if (scripts["sst:install"] && !scripts["build"]) return "infrastructure";

  // Heurística 2: Path patterns
  if (relativePath.includes("/libs/") || relativePath.includes("/lib/")) return "library";
  if (relativePath.includes("/services/") || relativePath.includes("/service/")) return "service";
  if (relativePath.includes("/apps/") || relativePath.includes("/app/")) return "app";
  if (relativePath.includes("/cloud/") || relativePath.includes("/infra/")) return "infrastructure";

  // Heurística 3: Nombre del paquete
  if (pkg.name?.includes(".libs.") || pkg.name?.includes("-lib")) return "library";
  if (pkg.name?.includes(".srv.") || pkg.name?.includes("-service")) return "service";
  if (pkg.name?.includes(".app.") || pkg.name?.includes("-app")) return "app";

  // Heurística 4: Nombre del directorio (para hijos de sub-monorepos)
  const dirName = path.basename(modulePath);
  if (dirName === "connector") return "infrastructure";
  if (dirName === "service") return "service";
  if (dirName === "app") return "app";

  return "unknown";
}
```

**Precondiciones:**
- `pkg` es un objeto válido de `package.json`
- `modulePath` es una ruta absoluta existente

**Postcondiciones:**
- Retorna un `ModuleType` válido
- La clasificación es determinista para los mismos inputs

### Algoritmo: Detección de Paquetes Aislados

```typescript
async function listSubPackages(parentDir: string): Promise<string[]> {
  // Buscar todos los directorios inmediatos que contengan package.json
  // dentro de subdirectorios conocidos (ej: packages/)
  const results: string[] = [];
  const packagesDir = path.join(parentDir, "packages");

  try {
    const entries = await fs.readdir(packagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidatePath = path.join(packagesDir, entry.name);
      if (await fileExists(path.join(candidatePath, "package.json"))) {
        results.push(candidatePath);
      }
    }
  } catch {
    // No packages/ directory — no sub-packages
  }

  return results;
}

function isPathInResolvedGlobs(
  targetPath: string,
  resolvedPaths: string[]
): boolean {
  const normalized = path.resolve(targetPath);
  return resolvedPaths.some(p => path.resolve(p) === normalized);
}
```

**Precondiciones:**
- `parentDir` es un directorio existente (sub-monorepo)

**Postcondiciones:**
- Retorna rutas absolutas de todos los subdirectorios con `package.json`
- `isPathInResolvedGlobs` retorna `true` sii el path está en la lista de globs resueltos

### Algoritmo: Instalación Multinivel

```typescript
async function installMultiLevel(
  options: MultiLevelInstallOptions
): Promise<MultiLevelInstallResult> {
  const { tree, mode, runNpm, runScripts, config } = options;
  const results: LevelResult[] = [];
  const startTime = Date.now();

  // Fase 1: Raíz — staging + inyección tree-wide + npm install
  const rootLevel = tree.installLevels[0];
  assert(rootLevel.path === tree.root, "First level must be root");

  const rootResult = await installAtLevel(rootLevel, mode, runNpm, runScripts, config, tree);
  results.push(rootResult);
  if (!rootResult.success) {
    return { levels: results, totalDuration: Date.now() - startTime, success: false };
  }

  // Fase 2: Sub-monorepos — solo npm install (staging e inyección ya hechos en raíz)
  for (const level of tree.installLevels.slice(1)) {
    // Deduplicar paquetes del padre antes de instalar
    if (level.hasDevlinkConfig) {
      await deduplicateFromParent(tree.root, level.path, mode);
    }

    // Solo ejecutar npm install — NO staging ni inyección
    const levelResult = await runNpmAtLevel(level, runScripts);
    results.push(levelResult);
    if (!levelResult.success) {
      return { levels: results, totalDuration: Date.now() - startTime, success: false };
    }
  }

  // Fase 3: Paquetes aislados — solo npm install
  for (const isoPath of tree.isolatedPackages) {
    const isoLevel: InstallLevel = {
      path: isoPath,
      relativePath: path.relative(tree.root, isoPath),
      hasDevlinkConfig: false,
      workspaces: [],
    };

    const isoResult = await runNpmAtLevel(isoLevel, runScripts);
    results.push(isoResult);
    if (!isoResult.success) {
      return { levels: results, totalDuration: Date.now() - startTime, success: false };
    }
  }

  return { levels: results, totalDuration: Date.now() - startTime, success: true };
}

/**
 * Instalar en la raíz: staging + inyección tree-wide + npm install.
 * Solo se ejecuta para el nivel raíz (installLevels[0]).
 */
async function installAtLevel(
  level: InstallLevel,
  mode: string,
  runNpm: boolean,
  runScripts?: boolean,
  configOverride?: string,
  tree?: MonorepoTree
): Promise<LevelResult> {
  const startTime = Date.now();
  const originalCwd = process.cwd();

  try {
    process.chdir(level.path);

    try {
      if (level.hasDevlinkConfig) {
        // Tiene config DevLink → staging + inyección tree-wide + npm install
        // installPackages ahora:
        //   1. Resuelve paquetes desde store
        //   2. Stage a .devlink/staging/
        //   3. Invoca injectTreeWide() para inyectar file: en TODOS los package.json
        //   4. Ejecuta npm install
        //   5. NO restaura package.json (persistente)
        await installPackages({
          mode,
          runNpm,
          runScripts,
          config: configOverride,
          tree,  // pasar el tree para inyección tree-wide
        });
      } else if (runNpm) {
        await runNpmInstall(runScripts);
      }

      return {
        path: level.path,
        relativePath: level.relativePath,
        success: true,
        duration: Date.now() - startTime,
        hasDevlinkConfig: level.hasDevlinkConfig,
      };
    } finally {
      process.chdir(originalCwd);
    }
  } catch (error: any) {
    return {
      path: level.path,
      relativePath: level.relativePath,
      success: false,
      duration: Date.now() - startTime,
      hasDevlinkConfig: level.hasDevlinkConfig,
      error: error.message,
    };
  }
}

/**
 * Ejecutar solo npm install en un nivel (sin staging ni inyección).
 * Usado para sub-monorepos y paquetes aislados donde la inyección
 * tree-wide ya reescribió sus package.json desde la raíz.
 */
async function runNpmAtLevel(
  level: InstallLevel,
  runScripts?: boolean
): Promise<LevelResult> {
  const startTime = Date.now();
  const originalCwd = process.cwd();

  try {
    process.chdir(level.path);

    try {
      const exitCode = await runNpmInstall(runScripts);
      if (exitCode !== 0) {
        throw new Error(`npm install exited with code ${exitCode}`);
      }

      return {
        path: level.path,
        relativePath: level.relativePath,
        success: true,
        duration: Date.now() - startTime,
        hasDevlinkConfig: level.hasDevlinkConfig,
      };
    } finally {
      process.chdir(originalCwd);
    }
  } catch (error: any) {
    return {
      path: level.path,
      relativePath: level.relativePath,
      success: false,
      duration: Date.now() - startTime,
      hasDevlinkConfig: level.hasDevlinkConfig,
      error: error.message,
    };
  }
}
```

**Precondiciones:**
- `tree` es un `MonorepoTree` válido producido por `scanTree`
- `mode` es un modo válido definido en la config de la raíz
- Si `runNpm` es true, npm está disponible en PATH
- DevLink store global (`~/.devlink`) es accesible

**Postcondiciones:**
- Si `success: true`: todas las dependencias están instaladas en todos los niveles
- Los niveles se procesan en orden estricto: raíz → sub-monorepos → aislados
- Si un nivel falla, ningún nivel posterior se ejecuta (fail-fast)
- Los `file:` protocols persisten en TODOS los `package.json` del árbol (no se restauran)
- Sub-monorepos y paquetes aislados solo ejecutan `npm install` (sin staging ni inyección)
- Cada resultado incluye `duration` en milisegundos

**Invariantes de Loop:**
- Todos los niveles procesados hasta el momento fueron exitosos
- El directorio de trabajo se restaura siempre (finally)
- La inyección tree-wide se ejecuta exactamente una vez (en la raíz)

### Algoritmo: Deduplicación por Symlinks

```typescript
async function deduplicatePackages(
  options: DeduplicationOptions
): Promise<DeduplicationResult[]> {
  const { parentStorePath, childStorePath, packages } = options;
  const results: DeduplicationResult[] = [];

  for (const pkg of packages) {
    const parentPkgPath = path.join(parentStorePath, pkg.name, pkg.version);
    const childPkgPath = path.join(childStorePath, pkg.name, pkg.version);

    // Verificar si existe en el store del padre
    const existsInParent = await fileExists(path.join(parentPkgPath, "package.json"));

    if (existsInParent) {
      // Crear symlink: hijo → padre
      await fs.mkdir(path.dirname(childPkgPath), { recursive: true });
      await fs.rm(childPkgPath, { recursive: true, force: true });
      await fs.symlink(parentPkgPath, childPkgPath, "dir");

      results.push({
        packageName: pkg.name,
        version: pkg.version,
        deduplicated: true,
        type: "symlink",
        sourcePath: parentPkgPath,
        targetPath: childPkgPath,
      });
    } else {
      results.push({
        packageName: pkg.name,
        version: pkg.version,
        deduplicated: false,
        type: "copy",
        sourcePath: "",
        targetPath: childPkgPath,
      });
    }
  }

  return results;
}

async function deduplicateFromParent(
  rootDir: string,
  childDir: string,
  mode: string
): Promise<DeduplicationResult[]> {
  const childConfig = await tryLoadConfig(childDir);
  if (!childConfig) return [];

  const normalized = normalizeConfig(childConfig);
  const packages = Object.entries(normalized.packages)
    .filter(([_, spec]) => spec.versions[mode])
    .map(([name, spec]) => ({ name, version: spec.versions[mode] }));

  if (packages.length === 0) return [];

  // Buscar el store del padre más cercano (scan upward desde childDir)
  const parentStorePath = await findNearestParentStore(childDir, rootDir);
  if (!parentStorePath) return [];

  const childStorePath = path.join(childDir, ".devlink");

  return deduplicatePackages({
    parentStorePath,
    childStorePath,
    packages,
  });
}

async function findNearestParentStore(
  startDir: string,
  rootDir: string
): Promise<string | null> {
  let dir = path.dirname(startDir); // empezar desde el padre

  while (dir.length >= rootDir.length) {
    const storePath = path.join(dir, ".devlink");
    if (await directoryExists(storePath)) {
      return storePath;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}
```

**Precondiciones:**
- `parentStorePath` es una ruta a un directorio `.devlink/` existente (o inexistente)
- `childStorePath` es la ruta donde se creará el `.devlink/` del hijo
- Los paquetes tienen nombre y versión válidos

**Postcondiciones:**
- Para cada paquete que existe en el padre: se crea un symlink en el hijo
- Para cada paquete que NO existe en el padre: no se modifica nada (se copiará después)
- Los symlinks son absolutos y apuntan al directorio del paquete en el padre
- No se crean symlinks entre siblings (solo padre → hijo)

### Algoritmo: Normalización de Config (backward compat)

```typescript
function normalizeConfig(raw: DevLinkConfig): NormalizedConfig {
  const packages: Record<string, NormalizedPackageSpec> = {};

  for (const [name, spec] of Object.entries(raw.packages)) {
    if (isNewFormat(spec)) {
      // Formato nuevo: { version: { dev: "0.3.0" }, synthetic?: true }
      packages[name] = {
        versions: spec.version,
        synthetic: spec.synthetic ?? false,
      };
    } else if (isLegacyFormat(spec)) {
      // Formato legacy: { dev: "0.3.0", remote: "0.3.0" }
      packages[name] = {
        versions: { ...spec },
        synthetic: false,
      };
    } else {
      throw new Error(`Invalid package spec for "${name}": unrecognized format`);
    }
  }

  // Extraer mode factories
  const modes: Record<string, ModeConfig> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "packages" || key === "detectMode") continue;
    if (typeof value === "function") {
      // Es una mode factory — invocarla para obtener ModeConfig
      // (se invocará lazily cuando se necesite, aquí solo registramos la key)
      modes[key] = value;
    }
  }

  return { packages, modes };
}

function isNewFormat(spec: unknown): spec is PackageSpecNew {
  return (
    typeof spec === "object" &&
    spec !== null &&
    "version" in spec &&
    typeof (spec as any).version === "object" &&
    !Array.isArray((spec as any).version)
  );
}

function isLegacyFormat(spec: unknown): spec is PackageSpecLegacy {
  if (typeof spec !== "object" || spec === null) return false;
  // Legacy: todas las propiedades son strings (modo → versión)
  return Object.values(spec).every(v => typeof v === "string");
}
```

**Precondiciones:**
- `raw` es un objeto cargado desde `devlink.config.mjs`
- `raw.packages` existe y es un objeto

**Postcondiciones:**
- Todos los paquetes están normalizados al formato interno
- Formato legacy `{ dev: "0.3.0" }` produce `{ versions: { dev: "0.3.0" }, synthetic: false }`
- Formato nuevo `{ version: { dev: "0.3.0" }, synthetic: true }` produce `{ versions: { dev: "0.3.0" }, synthetic: true }`
- `detectMode` se ignora si existe

### Algoritmo: Inyección Tree-Wide de Package.json

```typescript
/**
 * Recopilar TODOS los package.json del árbol del monorepo.
 * Incluye: raíz, workspace members, sub-monorepo roots, sus workspace members, paquetes aislados.
 */
async function collectAllPackageJsonPaths(
  tree: MonorepoTree
): Promise<string[]> {
  const paths: string[] = [];

  // Raíz
  paths.push(path.join(tree.root, "package.json"));

  // Recorrer módulos recursivamente
  function collectFromModules(modules: MonorepoModule[]) {
    for (const mod of modules) {
      paths.push(path.join(mod.path, "package.json"));
      if (mod.children.length > 0) {
        collectFromModules(mod.children);
      }
    }
  }

  collectFromModules(tree.modules);
  return paths;
}

/**
 * Inyectar file: protocols de forma persistente en TODOS los package.json del árbol.
 * No crea backups — los cambios persisten en disco y se commitean a git.
 */
async function injectTreeWide(
  options: InjectTreeWideOptions
): Promise<TreeWideInjectionResult> {
  const {
    tree, stagedPackages, registryPackages,
    removePackageNames, syntheticPackages, rootDir
  } = options;

  const packageJsonPaths = await collectAllPackageJsonPaths(tree);
  const results: InjectionResult[] = [];
  let totalInjected = 0;
  let totalRemoved = 0;

  // Construir mapa de paquetes staged: nombre → stagingPath absoluto
  const stagedMap = new Map<string, string>();
  for (const pkg of stagedPackages) {
    if (syntheticPackages.has(pkg.name)) continue;  // Excluir sintéticos
    stagedMap.set(pkg.name, pkg.stagingPath);
  }

  // Construir mapa de paquetes registry: nombre → versión
  const registryMap = new Map<string, string>();
  for (const pkg of registryPackages) {
    registryMap.set(pkg.name, pkg.version);
  }

  // Construir set de paquetes a eliminar
  const removeSet = new Set(removePackageNames);

  for (const pkgJsonPath of packageJsonPaths) {
    let content: string;
    try {
      content = await fs.readFile(pkgJsonPath, "utf-8");
    } catch {
      continue;  // package.json no existe o no es legible, skip
    }

    const manifest = JSON.parse(content);
    const pkgDir = path.dirname(pkgJsonPath);
    let injected = 0;
    let removed = 0;
    let registry = 0;

    // Procesar dependencies y devDependencies
    for (const depField of ["dependencies", "devDependencies"]) {
      const deps = manifest[depField];
      if (!deps || typeof deps !== "object") continue;

      for (const depName of Object.keys(deps)) {
        // Inyectar file: protocol para paquetes staged
        if (stagedMap.has(depName)) {
          const stagingPath = stagedMap.get(depName)!;
          const relativePath = path.relative(pkgDir, stagingPath);
          deps[depName] = `file:${relativePath}`;
          injected++;
          continue;
        }

        // Inyectar versión exacta para paquetes de registry
        if (registryMap.has(depName)) {
          deps[depName] = registryMap.get(depName)!;
          registry++;
          continue;
        }

        // Eliminar paquetes sin versión para el modo actual
        if (removeSet.has(depName)) {
          delete deps[depName];
          removed++;
        }
      }
    }

    // Solo escribir si hubo cambios
    if (injected > 0 || removed > 0 || registry > 0) {
      await fs.writeFile(pkgJsonPath, JSON.stringify(manifest, null, 2) + "\n");
      totalInjected += injected;
      totalRemoved += removed;

      results.push({
        packageJsonPath: pkgJsonPath,
        relativePath: path.relative(rootDir, pkgJsonPath),
        injectedCount: injected,
        removedCount: removed,
        registryCount: registry,
      });
    }
  }

  return {
    results,
    totalInjected,
    totalRemoved,
    totalFiles: results.length,
  };
}
```

**Precondiciones:**
- `tree` es un `MonorepoTree` válido producido por `scanTree`
- `stagedPackages` contiene paquetes ya copiados a `.devlink/staging/` con paths absolutos
- `rootDir` es la raíz del monorepo donde reside `.devlink/staging/`
- Los `package.json` del árbol son legibles y escribibles

**Postcondiciones:**
- Para cada `package.json` del árbol que referencia un paquete gestionado por DevLink: el campo de versión se reescribe con `file:` protocol usando path relativo al staging
- Los paquetes sintéticos NO se inyectan en ningún `package.json`
- Los paquetes de registry se inyectan como versiones exactas
- Los paquetes sin versión para el modo actual se eliminan de `dependencies` y `devDependencies`
- Solo se escriben archivos que tuvieron cambios efectivos
- NO se crean backups — los cambios son persistentes
- Los paths relativos son correctos desde cada `package.json` individual al staging directory

**Invariantes de Loop:**
- Cada `package.json` se procesa exactamente una vez
- Los paths relativos se calculan desde el directorio del `package.json`, no desde la raíz

## Funciones Clave con Especificaciones Formales

### Función 1: `scanTree(rootDir, options?)`

```typescript
async function scanTree(rootDir: string, options?: ScanOptions): Promise<MonorepoTree>
```

**Precondiciones:**
- `rootDir` es un directorio existente con un `package.json` válido
- Si `package.json` tiene campo `workspaces`, los globs son resolubles
- Node.js >= 22 (para `fs.glob` nativo)

**Postcondiciones:**
- `tree.root === rootDir`
- `tree.installLevels[0].path === rootDir` (raíz siempre primero)
- `tree.modules` contiene exactamente un entry por cada directorio resuelto por los globs de workspaces (sin duplicados, sin omisiones)
- Para cada módulo con `hasWorkspaces: true`, `children` contiene entries para todos los sub-paquetes
- `tree.isolatedPackages` contiene exactamente los paquetes cuya ruta NO está cubierta por ningún glob de workspace de su padre
- Cada módulo tiene `type`, `scripts`, `hasDevlinkConfig` asignados correctamente
- No se modifica ningún archivo en disco

**Invariantes de Loop:**
- Cada directorio con `package.json` se escanea exactamente una vez
- La profundidad de recursión nunca excede `maxDepth`

### Función 2: `installMultiLevel(options)`

```typescript
async function installMultiLevel(options: MultiLevelInstallOptions): Promise<MultiLevelInstallResult>
```

**Precondiciones:**
- `options.tree` es un `MonorepoTree` válido producido por `scanTree`
- `options.mode` es un modo válido definido en la config de la raíz
- Si `options.runNpm` es true, npm está disponible en PATH
- DevLink store global (`~/.devlink`) es accesible

**Postcondiciones:**
- Si `result.success === true`: todas las dependencias están instaladas en todos los niveles
- Los niveles se procesan en orden estricto: raíz → sub-monorepos → aislados
- Si un nivel falla, ningún nivel posterior se ejecuta (fail-fast)
- `result.levels.length` es igual al número de niveles procesados (incluyendo el que falló)
- Cada `LevelResult` incluye `duration` en milisegundos
- El directorio de trabajo se restaura al original después de cada nivel (incluso en caso de error)
- Los `file:` protocols persisten en TODOS los `package.json` del árbol (no se restauran)
- Sub-monorepos y paquetes aislados solo ejecutan `npm install` (sin staging ni inyección)

**Invariantes de Loop:**
- Todos los niveles procesados hasta el momento fueron exitosos (excepto posiblemente el último)
- `process.cwd()` se restaura al valor original después de cada iteración
- La inyección tree-wide se ejecuta exactamente una vez (en la raíz)

### Función 3: `deduplicatePackages(options)`

```typescript
async function deduplicatePackages(options: DeduplicationOptions): Promise<DeduplicationResult[]>
```

**Precondiciones:**
- `options.parentStorePath` es una ruta a un directorio (puede no existir)
- `options.childStorePath` es la ruta donde se creará/actualizará el store del hijo
- `options.packages` contiene pares nombre-versión válidos

**Postcondiciones:**
- Para cada paquete que existe en `parentStorePath`: se crea un symlink en `childStorePath` apuntando al padre
- Para cada paquete que NO existe en `parentStorePath`: `deduplicated: false`, no se modifica nada
- Los symlinks son de tipo directorio (`"dir"`)
- Los directorios intermedios para scoped packages se crean automáticamente
- No se crean symlinks entre siblings (solo relación padre → hijo)
- Si `parentStorePath` no existe, todos los resultados son `deduplicated: false`

### Función 4: `normalizeConfig(raw)`

```typescript
function normalizeConfig(raw: DevLinkConfig): NormalizedConfig
```

**Precondiciones:**
- `raw` es un objeto cargado desde `devlink.config.mjs`
- `raw.packages` existe y es un objeto no vacío

**Postcondiciones:**
- Formato legacy `{ dev: "0.3.0" }` produce `{ versions: { dev: "0.3.0" }, synthetic: false }`
- Formato nuevo `{ version: { dev: "0.3.0" }, synthetic: true }` produce `{ versions: { dev: "0.3.0" }, synthetic: true }`
- Ambos formatos producen la misma versión resuelta para un modo dado
- `detectMode` se ignora si existe en el config original
- Lanza error si un paquete tiene formato no reconocido
- No se mezclan formatos dentro del mismo config (todos legacy o todos nuevo)

### Función 5: `handleTree(options)`

```typescript
async function handleTree(options: TreeCommandOptions): Promise<void>
```

**Precondiciones:**
- El directorio actual contiene un `package.json` (o es descendiente de uno)

**Postcondiciones:**
- Si `--json`: stdout contiene un JSON válido parseable como `MonorepoTree`
- Si no `--json`: stdout contiene representación visual del árbol con tipo y ruta de cada módulo
- stderr se usa para mensajes de error (no contamina stdout en modo JSON)

### Función 6: `injectTreeWide(options)`

```typescript
async function injectTreeWide(options: InjectTreeWideOptions): Promise<TreeWideInjectionResult>
```

**Precondiciones:**
- `options.tree` es un `MonorepoTree` válido producido por `scanTree`
- `options.stagedPackages` contiene paquetes ya copiados a `.devlink/staging/` con paths absolutos válidos
- `options.rootDir` es la raíz del monorepo donde reside `.devlink/staging/`
- Los `package.json` del árbol son legibles y escribibles

**Postcondiciones:**
- Para cada `package.json` del árbol que referencia un paquete gestionado por DevLink en `dependencies` o `devDependencies`: el campo de versión se reescribe con `file:` protocol usando path relativo al staging
- Los paquetes sintéticos NO se inyectan en ningún `package.json`
- Los paquetes de registry se inyectan como versiones exactas
- Los paquetes sin versión para el modo actual se eliminan de `dependencies` y `devDependencies`
- Solo se escriben archivos que tuvieron cambios efectivos
- NO se crean backups — los cambios son persistentes
- `result.totalFiles` es igual al número de `package.json` que fueron modificados
- Los paths relativos son correctos desde cada `package.json` individual al staging directory

## Ejemplo de Uso

```typescript
// Ejemplo 1: Escanear árbol del monorepo
// $ dev-link tree
//
// 📂 Monorepo: mastertech.hcamsws
// ├── @mastertech/hcamsws.libs.core          library        packages/libs/node/core
// ├── @mastertech/hcamsws.cloud.core         infrastructure packages/cloud/core
// ├── @mastertech/hcamsws.srv.web            service        packages/services/web
// │   ├── connector                          infrastructure   packages/connector
// │   └── service                            service          packages/service
// ├── @mastertech/hcamsws.srv.data           service        packages/services/data
// │   ├── connector                          infrastructure   packages/connector
// │   └── service                            service          packages/service
// └── @mastertech/hcamsws.app.web            app            packages/apps/web
//     ├── connector                          infrastructure   packages/connector
//     └── app                                app (isolated)   packages/app
//
// Install Levels: 4 (1 root + 3 sub-monorepos)
// Isolated Packages: 1 (packages/apps/web/packages/app)

// Ejemplo 2: Escanear en formato JSON (para consumo por webforgeai install)
// $ dev-link tree --json
// { "root": "/path/to/monorepo", "modules": [...], "installLevels": [...], ... }

// Ejemplo 3: Instalación multinivel completa
// $ dev-link install --recursive --npm --mode dev
//
// 📂 Scanning monorepo...
//   Found 4 install levels, 1 isolated package
//
// ── Level 1: . (root, devlink config: ✓) ──
//   📦 Staging 10 packages to .devlink/staging/...
//   🔗 1 synthetic package (store-only): @webforgeai/sst
//   📝 Tree-wide injection: 15 dependencies in 8 package.json files
//   ✓ npm install complete (12.3s)
//
// ── Level 2: packages/services/web (sub-monorepo) ──
//   ↳ Symlinked 3 packages from parent store
//   ✓ npm install complete (2.1s)
//
// ── Level 3: packages/services/data (sub-monorepo) ──
//   ↳ Symlinked 3 packages from parent store
//   ✓ npm install complete (1.8s)
//
// ── Level 4: packages/apps/web (sub-monorepo) ──
//   ✓ npm install complete (1.5s)
//
// ── Isolated: packages/apps/web/packages/app ──
//   ✓ npm install complete (8.7s)
//
// ✅ Install complete (26.4s)
// ℹ️  file: protocols persist in all package.json files

// Ejemplo 4: Config con paquetes sintéticos (formato nuevo)
// devlink.config.mjs
export default {
  packages: {
    "@webforgeai/sdk": {
      version: { dev: "0.3.0", remote: "0.3.0" },
    },
    "@webforgeai/sst": {
      version: { dev: "0.3.0", remote: "0.3.0" },
      synthetic: true,  // en .devlink/ pero NO en node_modules
    },
  },
  dev: (ctx) => ({ manager: "store", namespaces: ["global"] }),
  remote: (ctx) => ({ manager: "npm", args: ["--no-save"] }),
};

// Ejemplo 5: Config legacy (sigue funcionando sin cambios)
// devlink.config.mjs
export default {
  packages: {
    "@webforgeai/sdk": { dev: "0.3.0", remote: "0.3.0" },
  },
  dev: (ctx) => ({ manager: "store", namespaces: ["global"] }),
  remote: (ctx) => ({ manager: "npm", args: ["--no-save"] }),
};
```

## Correctness Properties

*Una propiedad es una característica o comportamiento que debe mantenerse verdadero en todas las ejecuciones válidas del sistema — esencialmente, una declaración formal sobre lo que el sistema debe hacer.*

### Propiedad 1: Completitud del tree scanner

*Para cualquier* monorepo con un `package.json` raíz que contenga globs de workspaces, el tree scanner debe producir una lista `modules` que contenga exactamente un entry por cada directorio resuelto por esos globs (sin duplicados, sin omisiones), y para cada módulo con workspaces propios, su lista `children` debe contener entries para todos los sub-paquetes.

**Valida: Requisitos 1.1, 1.2**

### Propiedad 2: Detección de paquetes aislados

*Para cualquier* paquete dentro de un sub-monorepo, el paquete se marca como `isIsolated: true` si y solo si su ruta NO está cubierta por ningún glob de workspace de su padre.

**Valida: Requisito 1.3**

### Propiedad 3: Orden de niveles de instalación

*Para cualquier* `MonorepoTree` producido por el scanner, `installLevels[0].path` es siempre la raíz del monorepo, los sub-monorepos vienen después, y los paquetes aislados se procesan al final. La instalación multinivel respeta este mismo orden.

**Valida: Requisitos 1.4, 2.1**

### Propiedad 4: Determinismo de clasificación de módulos

*Para cualquier* combinación de scripts, ruta y nombre de paquete, la función de clasificación debe producir siempre el mismo `ModuleType`, y el resultado debe ser uno de los tipos válidos (`library`, `infrastructure`, `service`, `app`, `unknown`).

**Valida: Requisito 1.5**

### Propiedad 5: Precisión de metadata de módulos

*Para cualquier* módulo en el tree, `hasDevlinkConfig` debe ser `true` si y solo si existe `devlink.config.mjs` en el directorio del módulo, y `scripts` debe contener exactamente los nombres de scripts del `package.json` del módulo.

**Valida: Requisitos 1.6, 1.8**

### Propiedad 6: Límite de profundidad de recursión

*Para cualquier* monorepo con profundidad mayor a `maxDepth`, el tree scanner no debe producir módulos más allá de la profundidad especificada.

**Valida: Requisito 1.7**

### Propiedad 7: Fail-fast en instalación multinivel

*Para cualquier* secuencia de niveles de instalación donde el nivel N falla, ningún nivel con índice mayor a N debe ejecutarse, y el resultado global debe indicar fallo.

**Valida: Requisito 2.4**

### Propiedad 8: Restauración del directorio de trabajo

*Para cualquier* ejecución de instalación multinivel, el directorio de trabajo debe restaurarse al valor original después de procesar cada nivel, incluso cuando un nivel falla con error.

**Valida: Requisito 2.6**

### Propiedad 9: Correctitud de deduplicación por symlinks

*Para cualquier* paquete@versión declarado en la config del hijo, si existe en el store del padre se debe crear un symlink en el store del hijo apuntando al padre; si no existe en el padre, `deduplicated` debe ser `false` y no se modifica el store del hijo.

**Valida: Requisitos 3.1, 3.2**

### Propiedad 10: Independencia entre siblings

*Para cualquier* par de sub-monorepos al mismo nivel (siblings), cada uno tiene su propia copia de paquetes en su store `.devlink/` — no se crean symlinks entre ellos.

**Valida: Requisito 3.4**

### Propiedad 11: Paquetes sintéticos excluidos de node_modules

*Para cualquier* paquete marcado con `synthetic: true` en la configuración, después de que `dev-link install` complete, el paquete debe existir en el store `.devlink/` pero NO debe estar presente en `node_modules/`.

**Valida: Requisito 4.3**

### Propiedad 12: Equivalencia de normalización entre formatos

*Para cualquier* conjunto de pares modo-versión, la normalización del formato legacy `{ dev: "0.3.0" }` y su equivalente en formato nuevo `{ version: { dev: "0.3.0" } }` deben producir la misma versión resuelta para cada modo.

**Valida: Requisitos 5.1, 5.2, 5.3**

### Propiedad 13: Rechazo de formatos inválidos y mixtos

*Para cualquier* config con un paquete en formato no reconocido, o que mezcle formato legacy y nuevo en el mismo archivo, el Config_Normalizer debe lanzar un error descriptivo.

**Valida: Requisitos 5.5, 5.6**

### Propiedad 14: Validez de salida JSON del tree

*Para cualquier* monorepo, la salida de `dev-link tree --json` debe ser un JSON válido que, al parsearse, contiene el nombre, tipo y ruta relativa de cada módulo descubierto, incluyendo hijos de sub-monorepos.

**Valida: Requisito 6.2**

### Propiedad 15: Completitud de salida visual del tree

*Para cualquier* monorepo, la salida visual de `dev-link tree` debe contener el nombre, tipo y ruta relativa de cada módulo, más un resumen con cantidad de módulos, niveles de instalación y paquetes aislados.

**Valida: Requisitos 6.1, 6.4**

### Propiedad 16: Persistencia de inyección tree-wide en package.json

*Para cualquier* paquete gestionado por DevLink que aparezca como dependencia en cualquier `package.json` del árbol (raíz, workspace members, sub-monorepo roots, sus workspace members), después de `dev-link install`, ese campo debe contener un `file:` protocol apuntando al staging directory con un path relativo válido. Los `file:` protocols NO se restauran — persisten en disco como parte del workflow gestionado.

**Valida: Requisitos 2.1, 2.2**

### Propiedad 17: Exclusión de paquetes sintéticos en inyección tree-wide

*Para cualquier* paquete marcado con `synthetic: true` en la configuración, la inyección tree-wide NO debe reescribir su versión en ningún `package.json` del árbol con `file:` protocol. El paquete debe existir en `.devlink/staging/` pero no ser inyectado.

**Valida: Requisitos 4.3**

### Propiedad 18: Correctitud de paths relativos en inyección tree-wide

*Para cualquier* `package.json` del árbol que fue inyectado con `file:` protocol, el path relativo debe resolver correctamente desde el directorio del `package.json` al directorio del paquete en `.devlink/staging/` de la raíz. Es decir, `path.resolve(pkgDir, fileProtocolPath)` debe apuntar a un directorio existente en staging.

**Valida: Requisitos 2.1**

## Manejo de Errores

### Error 1: package.json no encontrado en raíz

**Condición**: El directorio actual (o el especificado) no contiene `package.json`.
**Respuesta**: Mensaje de error indicando que se esperaba un `package.json` con campo `workspaces`.
**Recuperación**: El usuario ejecuta el comando desde la raíz del monorepo.

### Error 2: Glob de workspace no resuelve a ningún directorio

**Condición**: Un glob en `workspaces` no matchea ningún directorio existente.
**Respuesta**: Warning (no error fatal) indicando el glob que no resolvió.
**Recuperación**: El usuario verifica los globs en `package.json`.

### Error 3: Fallo de npm install en un nivel

**Condición**: `npm install` retorna exit code != 0 en algún nivel.
**Respuesta**: Mostrar el error de npm, el nivel afectado, y detener la ejecución (fail-fast). Los `file:` protocols ya inyectados persisten en los `package.json` (no se revierten).
**Recuperación**: El usuario resuelve el error de npm y re-ejecuta `devlink install`.

### Error 4: Symlink falla por permisos

**Condición**: No se puede crear symlink en el store del hijo (permisos de filesystem).
**Respuesta**: Warning y fallback a copia directa (degradación graceful).
**Recuperación**: Automática — se copia en lugar de symlink.

### Error 5: Formato de config no reconocido

**Condición**: Un paquete en la config no tiene formato legacy ni nuevo válido.
**Respuesta**: Error con el nombre del paquete y el formato encontrado.
**Recuperación**: El usuario corrige el formato en `devlink.config.mjs`.

### Error 6: Modo no definido en config

**Condición**: El modo solicitado (ej: `--mode dev`) no tiene factory en la config.
**Respuesta**: Error indicando los modos disponibles en la config.
**Recuperación**: El usuario usa un modo válido o agrega la factory al config.

### Error 7: Workspace member referencia paquete no gestionado por DevLink

**Condición**: Un `package.json` de un workspace member declara una dependencia que coincide en nombre con un paquete DevLink pero no está en la config.
**Respuesta**: No es un error — la inyección tree-wide solo procesa paquetes que están en la config de DevLink. Las dependencias no gestionadas se dejan intactas para que npm las resuelva normalmente.
**Recuperación**: N/A — comportamiento esperado.

### Error 8: Staging directory no existe cuando sub-monorepo ejecuta npm install

**Condición**: Un sub-monorepo tiene `file:` protocols en su `package.json` apuntando al staging directory de la raíz, pero el staging no existe (ej: se ejecutó `npm install` manualmente sin `devlink install` previo).
**Respuesta**: npm falla con error `ENOENT` al intentar resolver el `file:` protocol.
**Recuperación**: El usuario ejecuta `devlink install --recursive --npm` desde la raíz para regenerar el staging y re-inyectar los `file:` protocols.

### Error 9: package.json no escribible durante inyección tree-wide

**Condición**: Un `package.json` del árbol no tiene permisos de escritura.
**Respuesta**: Error indicando el path del `package.json` que no se pudo escribir.
**Recuperación**: El usuario corrige los permisos del archivo y re-ejecuta.

## Estrategia de Testing

### Unit Testing

- **Tree Scanner**: Validar descubrimiento de módulos con fixtures de monorepo mínimo, clasificación por heurísticas, detección de aislados, resolución de globs.
- **Config Normalizer**: Validar parsing de formato nuevo, formato legacy, detección de formato, rechazo de formatos inválidos, extracción de mode factories.
- **Symlink Deduplicator**: Validar creación de symlinks cuando existe en padre, no-op cuando no existe, manejo de scoped packages, fallback a copia en error.
- **Module Classifier**: Validar heurísticas de clasificación por scripts, paths, nombres.
- **Tree-Wide Injector**: Validar inyección de `file:` protocols en múltiples `package.json`, cálculo de paths relativos correctos, exclusión de paquetes sintéticos, idempotencia de inyección.

### Property-Based Testing

**Librería**: fast-check

- **Propiedad 1**: Para cualquier árbol de monorepo válido generado, `scanTree` produce un `MonorepoTree` donde `installLevels[0].path === rootDir`.
- **Propiedad 2**: Para cualquier config con formato legacy, `normalizeConfig` produce el mismo resultado que el equivalente en formato nuevo.
- **Propiedad 3**: Para cualquier conjunto de paquetes, la deduplicación nunca crea symlinks entre siblings.
- **Propiedad 4**: Para cualquier árbol de monorepo y conjunto de paquetes staged, `injectTreeWide` produce paths relativos que resuelven correctamente al staging directory desde cada `package.json`.

### Integration Testing

- Test end-to-end con fixture de monorepo mínimo que simula la estructura HCAMSWS (raíz + sub-monorepos + paquete aislado).
- Verificar que `dev-link tree --json` produce JSON parseable con todos los módulos.
- Verificar que `dev-link install --recursive` procesa niveles en orden correcto.
- Verificar que después de `devlink install`, TODOS los `package.json` del árbol que referencian paquetes DevLink tienen `file:` protocols con paths relativos válidos.
- Verificar que los `file:` protocols persisten después de la ejecución (no se restauran).
- Verificar que paquetes sintéticos están en `.devlink/` pero no en `node_modules/`.
- Verificar deduplicación: symlink existe en hijo apuntando a padre.

## Consideraciones de Rendimiento

- El tree scanner es I/O-bound (lectura de `package.json` y resolución de globs). Para monorepos con muchos paquetes, el scan es rápido porque solo lee metadata (no contenido de archivos).
- La instalación multinivel es secuencial por diseño (los niveles pueden depender de paquetes instalados en niveles anteriores). No se paraleliza.
- Los paquetes aislados podrían instalarse en paralelo en el futuro (no comparten `node_modules`), pero la implementación inicial es secuencial por simplicidad.
- La deduplicación por symlinks reduce significativamente el I/O de copia y el uso de disco en monorepos con muchos sub-monorepos que comparten paquetes.

## Consideraciones de Seguridad

- Los symlinks de deduplicación son absolutos y apuntan dentro del mismo monorepo. No se crean symlinks a rutas externas.
- El config file se carga via `import()` dinámico (ESM). Solo se cargan archivos `.mjs`/`.js`/`.cjs` del directorio del proyecto.
- La salida JSON de `dev-link tree` no incluye información sensible (solo nombres, rutas relativas, scripts).
- Los paquetes sintéticos en `.devlink/` se verifican por signature igual que los paquetes normales.

## Dependencias

| Dependencia | Propósito | Existente |
|-------------|-----------|-----------|
| Commander.js | CLI framework | ✓ |
| Vitest | Testing framework | ✓ |
| fast-check | Property-based testing | Nuevo |
| Node.js `fs.glob` | Resolución de workspace globs | ✓ (Node 22 built-in) |
| Node.js `fs`, `path` | Operaciones de filesystem | ✓ (built-in) |
| semver | Comparación de versiones | ✓ |

### Archivos Nuevos

| Archivo | Propósito |
|---------|-----------|
| `src/core/tree.ts` | Tree scanner (scanTree, classifyModule, resolveWorkspaceGlobs) |
| `src/core/multilevel.ts` | Multi-level installer (installMultiLevel, installAtLevel, runNpmAtLevel) |
| `src/core/dedup.ts` | Symlink deduplicator (deduplicatePackages, findNearestParentStore) |
| `src/core/injector.ts` | Tree-wide package.json injector (injectTreeWide, collectAllPackageJsonPaths) |
| `src/commands/tree.ts` | Tree command handler (handleTree) |

### Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `src/cli.ts` | Agregar comando `tree` y flag `--recursive` a `install` |
| `src/config.ts` | Agregar `normalizeConfig`, `isNewFormat`, `isLegacyFormat` |
| `src/types.ts` | Agregar tipos MonorepoTree, MonorepoModule, InstallLevel, InjectTreeWideOptions, TreeWideInjectionResult, InjectionResult, etc. |
| `src/core/staging.ts` | Agregar parámetro `syntheticPackages` a `stageAndRelink` |
| `src/commands/install.ts` | Eliminar `restorePackageJson`, `PackageJsonBackup`, `deduplicateWorkspaceMembers`, signal handlers de backup. Integrar `injectTreeWide` para inyección persistente tree-wide. Aceptar `tree` en `InstallOptions` para pasar al injector. Eliminar bloque `finally` que restauraba `package.json` |
| `src/commands/index.ts` | Re-exportar `handleTree` |
| `src/core/multilevel.ts` | Sub-monorepos y paquetes aislados solo ejecutan `npm install` (sin staging ni inyección). Agregar `runNpmAtLevel`. Pasar `tree` a `installPackages` en nivel raíz |
