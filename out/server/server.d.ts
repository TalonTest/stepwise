/**
 * server.ts — Stepwise LSP server
 *
 * Responsibilities:
 *  1. On startup: scan workspace Python files, invoke step_parser.py subprocess,
 *     build an in-memory index of step definitions.
 *  2. Watch for Python file changes and refresh the index.
 *  3. Provide diagnostics (warning squiggle) for unmatched Gherkin steps.
 *  4. Provide go-to-definition for step lines.
 *  5. Provide completion suggestions as the user types a step line.
 */
export {};
