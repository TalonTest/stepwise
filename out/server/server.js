"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const cp = __importStar(require("child_process"));
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const stepMatcher_1 = require("./stepMatcher");
// ─── Globals ──────────────────────────────────────────────────────────────────
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
let workspaceFolderPaths = [];
let stepDefinitions = [];
// Track whether the client supports dynamic file-watcher registration
let supportsDynamicWatchers = false;
// ─── URI / path helpers ───────────────────────────────────────────────────────
/** Convert a `file://` URI to a local file-system path. */
function uriToPath(uri) {
    try {
        const url = new URL(uri);
        let p = decodeURIComponent(url.pathname);
        // On Windows the pathname looks like /C:/Users/... — strip the leading slash.
        if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(p)) {
            p = p.slice(1);
        }
        return p;
    }
    catch {
        // Fallback: strip scheme manually
        return uri.replace(/^file:\/\//, '');
    }
}
/** Convert a local file-system path to a `file://` URI. */
function pathToUri(filePath) {
    if (process.platform === 'win32') {
        return 'file:///' + filePath.replace(/\\/g, '/');
    }
    return 'file://' + filePath;
}
// ─── File discovery ────────────────────────────────────────────────────────────
const SKIP_DIRS = new Set([
    'node_modules', '.git', '__pycache__', '.venv', 'venv',
    '.mypy_cache', '.pytest_cache', 'dist', 'build', '.tox',
]);
/**
 * Recursively collect every `.py` file under `root`.
 * Skips common non-source directories for performance.
 */
function findPythonFiles(root) {
    const results = [];
    function walk(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return; // Unreadable directory — skip
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name)) {
                    walk(full);
                }
            }
            else if (entry.isFile() && entry.name.endsWith('.py')) {
                results.push(full);
            }
        }
    }
    walk(root);
    return results;
}
// ─── Python subprocess ────────────────────────────────────────────────────────
/** Try to find a usable Python 3 interpreter on PATH. */
function findPython() {
    for (const candidate of ['python3', 'python']) {
        try {
            const result = cp.spawnSync(candidate, ['--version'], {
                encoding: 'utf8',
                timeout: 3000,
            });
            if (result.status === 0) {
                // Confirm it is Python 3
                const out = (result.stdout || result.stderr || '').trim();
                if (out.startsWith('Python 3')) {
                    return candidate;
                }
            }
        }
        catch {
            // not found
        }
    }
    return 'python3'; // best guess
}
/** Absolute path to the bundled step_parser.py. */
function getParserScriptPath() {
    // Compiled output: out/server/server.js  →  ../../server/python/step_parser.py
    return path.join(__dirname, '..', '..', 'server', 'python', 'step_parser.py');
}
/**
 * Invoke step_parser.py with a JSON array of Python file paths on stdin.
 * Returns a parsed array of StepDefinition objects.
 */
function runStepParser(pythonFiles) {
    return new Promise((resolve) => {
        if (pythonFiles.length === 0) {
            resolve([]);
            return;
        }
        const scriptPath = getParserScriptPath();
        if (!fs.existsSync(scriptPath)) {
            connection.console.warn(`[stepwise] Parser script not found at: ${scriptPath}`);
            resolve([]);
            return;
        }
        const python = findPython();
        const proc = cp.spawn(python, [scriptPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
        proc.on('error', (err) => {
            connection.console.warn(`[stepwise] Failed to spawn Python: ${err.message}`);
            resolve([]);
        });
        proc.on('close', (code) => {
            if (code !== 0) {
                connection.console.warn(`[stepwise] step_parser.py exited with code ${code}. stderr: ${stderr.slice(0, 400)}`);
                resolve([]);
                return;
            }
            try {
                const parsed = JSON.parse(stdout);
                resolve(parsed);
            }
            catch (e) {
                connection.console.warn(`[stepwise] Failed to parse JSON from step_parser.py: ${e}`);
                resolve([]);
            }
        });
        proc.stdin.write(JSON.stringify(pythonFiles), 'utf8');
        proc.stdin.end();
    });
}
// ─── Index management ─────────────────────────────────────────────────────────
async function refreshStepDefinitions() {
    const allPyFiles = [];
    for (const folder of workspaceFolderPaths) {
        allPyFiles.push(...findPythonFiles(folder));
    }
    connection.console.log(`[stepwise] Scanning ${allPyFiles.length} Python file(s) for step definitions…`);
    stepDefinitions = await runStepParser(allPyFiles);
    connection.console.log(`[stepwise] Loaded ${stepDefinitions.length} step definition(s).`);
    // Re-validate all currently open feature files
    for (const doc of documents.all()) {
        validateDocument(doc);
    }
}
// ─── Diagnostics ──────────────────────────────────────────────────────────────
function validateDocument(doc) {
    if (!doc.uri.endsWith('.feature'))
        return;
    const diagnostics = [];
    const text = doc.getText();
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const parsed = (0, stepMatcher_1.parseStepLine)(line);
        if (!parsed)
            continue;
        const match = (0, stepMatcher_1.matchStep)(parsed.text, stepDefinitions);
        if (!match) {
            const range = {
                start: { line: i, character: parsed.keywordStart },
                end: { line: i, character: line.trimEnd().length },
            };
            diagnostics.push({
                severity: node_1.DiagnosticSeverity.Warning,
                range,
                message: `No matching step definition found for: "${parsed.text}"`,
                source: 'stepwise',
                code: 'no-step-definition',
            });
        }
    }
    connection.sendDiagnostics({ uri: doc.uri, diagnostics });
}
// ─── Lifecycle ────────────────────────────────────────────────────────────────
connection.onInitialize((params) => {
    // Collect workspace root paths
    if (params.workspaceFolders) {
        workspaceFolderPaths = params.workspaceFolders.map((f) => uriToPath(f.uri));
    }
    else if (params.rootUri) {
        workspaceFolderPaths = [uriToPath(params.rootUri)];
    }
    else if (params.rootPath) {
        workspaceFolderPaths = [params.rootPath];
    }
    supportsDynamicWatchers =
        !!params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration;
    const result = {
        capabilities: {
            textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: false,
                triggerCharacters: [' '],
            },
            definitionProvider: true,
        },
        serverInfo: {
            name: 'stepwise',
            version: '0.1.0',
        },
    };
    return result;
});
connection.onInitialized(async () => {
    if (supportsDynamicWatchers) {
        // Ask VS Code to deliver file-change events for Python files
        await connection.client.register(node_1.DidChangeWatchedFilesNotification.type, {
            watchers: [
                {
                    globPattern: '**/*.py',
                    kind: node_1.WatchKind.Create | node_1.WatchKind.Change | node_1.WatchKind.Delete,
                },
            ],
        });
    }
    await refreshStepDefinitions();
});
// ─── File watcher ─────────────────────────────────────────────────────────────
connection.onDidChangeWatchedFiles(async (params) => {
    const hasPyChange = params.changes.some((c) => c.uri.endsWith('.py'));
    if (hasPyChange) {
        await refreshStepDefinitions();
    }
});
// ─── Go-to-definition ─────────────────────────────────────────────────────────
connection.onDefinition((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc)
        return null;
    // Get the full text of the line at the cursor
    const lineText = doc.getText({
        start: { line: params.position.line, character: 0 },
        end: { line: params.position.line, character: Number.MAX_SAFE_INTEGER },
    });
    const parsed = (0, stepMatcher_1.parseStepLine)(lineText);
    if (!parsed)
        return null;
    const def = (0, stepMatcher_1.matchStep)(parsed.text, stepDefinitions);
    if (!def)
        return null;
    // line in StepDefinition is 1-based; LSP uses 0-based
    const targetLine = Math.max(0, def.line - 1);
    return node_1.Location.create(pathToUri(def.file), {
        start: { line: targetLine, character: 0 },
        end: { line: targetLine, character: 0 },
    });
});
// ─── Completion ───────────────────────────────────────────────────────────────
connection.onCompletion((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc)
        return [];
    // Only look at what's been typed up to the cursor on this line
    const linePrefix = doc.getText({
        start: { line: params.position.line, character: 0 },
        end: params.position,
    });
    // Must be on a step line  (Given/When/Then/And/But …)
    const kwMatch = /^\s*(?:Given|When|Then|And|But)\s+(.*)/i.exec(linePrefix);
    if (!kwMatch)
        return [];
    const typed = kwMatch[1]; // text the user has typed so far after the keyword
    const candidates = (0, stepMatcher_1.filterDefinitions)(typed, stepDefinitions, 60);
    return candidates.map((def, index) => {
        const basename = path.basename(def.file);
        return {
            label: def.pattern,
            kind: node_1.CompletionItemKind.Text,
            detail: `${def.decorator} — ${basename}:${def.line}`,
            documentation: {
                kind: 'markdown',
                value: `**${def.decorator}**\`\`\`\n${def.pattern}\n\`\`\`\n*Defined in ${def.file}:${def.line}*`,
            },
            // Sort alphabetically within the result set
            sortText: String(index).padStart(6, '0'),
            // Replace the current step text with the chosen pattern
            insertText: def.pattern,
        };
    });
});
// ─── Document listeners ───────────────────────────────────────────────────────
documents.onDidChangeContent((change) => {
    validateDocument(change.document);
});
documents.onDidOpen((event) => {
    validateDocument(event.document);
});
documents.listen(connection);
connection.listen();
//# sourceMappingURL=server.js.map