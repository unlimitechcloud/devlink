/**
 * Store - Gestión del repositorio local de paquetes
 * 
 * Maneja la publicación y linkeo de paquetes locales
 */

import { createHash } from "crypto";
import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { homedir } from "os";
import type { PackageManifest, Lockfile } from "./types.js";

/** @deprecated Use StoredPackage from types.ts instead */
interface LegacyStoredPackage {
  name: string;
  version: string;
  signature: string;
  path: string;
}

const VALUES = {
  storeFolder: ".devlink",
  lockfileName: "devlink.lock",
  packagesFolder: ".devlink",
  installationsFile: "installations.json",
  signatureFile: "devlink.sig",
  ignoreFile: ".devlinkignore",
};

/**
 * Obtiene el directorio principal del store
 */
export function getStoreMainDir(customFolder?: string): string {
  if (customFolder) {
    return path.resolve(customFolder);
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "DevLink");
  }
  return path.join(homedir(), "." + VALUES.storeFolder);
}

/**
 * Obtiene el directorio de paquetes del store
 */
export function getStorePackagesDir(storeFolder?: string): string {
  return path.join(getStoreMainDir(storeFolder), "packages");
}

/**
 * Obtiene el directorio de un paquete específico en el store
 */
export function getPackageStoreDir(
  packageName: string,
  version: string = "",
  storeFolder?: string
): string {
  return path.join(getStorePackagesDir(storeFolder), packageName, version);
}

/**
 * Lee el package.json de un directorio
 */
export async function readPackageManifest(
  dir: string
): Promise<PackageManifest | null> {
  try {
    const content = await fs.readFile(path.join(dir, "package.json"), "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Escribe el package.json en un directorio
 */
export async function writePackageManifest(
  dir: string,
  manifest: PackageManifest
): Promise<void> {
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );
}

/**
 * Calcula el hash MD5 de un archivo
 */
async function getFileHash(filePath: string, relativePath: string = ""): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("md5");
    hash.update(relativePath.replace(/\\/g, "/"));
    const stream = createReadStream(filePath);
    stream.on("data", (data) => hash.update(data));
    stream.on("error", reject);
    stream.on("close", () => resolve(hash.digest("hex")));
  });
}

/**
 * Obtiene la lista de archivos a publicar (similar a npm pack)
 */
async function getFilesToPublish(dir: string): Promise<string[]> {
  const manifest = await readPackageManifest(dir);
  if (!manifest) return [];

  const files: string[] = [];
  
  // Siempre incluir package.json
  files.push("package.json");

  // Si hay campo "files", usar eso
  if (manifest.files && manifest.files.length > 0) {
    for (const pattern of manifest.files) {
      const matches = await globFiles(dir, pattern);
      files.push(...matches);
    }
  } else {
    // Si no hay "files", incluir todo excepto node_modules y archivos comunes a ignorar
    const allFiles = await walkDir(dir);
    const ignorePatterns = [
      "node_modules",
      ".git",
      ".devlink",
      "*.log",
      ".DS_Store",
    ];
    files.push(
      ...allFiles.filter(
        (f) => !ignorePatterns.some((p) => f.includes(p.replace("*", "")))
      )
    );
  }

  // Leer .devlinkignore si existe
  try {
    const ignoreContent = await fs.readFile(
      path.join(dir, VALUES.ignoreFile),
      "utf-8"
    );
    const ignoreLines = ignoreContent
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    return files.filter(
      (f) => !ignoreLines.some((pattern) => f.includes(pattern))
    );
  } catch {
    return files;
  }
}

/**
 * Glob simple para patrones de archivos
 */
async function globFiles(dir: string, pattern: string): Promise<string[]> {
  const files = await walkDir(dir);
  
  // Convertir patrón glob simple a regex
  const regexPattern = pattern
    .replace(/\./g, "\\.")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  
  const regex = new RegExp(`^${regexPattern}$`);
  return files.filter((f) => regex.test(f) || f.startsWith(pattern.replace("*", "")));
}

/**
 * Recorre un directorio recursivamente
 */
async function walkDir(dir: string, base: string = ""): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = base ? path.join(base, entry.name) : entry.name;
    
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await walkDir(path.join(dir, entry.name), relativePath)));
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

/**
 * Copia un archivo preservando la estructura de directorios
 */
async function copyFile(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

export interface PublishOptions {
  workingDir: string;
  storeFolder?: string;
  signature?: boolean;
  push?: boolean;
}

/**
 * Publica un paquete al store local
 * @deprecated Use publishPackage from commands/publish.ts instead
 */
export async function publishPackage(options: PublishOptions): Promise<LegacyStoredPackage | null> {
  const { workingDir, storeFolder } = options;
  
  const manifest = await readPackageManifest(workingDir);
  if (!manifest) {
    console.error("No package.json found in", workingDir);
    return null;
  }

  if (manifest.private && !options.signature) {
    // Permitir publicar paquetes privados al store local
  }

  const storeDir = getPackageStoreDir(manifest.name, manifest.version, storeFolder);
  
  // Limpiar directorio destino
  await fs.rm(storeDir, { recursive: true, force: true });
  await fs.mkdir(storeDir, { recursive: true });

  // Obtener archivos a copiar
  const files = await getFilesToPublish(workingDir);
  
  // Copiar archivos y calcular hashes
  const hashes: string[] = [];
  for (const file of files.sort()) {
    const srcPath = path.join(workingDir, file);
    const destPath = path.join(storeDir, file);
    await copyFile(srcPath, destPath);
    const hash = await getFileHash(srcPath, file);
    hashes.push(hash);
  }

  // Calcular signature global
  const signature = createHash("md5").update(hashes.join("")).digest("hex");

  // Escribir signature
  await fs.writeFile(path.join(storeDir, VALUES.signatureFile), signature);

  // Modificar package.json en el store (quitar devDependencies, scripts de desarrollo)
  const cleanScripts = manifest.scripts
    ? Object.fromEntries(
        Object.entries(manifest.scripts).filter(
          ([key]) => !["prepare", "prepublish", "prepublishOnly"].includes(key)
        )
      )
    : undefined;

  const storeManifest: PackageManifest = {
    ...manifest,
    devDependencies: undefined,
    scripts: cleanScripts,
  };
  await writePackageManifest(storeDir, storeManifest);

  console.log(`📦 ${manifest.name}@${manifest.version} published to store`);
  console.log(`   Signature: ${signature.substring(0, 8)}`);
  console.log(`   Files: ${files.length}`);

  return {
    name: manifest.name,
    version: manifest.version,
    signature,
    path: storeDir,
  };
}

export interface LinkOptions {
  packageName: string;
  version?: string;
  workingDir: string;
  storeFolder?: string;
  replace?: boolean;
}

/**
 * Lee la signature de un paquete en el store
 */
export async function getPackageSignature(
  packageName: string,
  version: string,
  storeFolder?: string
): Promise<string> {
  const storeDir = getPackageStoreDir(packageName, version, storeFolder);
  try {
    return await fs.readFile(path.join(storeDir, VALUES.signatureFile), "utf-8");
  } catch {
    return "";
  }
}

/**
 * Linkea un paquete del store a un proyecto
 */
export async function linkPackage(options: LinkOptions): Promise<boolean> {
  const { packageName, workingDir, storeFolder, replace } = options;
  
  // Encontrar la versión más reciente si no se especifica
  let version = options.version;
  if (!version) {
    const latestVersion = await getLatestVersion(packageName, storeFolder);
    if (!latestVersion) {
      console.error(`Package ${packageName} not found in store`);
      return false;
    }
    version = latestVersion;
  }

  const storeDir = getPackageStoreDir(packageName, version, storeFolder);
  
  // Verificar que existe
  try {
    await fs.access(storeDir);
  } catch {
    console.error(`Package ${packageName}@${version} not found in store`);
    return false;
  }

  // Directorio destino en node_modules
  const destDir = path.join(workingDir, "node_modules", packageName);

  // Crear directorio padre si es scoped package
  if (packageName.startsWith("@")) {
    await fs.mkdir(path.dirname(destDir), { recursive: true });
  }

  // Eliminar existente si replace
  if (replace) {
    await fs.rm(destDir, { recursive: true, force: true });
  }

  // Crear symlink
  try {
    await fs.rm(destDir, { recursive: true, force: true });
    await fs.symlink(storeDir, destDir, "junction");
    console.log(`🔗 ${packageName}@${version} linked to ${destDir}`);
    return true;
  } catch (error) {
    console.error(`Failed to link ${packageName}:`, error);
    return false;
  }
}

/**
 * Obtiene la versión más reciente de un paquete en el store
 */
async function getLatestVersion(
  packageName: string,
  storeFolder?: string
): Promise<string | null> {
  const packageDir = path.join(getStorePackagesDir(storeFolder), packageName);
  
  try {
    const versions = await fs.readdir(packageDir);
    if (versions.length === 0) return null;

    // Ordenar por fecha de modificación
    const versionStats = await Promise.all(
      versions.map(async (v) => ({
        version: v,
        mtime: (await fs.stat(path.join(packageDir, v))).mtime.getTime(),
      }))
    );

    versionStats.sort((a, b) => b.mtime - a.mtime);
    return versionStats[0].version;
  } catch {
    return null;
  }
}

export interface RemoveOptions {
  packageName?: string;
  all?: boolean;
  workingDir: string;
}

/**
 * Remueve paquetes linkeados de un proyecto
 */
export async function removePackages(options: RemoveOptions): Promise<void> {
  const { workingDir } = options;
  const lockfilePath = path.join(workingDir, VALUES.lockfileName);

  let lockfile: Lockfile = { packages: {} };
  try {
    const content = await fs.readFile(lockfilePath, "utf-8");
    lockfile = JSON.parse(content);
  } catch {
    // No lockfile
  }

  const packagesToRemove = options.all
    ? Object.keys(lockfile.packages)
    : options.packageName
    ? [options.packageName]
    : [];

  for (const name of packagesToRemove) {
    const destDir = path.join(workingDir, "node_modules", name);
    try {
      await fs.rm(destDir, { recursive: true, force: true });
      delete lockfile.packages[name];
      console.log(`🗑️  Removed ${name}`);
    } catch {
      // Ignore
    }
  }

  // Actualizar lockfile
  if (Object.keys(lockfile.packages).length === 0) {
    await fs.rm(lockfilePath, { force: true });
  } else {
    await fs.writeFile(lockfilePath, JSON.stringify(lockfile, null, 2));
  }
}

/**
 * Lee el lockfile de un proyecto
 */
export async function readLockfile(workingDir: string): Promise<Lockfile> {
  try {
    const content = await fs.readFile(
      path.join(workingDir, VALUES.lockfileName),
      "utf-8"
    );
    return JSON.parse(content);
  } catch {
    return { packages: {} };
  }
}

/**
 * Escribe el lockfile de un proyecto
 */
export async function writeLockfile(
  workingDir: string,
  lockfile: Lockfile
): Promise<void> {
  await fs.writeFile(
    path.join(workingDir, VALUES.lockfileName),
    JSON.stringify(lockfile, null, 2) + "\n"
  );
}
