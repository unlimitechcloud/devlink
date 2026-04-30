---
inclusion: manual
---

# Local Testing — Probar DevLink en proyectos consumidores

Guía para linkear una build local de DevLink en un proyecto consumidor,
probar cambios, y luego restaurar la versión publicada.

## Cuándo usar

Activar este steering cuando:
- Se necesita probar un fix o feature de DevLink en un proyecto real antes de publicar
- Un proyecto consumidor reporta un bug y se quiere reproducir/fixear localmente
- Se quiere verificar que un cambio no rompe proyectos existentes

## Prerequisitos

- El código fuente de DevLink está en `/workspaces/devlink` (o la ruta local correspondiente)
- El proyecto consumidor tiene `@unlimitechcloud/devlink` como devDependency
- Node.js y npm instalados

## Flujo completo

### 1. Instalar dependencias de DevLink (si no están)

```bash
cd /workspaces/devlink
npm install
```

### 2. Compilar DevLink

```bash
cd /workspaces/devlink
npm run build
```

Esto ejecuta `tsc` y genera los archivos compilados en `dist/`.

### 3. Linkear en el proyecto consumidor

```bash
cd /workspaces/<proyecto>
npm link /workspaces/devlink
```

Esto crea un symlink en `node_modules/@unlimitechcloud/devlink` que apunta
al código local. El proyecto ahora usa la build local en vez de la versión de npm.

### 4. Verificar el link

```bash
ls -la node_modules/@unlimitechcloud/devlink
# Debe mostrar un symlink → /workspaces/devlink

npx dev-link --version
# Debe mostrar la versión del package.json local
```

### 5. Probar el cambio

Ejecutar el comando de DevLink que se quiere probar:

```bash
# Ejemplo: probar install con config personalizada
npx dev-link install --mode dev --config-name webforgeai.config.mjs --config-key devlink
```

### 6. Iterar (si el fix no funciona)

Si se necesitan más cambios:

```bash
# Editar el código fuente en /workspaces/devlink/src/
# Recompilar
cd /workspaces/devlink && npm run build

# El symlink apunta al mismo directorio — el proyecto consumidor
# ya usa la nueva build sin necesidad de re-linkear
```

### 7. Restaurar la versión publicada

Una vez confirmado el fix, deslinkear y reinstalar desde npm:

```bash
cd /workspaces/<proyecto>
npm unlink @unlimitechcloud/devlink
npm install @unlimitechcloud/devlink@<version> --save-dev
```

Verificar:

```bash
ls -la node_modules/@unlimitechcloud/devlink
# Debe ser un directorio regular, no un symlink

npx dev-link --version
# Debe mostrar la versión publicada
```

## Notas

- El `npm link` crea un symlink global y luego lo referencia desde el proyecto.
  Si hay problemas, usar `npm link /ruta/absoluta` que crea el link directo.
- Después de `npm link`, un `npm install` puede sobreescribir el symlink.
  Si eso pasa, re-ejecutar `npm link /workspaces/devlink`.
- Los cambios en archivos `.ts` requieren recompilar (`npm run build`).
  Los cambios en archivos `.mjs` o `.json` se reflejan inmediatamente.
- Para probar en múltiples proyectos simultáneamente, ejecutar `npm link`
  en cada proyecto — todos apuntan al mismo directorio local.
