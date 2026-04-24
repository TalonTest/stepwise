/**
 * Gherkin feature file formatter.
 *
 * Indentation rules (2-space default, configurable via tabSize):
 *   0×  Feature:, Rule:
 *   1×  Background:, Scenario:, Scenario Outline:, Scenario Template:, Example:
 *   2×  Given/When/Then/And/But steps, Examples:, Scenarios:
 *   3×  Table rows (| … |), doc-string delimiters (""" / ```)
 *
 * Tags and comments inherit the indent of the next anchor line.
 * Table columns are padded so all pipes align.
 * Multiple consecutive blank lines are collapsed to one.
 * Doc-string content is passed through verbatim (only delimiters are re-indented).
 */
export declare function formatDocument(text: string, tabSize: number, insertSpaces: boolean): string;
