/**
 * Consumers Command - Listar proyectos consumidores
 */

import { withStoreLock } from "../core/lock.js";
import {
  readInstallations,
  writeInstallations,
  getConsumers,
  getConsumersByNamespace,
  getAllProjects,
  getProject,
  pruneDeadProjects,
} from "../core/installations.js";
import { formatConsumersTree } from "../formatters/tree.js";
import { formatConsumersFlat } from "../formatters/flat.js";
import { createOutputRouter } from "../pipeline/output-router.js";

export interface ConsumersOptions {
  package?: string;
  namespace?: string;
  flat?: boolean;
  prune?: boolean;
}

/**
 * Get consumers info
 */
export async function getConsumersInfo(options: ConsumersOptions = {}): Promise<{
  consumers: { projectPath: string; packages: { name: string; version: string; namespace: string }[] }[];
  pruned?: string[];
}> {
  const installations = await readInstallations();
  let pruned: string[] | undefined;
  
  // Handle prune option
  if (options.prune) {
    pruned = await withStoreLock(async () => {
      const removed = await pruneDeadProjects(installations);
      if (removed.length > 0) {
        await writeInstallations(installations);
      }
      return removed;
    });
  }
  
  const consumers: { projectPath: string; packages: { name: string; version: string; namespace: string }[] }[] = [];
  
  if (options.package) {
    // Filter by package
    const packageConsumers = getConsumers(installations, options.package, {
      namespace: options.namespace,
    });
    
    for (const { projectPath, info } of packageConsumers) {
      consumers.push({
        projectPath,
        packages: [{
          name: options.package,
          version: info.version,
          namespace: info.namespace,
        }],
      });
    }
  } else if (options.namespace) {
    // Filter by namespace
    const nsConsumers = getConsumersByNamespace(installations, options.namespace);
    
    for (const { projectPath, packages } of nsConsumers) {
      consumers.push({
        projectPath,
        packages: Object.entries(packages).map(([name, info]) => ({
          name,
          version: info.version,
          namespace: info.namespace,
        })),
      });
    }
  } else {
    // All consumers
    const projects = getAllProjects(installations);
    
    for (const projectPath of projects) {
      const project = getProject(installations, projectPath);
      if (!project) continue;
      
      consumers.push({
        projectPath,
        packages: Object.entries(project.packages).map(([name, info]) => ({
          name,
          version: info.version,
          namespace: info.namespace,
        })),
      });
    }
  }
  
  return { consumers, pruned };
}

/**
 * Format consumers output
 */
export async function listConsumers(options: ConsumersOptions = {}): Promise<string> {
  const { consumers, pruned } = await getConsumersInfo(options);
  
  let output: string;
  if (options.flat) {
    output = formatConsumersFlat(consumers);
  } else {
    output = formatConsumersTree(consumers);
  }
  
  if (pruned && pruned.length > 0) {
    output += `\n\n🧹 Pruned ${pruned.length} dead project(s):\n`;
    for (const p of pruned) {
      output += `  - ${p}\n`;
    }
  }
  
  return output;
}

/**
 * CLI handler for consumers command
 */
export async function handleConsumers(args: {
  package?: string;
  namespace?: string;
  flat?: boolean;
  prune?: boolean;
  json?: boolean;
}): Promise<void> {
  const router = createOutputRouter(!!args.json);

  try {
    if (args.json) {
      const info = await getConsumersInfo(args);
      router.json(info);
    } else {
      const output = await listConsumers(args);
      router.human(output);
    }
  } catch (error: any) {
    if (args.json) {
      process.stdout.write(JSON.stringify({ error: error.message }) + "\n");
    } else {
      console.error(`✗ Consumers failed: ${error.message}`);
    }
    process.exit(1);
  }
}
