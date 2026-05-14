/**
 * Pipeline Input — Reads structured JSON input for pipeline commands.
 *
 * Pipeline commands accept input from either a file path (via --plan, --stage, etc.)
 * or from stdin (piped from a previous command). This utility encapsulates that
 * dual-source reading pattern with descriptive error messages for common failures.
 */

import fs from "fs/promises";

/**
 * Reads and parses JSON input for a pipeline command.
 *
 * When `filePath` is provided, reads from that file. Otherwise, reads from stdin
 * (expecting piped JSON from a previous pipeline command).
 *
 * @param filePath - Optional path to a JSON file. If omitted, reads from stdin.
 * @returns Parsed JSON of type T
 * @throws Error with descriptive message if file doesn't exist or JSON is invalid
 */
export async function readPipelineInput<T>(filePath?: string): Promise<T> {
  const raw = filePath
    ? await readFromFile(filePath)
    : await readFromStdin();

  return parseJson<T>(raw, filePath);
}

/**
 * Reads the full contents of a file as a UTF-8 string.
 * Throws a descriptive error if the file does not exist or cannot be read.
 */
async function readFromFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error: any) {
    if (error.code === "ENOENT") {
      throw new Error(
        `Pipeline input file not found: ${filePath}`
      );
    }
    if (error.code === "EACCES") {
      throw new Error(
        `Permission denied reading pipeline input file: ${filePath}`
      );
    }
    throw new Error(
      `Failed to read pipeline input file: ${filePath} — ${error.message}`
    );
  }
}

/**
 * Reads all data from stdin until EOF.
 * Throws if stdin is a TTY (no piped data available).
 */
async function readFromStdin(): Promise<string> {
  const stdin = process.stdin;

  if (stdin.isTTY) {
    throw new Error(
      "No pipeline input provided. Provide a file path via --plan/--stage option, or pipe JSON from a previous command."
    );
  }

  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];

    stdin.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    stdin.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });

    stdin.on("error", (err) => {
      reject(new Error(`Failed to read from stdin: ${err.message}`));
    });
  });
}

/**
 * Parses a raw string as JSON with a descriptive error on failure.
 */
function parseJson<T>(raw: string, source?: string): T {
  const trimmed = raw.trim();

  if (!trimmed) {
    const location = source ? `file: ${source}` : "stdin";
    throw new Error(
      `Pipeline input is empty (source: ${location}). Expected valid JSON.`
    );
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch (error: any) {
    const location = source ? `file: ${source}` : "stdin";
    throw new Error(
      `Invalid JSON in pipeline input (source: ${location}): ${error.message}`
    );
  }
}
