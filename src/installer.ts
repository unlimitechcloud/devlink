/**
 * Installer - Orquesta la instalación de paquetes
 */

import { exec } from "child_process";
import { promisify } from "util";
import type {
  DevLinkConfig,
  ModeConfig,
  ResolvedPackage,
  FactoryContext,
} from "./types.js";
import { linkPackage, readLockfile, writeLockfile, removePackages, getPackageSignature } from "./store.js";

const execAsync = promisify(exec);

// Colores simples sin dependencia externa
const colors = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

/**
 * Resuelve los paquetes para el modo actual
 */
export function resolvePackages(
  config: DevLinkConfig,
  mode: string,
  modeConfig: ModeConfig
): ResolvedPackage[] {
  const packages: ResolvedPackage[] = [];

  for (const [name, versions] of Object.entries(config.packages)) {
    const version = versions[mode];
    if (!version) continue;

    packages.push({
      name,
      version,
      qname: modeConfig.manager === "store" ? name : `${name}@${version}`,
    });
  }

  return packages;
}

/**
 * Ejecuta un comando bash
 */
async function runCommand(
  command: string,
  cwd?: string
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execAsync(command, { cwd });
  } catch (error: any) {
    return { stdout: "", stderr: error.stderr || error.message };
  }
}

/**
 * Limpia paquetes existentes
 */
async function cleanup(
  packages: ResolvedPackage[],
  workingDir: string
): Promise<void> {
  console.log(`\n🧹 ${colors.cyan("Cleaning up existing packages...")}`);

  // Remover links existentes
  await removePackages({ all: true, workingDir });

  // Desinstalar paquetes de npm
  if (packages.length > 0) {
    const names = packages.map((p) => p.name).join(" ");
    try {
      await runCommand(`npm uninstall --force ${names}`, workingDir);
      console.log("   ✓ NPM packages uninstalled");
    } catch {
      console.log("   ⚠ No NPM packages to uninstall");
    }
  }
}

/**
 * Instala un paquete desde el store local
 */
async function installFromStore(
  pkg: ResolvedPackage,
  modeConfig: ModeConfig,
  workingDir: string
): Promise<{ success: boolean; signature: string }> {
  const success = await linkPackage({
    packageName: pkg.name,
    version: pkg.version,
    workingDir,
    storeFolder: modeConfig.storeFolder,
    replace: true,
  });

  let signature = "";
  if (success) {
    signature = await getPackageSignature(pkg.name, pkg.version, modeConfig.storeFolder);
    console.log(`   ✓ ${colors.green(pkg.name)}@${pkg.version}`);
  } else {
    console.log(`   ❌ ${colors.red(pkg.name)}: not found in store`);
  }

  return { success, signature };
}

/**
 * Instala un paquete desde npm
 */
async function installFromNpm(
  pkg: ResolvedPackage,
  modeConfig: ModeConfig,
  workingDir: string
): Promise<{ success: boolean; signature: string }> {
  const args = modeConfig.args?.join(" ") || "";
  const command = `npm install ${pkg.qname} ${args}`;

  const { stdout, stderr } = await runCommand(command, workingDir);

  if (stderr && !stdout && stderr.includes("error")) {
    console.log(`   ❌ ${colors.red(pkg.name)}: ${stderr.split("\n")[0]}`);
    return { success: false, signature: "" };
  }

  console.log(`   ✓ ${colors.green(pkg.name)}@${pkg.version}`);
  return { success: true, signature: `npm:${pkg.version}` };
}

/**
 * Proceso principal de instalación
 */
export async function install(
  config: DevLinkConfig,
  ctx: FactoryContext,
  mode: string,
  modeConfig: ModeConfig
): Promise<boolean> {
  const packages = resolvePackages(config, mode, modeConfig);
  const workingDir = ctx.cwd;

  console.log(`\n📦 ${colors.bold(colors.green("DevLink"))} v1.0.0`);
  console.log(`   Mode: ${colors.cyan(mode)}`);
  console.log(`   Manager: ${colors.cyan(modeConfig.manager)}`);
  console.log(`   Packages: ${packages.length}`);

  if (packages.length === 0) {
    console.log(`\n⚠️  ${colors.yellow("No packages to install for this mode")}`);
    return true;
  }

  // Listar paquetes
  console.log(`\n📋 ${colors.cyan("Packages to install:")}`);
  for (const pkg of packages) {
    console.log(`   - ${pkg.name}@${pkg.version}`);
  }

  // Cleanup
  await cleanup(packages, workingDir);

  // Hook: beforeAll
  if (modeConfig.beforeAll) {
    console.log(`\n🔧 ${colors.cyan("Running beforeAll hook...")}`);
    await modeConfig.beforeAll();
  }

  // Instalar paquetes
  console.log(`\n📥 ${colors.cyan("Installing packages...")}`);
  let allSuccess = true;
  const lockfile = await readLockfile(workingDir);

  for (const pkg of packages) {
    // Hook: beforeEach
    if (modeConfig.beforeEach) {
      await modeConfig.beforeEach(pkg);
    }

    let result: { success: boolean; signature: string };
    if (modeConfig.manager === "store") {
      result = await installFromStore(pkg, modeConfig, workingDir);
    } else {
      result = await installFromNpm(pkg, modeConfig, workingDir);
    }

    if (result.success) {
      lockfile.packages[pkg.name] = {
        version: pkg.version,
        signature: result.signature,
      };
    } else {
      allSuccess = false;
    }

    // Hook: afterEach
    if (modeConfig.afterEach) {
      await modeConfig.afterEach(pkg);
    }
  }

  // Guardar lockfile
  await writeLockfile(workingDir, lockfile);

  // Hook: afterAll
  if (modeConfig.afterAll) {
    console.log(`\n🔧 ${colors.cyan("Running afterAll hook...")}`);
    await modeConfig.afterAll();
  }

  // Resumen
  console.log(`\n${"─".repeat(50)}`);
  if (allSuccess) {
    console.log(`✅ ${colors.green("All packages installed successfully!")}`);
  } else {
    console.log(`❌ ${colors.red("Some packages failed to install")}`);
  }

  return allSuccess;
}
