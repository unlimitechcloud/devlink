/**
 * OutputRouter — Routes command output to stdout or stderr based on --json mode.
 *
 * When jsonMode is active, only structured JSON goes to stdout (for programmatic
 * consumption), while human messages and subprocess output are routed to stderr.
 * When jsonMode is inactive, human-friendly messages go to stdout and subprocesses
 * inherit the terminal directly. Log messages always go to stderr regardless of mode.
 */

/**
 * Controls where output goes based on the --json flag.
 *
 * - `json()`: structured data → stdout (json mode) or suppressed (human mode)
 * - `human()`: progress messages → stdout (human mode) or suppressed (json mode)
 * - `log()`: auxiliary messages → always stderr
 * - `subprocessStdio()`: determines how child processes attach to the terminal
 */
export interface OutputRouter {
  /** Structured data output (stdout when --json, suppressed otherwise) */
  json(data: unknown): void;
  /** Human-friendly output (stdout when no --json, suppressed when --json) */
  human(message: string): void;
  /** Auxiliary/progress output (always stderr) */
  log(message: string): void;
  /** Subprocess stdio configuration */
  subprocessStdio(): "inherit" | "pipe";
}

/**
 * Creates an OutputRouter configured for the given mode.
 *
 * @param jsonMode - When true, structured JSON goes to stdout and human output is suppressed.
 *                   When false, human messages go to stdout and JSON output is suppressed.
 * @returns An OutputRouter that correctly routes output based on the mode.
 */
export function createOutputRouter(jsonMode: boolean): OutputRouter {
  if (jsonMode) {
    return {
      json(data: unknown): void {
        process.stdout.write(JSON.stringify(data) + "\n");
      },
      human(_message: string): void {
        // No-op: human messages are suppressed in JSON mode
      },
      log(message: string): void {
        process.stderr.write(message + "\n");
      },
      subprocessStdio(): "inherit" | "pipe" {
        return "pipe";
      },
    };
  }

  return {
    json(_data: unknown): void {
      // No-op: JSON output is suppressed in human mode
    },
    human(message: string): void {
      process.stdout.write(message + "\n");
    },
    log(message: string): void {
      process.stderr.write(message + "\n");
    },
    subprocessStdio(): "inherit" | "pipe" {
      return "inherit";
    },
  };
}
