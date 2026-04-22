"use strict";
/**
 * stepMatcher.ts
 *
 * Utilities for:
 *  - Converting pytest-bdd step patterns (which use {param} / {param:type} syntax)
 *    into JavaScript RegExp objects.
 *  - Matching a step text string against a list of known StepDefinitions.
 *  - Parsing a Gherkin step line into its keyword + text parts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.patternToRegex = patternToRegex;
exports.matchStep = matchStep;
exports.parseStepLine = parseStepLine;
exports.filterDefinitions = filterDefinitions;
// ─── Pattern → RegExp conversion ──────────────────────────────────────────────
/**
 * Format specifier → capturing-group regex fragment.
 * Matches the pytest-bdd / parse library type codes.
 */
const FORMAT_MAP = {
    d: '(\\d+)', // integer
    D: '(\\D+)', // non-digit
    f: '([-+]?\\d*\\.\\d+)', // float
    e: '([-+]?\\d*\\.?\\d+[eE][-+]?\\d+)', // scientific
    g: '([-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?)', // general number
    w: '(\\w+)', // word (letters/digits/underscore)
    l: '([a-z]+)', // lower-case letters
    u: '([A-Z]+)', // upper-case letters
    s: '(\\S+)', // non-whitespace token
    S: '(.+)', // any string including spaces (greedy)
    n: '(\\d+(?:,\\d+)*)', // number with optional thousands separators
};
/**
 * Escape all regex special characters in a literal string fragment.
 * We do NOT escape `{` and `}` here — those are stripped before we reach this
 * function (parameters are handled separately).
 */
function escapeRegexLiteral(s) {
    return s.replace(/[.+*?^$|[\]\\()]/g, '\\$&');
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
function patternToRegex(pattern) {
    // Split the pattern on every {placeholder} token.
    // The capturing group keeps the delimiters in the result array.
    const tokens = pattern.split(/(\{[^}]*\})/g);
    let regexStr = '';
    for (const token of tokens) {
        if (token.startsWith('{') && token.endsWith('}')) {
            // Parameter placeholder: {name} or {name:type}
            const inner = token.slice(1, -1).trim(); // strip braces
            const colonIdx = inner.indexOf(':');
            const typeCode = colonIdx >= 0 ? inner.slice(colonIdx + 1).trim() : '';
            if (typeCode && FORMAT_MAP[typeCode] !== undefined) {
                regexStr += FORMAT_MAP[typeCode];
            }
            else {
                // Unknown or no type → match any non-empty string
                regexStr += '(.+)';
            }
        }
        else {
            // Literal text — escape before adding to regex
            regexStr += escapeRegexLiteral(token);
        }
    }
    // Case-insensitive so "Given" / "GIVEN" etc. don't matter at the call site,
    // but mostly we match step text which is already stripped of the keyword.
    return new RegExp('^' + regexStr + '$', 'i');
}
// ─── Step matching ─────────────────────────────────────────────────────────────
/**
 * Try to match `stepText` (the part of the Gherkin line after the keyword)
 * against every StepDefinition.  Returns the first match or undefined.
 */
function matchStep(stepText, definitions) {
    const normalized = stepText.trim();
    for (const def of definitions) {
        let regex;
        try {
            regex = patternToRegex(def.pattern);
        }
        catch {
            // Malformed pattern — skip silently
            continue;
        }
        if (regex.test(normalized)) {
            return def;
        }
    }
    return undefined;
}
// ─── Gherkin line parsing ──────────────────────────────────────────────────────
const STEP_KEYWORD_RE = /^(\s*)(Given|When|Then|And|But)(\s+)(.+)$/i;
/**
 * Parse a single Gherkin line and return the step keyword + text, or null if
 * this line is not a step line.
 */
function parseStepLine(line) {
    const m = STEP_KEYWORD_RE.exec(line);
    if (!m)
        return null;
    const indent = m[1];
    const keyword = m[2];
    const space = m[3];
    const text = m[4].trim();
    return {
        keyword,
        text,
        keywordStart: indent.length,
        textStart: indent.length + keyword.length + space.length,
    };
}
// ─── Completion helpers ────────────────────────────────────────────────────────
/**
 * Filter `definitions` whose patterns contain `query` as a substring
 * (case-insensitive), returning at most `limit` results.
 */
function filterDefinitions(query, definitions, limit = 50) {
    const lower = query.toLowerCase();
    const results = [];
    for (const def of definitions) {
        if (def.pattern.toLowerCase().includes(lower)) {
            results.push(def);
            if (results.length >= limit)
                break;
        }
    }
    return results;
}
//# sourceMappingURL=stepMatcher.js.map