/**
 * stepMatcher.ts
 *
 * Utilities for:
 *  - Converting pytest-bdd step patterns (which use {param} / {param:type} syntax)
 *    into JavaScript RegExp objects.
 *  - Matching a step text string against a list of known StepDefinitions.
 *  - Parsing a Gherkin step line into its keyword + text parts.
 */
export interface StepDefinition {
    /** The raw pattern string as extracted from source (e.g. "I have {count:d} cucumbers") */
    pattern: string;
    /** Absolute path to the Python file that contains this step */
    file: string;
    /** 1-based line number of the decorated function */
    line: number;
    /** The decorator name: "given" | "when" | "then" */
    decorator: string;
}
/**
 * Convert a pytest-bdd step pattern string into a compiled RegExp.
 *
 * Supported placeholder forms:
 *   {name}       → (.+)      (any text, greedy)
 *   {name:d}     → (\d+)
 *   {name:f}     → float regex
 *   {name:w}     → (\w+)
 *   {name:g}     → general number
 *   … (see FORMAT_MAP for the full list)
 *
 * The resulting regex is anchored (^ … $) and case-insensitive.
 */
export declare function patternToRegex(pattern: string): RegExp;
/**
 * Try to match `stepText` (the part of the Gherkin line after the keyword)
 * against every StepDefinition.  Returns the first match or undefined.
 */
export declare function matchStep(stepText: string, definitions: StepDefinition[]): StepDefinition | undefined;
export interface ParsedStep {
    /** The raw keyword as it appears in the source (e.g. "Given", "When") */
    keyword: string;
    /** Everything after the keyword + whitespace */
    text: string;
    /** Character offset (0-based) where the keyword starts in the line */
    keywordStart: number;
    /** Character offset (0-based) where the step text starts */
    textStart: number;
}
/**
 * Parse a single Gherkin line and return the step keyword + text, or null if
 * this line is not a step line.
 */
export declare function parseStepLine(line: string): ParsedStep | null;
/**
 * Filter `definitions` whose patterns contain `query` as a substring
 * (case-insensitive), returning at most `limit` results.
 */
export declare function filterDefinitions(query: string, definitions: StepDefinition[], limit?: number): StepDefinition[];
