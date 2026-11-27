import { createRequire } from 'node:module';
import { Parser, Language, type Node } from 'web-tree-sitter';

/**
 * Shell command model extracted from a tree-sitter parse. Wrapper commands
 * (sudo, env, exec, nohup…) are unwrapped so rules see the real program, while
 * the privilege wrapper is recorded on the command.
 */
export interface ShellCommand {
  /** Program name after unwrapping wrappers such as sudo or env. */
  name: string;
  /** Raw source text of each argument after the program name. */
  args: string[];
  wrappers: string[];
  privileged: boolean;
  text: string;
  startLine: number;
  endLine: number;
  /** For members of a pipeline: the other members in order. */
  pipeline: ShellCommand[] | null;
  pipelineIndex: number;
  redirects: { op: string; target: string }[];
  /** Raw text of process substitutions used as arguments: <(cmd) or >(cmd). */
  processSubstitutions: string[];
  /** Raw text of command substitutions used in arguments: $(cmd) or `cmd`. */
  commandSubstitutions: string[];
  /** Name of the shell function the command is defined in, if any. */
  enclosingFunction: string | null;
  /** True when the command appears inside a substitution of another command. */
  nested: boolean;
  /** Heredoc body text if the command has one attached. */
  heredoc: string | null;
}

export interface ShellUnit {
  path: string;
  /** script: a shell file. embedded: shell text extracted from another file type. documentation: a README code block. */
  origin: 'script' | 'embedded' | 'documentation';
  /** Human label for embedded origins, e.g. "systemd ExecStart" or "README code block". */
  context: string;
  commands: ShellCommand[];
  text: string;
  lineOffset: number;
  parseErrors: number;
  hasStrictMode: boolean;
}

const PRIVILEGE_WRAPPERS = new Set(['sudo', 'doas', 'pkexec', 'run0', 'su']);
const PLAIN_WRAPPERS = new Set(['env', 'exec', 'nohup', 'command', 'time', 'nice', 'ionice', 'setsid', 'stdbuf', 'timeout', 'xargs', 'builtin', 'chronic', 'caffeinate', 'uwsm-app', 'uwsm']);

let languagePromise: Promise<Language> | null = null;

async function bashLanguage(): Promise<Language> {
  if (!languagePromise) {
    languagePromise = (async () => {
      await Parser.init();
      const require = createRequire(import.meta.url);
      const wasm = require.resolve('tree-sitter-bash/tree-sitter-bash.wasm');
      return Language.load(wasm);
    })();
  }
  return languagePromise;
}

function textOf(node: Node): string {
  return node.text;
}

function enclosingFunction(node: Node): string | null {
  let cur: Node | null = node.parent;
  while (cur) {
    if (cur.type === 'function_definition') {
      const name = cur.childForFieldName('name');
      return name ? name.text : null;
    }
    cur = cur.parent;
  }
  return null;
}

function isNested(node: Node): boolean {
  let cur: Node | null = node.parent;
  while (cur) {
    if (cur.type === 'command_substitution' || cur.type === 'process_substitution') return true;
    cur = cur.parent;
  }
  return false;
}

function collect(node: Node, types: Set<string>, out: Node[]): void {
  for (const child of node.children) {
    if (!child) continue;
    if (types.has(child.type)) out.push(child);
    collect(child, types, out);
  }
}

/** Strip simple quoting so `"bash"` compares equal to `bash`. */
export function unquote(word: string): string {
  const w = word.trim();
  if ((w.startsWith('"') && w.endsWith('"')) || (w.startsWith("'") && w.endsWith("'"))) return w.slice(1, -1);
  if (w.startsWith('$"') || w.startsWith("$'")) return w.slice(2, -1);
  return w;
}

/** Names of variables whose assigned value mentions a privilege tool, e.g. `elevate=(sudo)` or `SUDO=pkexec`. */
export function privilegeVariables(text: string): Set<string> {
  const out = new Set<string>();
  const re = /^\s*(?:export\s+|local\s+|declare\s+-?\w*\s+|readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\+?=\(?\s*["']?(?:\/usr\/bin\/)?(?:sudo|doas|pkexec|run0|su)\b/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.add(m[1]!);
  return out;
}

const VAR_WORD = /^"?\$\{?([A-Za-z_][A-Za-z0-9_]*)(?:\[@\]|\[\*\])?\}?"?$/;

function unwrap(words: string[], privVars: Set<string> = new Set()): { name: string; args: string[]; wrappers: string[]; privileged: boolean } {
  const wrappers: string[] = [];
  let privileged = false;
  let rest = words.slice();
  for (let guard = 0; guard < 6 && rest.length > 0; guard++) {
    const head = unquote(rest[0]!);
    const base = head.split('/').pop() ?? head;
    // "${elevate[@]}" cmd … or "$SUDO" cmd …: a wrapper held in a variable. Privileged when the variable is
    // assigned a privilege tool anywhere in the unit, or when its name says so.
    const vm = VAR_WORD.exec(rest[0]!);
    if (vm && rest.length > 1) {
      const v = vm[1]!;
      wrappers.push(`$${v}`);
      if (privVars.has(v) || /sudo|doas|pkexec|run0|elevat|escalat|priv|as_?root|root_?cmd/i.test(v)) privileged = true;
      rest = rest.slice(1);
      continue;
    }
    if (base === 'command' && rest.length > 1 && /^-[vV]$/.test(rest[1]!)) break; // `command -v sudo` looks a tool up; nothing runs
    if (PRIVILEGE_WRAPPERS.has(base)) {
      privileged = true;
      wrappers.push(base);
      rest = rest.slice(1);
      // skip wrapper options: sudo -u user, su -c "...", su - user
      if (base === 'su') {
        // `su -c "cmd"` → treat the quoted command string as a nested unit; keep as args.
        break;
      }
      while (rest.length > 0 && rest[0]!.startsWith('-')) {
        const opt = rest[0]!;
        rest = rest.slice(1);
        if (/^-(?:u|g|p|C|D|h|r|t|U)$/.test(opt) && rest.length > 0) rest = rest.slice(1);
      }
      continue;
    }
    if (PLAIN_WRAPPERS.has(base)) {
      wrappers.push(base);
      rest = rest.slice(1);
      if (base === 'env') {
        while (rest.length > 0 && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[0]!) || rest[0]!.startsWith('-'))) rest = rest.slice(1);
      } else if (base === 'timeout' || base === 'nice' || base === 'ionice' || base === 'stdbuf') {
        while (rest.length > 0 && rest[0]!.startsWith('-')) {
          const opt = rest[0]!;
          rest = rest.slice(1);
          // short options that take a separate value: nice -n 5, ionice -c 3 -n 7, timeout -s TERM, stdbuf -o L
          if (/^-[nscikoe]$/.test(opt) && rest.length > 0 && !rest[0]!.startsWith('-')) rest = rest.slice(1);
        }
        if (base === 'timeout' && rest.length > 0 && /^\d/.test(rest[0]!)) rest = rest.slice(1);
      } else if (base === 'xargs') {
        while (rest.length > 0 && rest[0]!.startsWith('-')) {
          const opt = rest[0]!;
          rest = rest.slice(1);
          if (/^-(?:I|n|P|d|L|s|a|E)$/.test(opt) && rest.length > 0) rest = rest.slice(1);
        }
      } else if (base === 'uwsm-app' || base === 'uwsm') {
        while (rest.length > 0 && (rest[0]!.startsWith('-') || rest[0] === 'app')) rest = rest.slice(1);
      } else {
        while (rest.length > 0 && rest[0]!.startsWith('-')) rest = rest.slice(1);
      }
      continue;
    }
    break;
  }
  const name = rest.length > 0 ? unquote(rest[0]!) : (words[0] ? unquote(words[0]) : '');
  return { name: name.split('/').pop() ?? name, args: rest.slice(1), wrappers, privileged };
}

export interface ParseOptions {
  path: string;
  origin: ShellUnit['origin'];
  context: string;
  lineOffset?: number;
}

/** Parse shell source text into a ShellUnit. Never executes anything. */
export async function parseShell(text: string, opts: ParseOptions): Promise<ShellUnit> {
  const lang = await bashLanguage();
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(text);
  const offset = opts.lineOffset ?? 0;
  const commands: ShellCommand[] = [];
  let parseErrors = 0;
  if (!tree) {
    return { path: opts.path, origin: opts.origin, context: opts.context, commands, text, lineOffset: offset, parseErrors: 1, hasStrictMode: false };
  }
  const root = tree.rootNode;
  const privVars = privilegeVariables(text);
  const cmdNodes: Node[] = [];
  const errNodes: Node[] = [];
  collect(root, new Set(['command']), cmdNodes);
  collect(root, new Set(['ERROR']), errNodes);
  parseErrors = errNodes.length;

  const byNode = new Map<number, ShellCommand>();
  for (const node of cmdNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const words: string[] = [textOf(nameNode)];
    const subs: string[] = [];
    const procs: string[] = [];
    for (const child of node.children) {
      if (!child || child.id === nameNode.id) continue;
      if (child.type === 'variable_assignment') continue;
      words.push(textOf(child));
      const found: Node[] = [];
      collect(child, new Set(['command_substitution', 'process_substitution']), found);
      if (child.type === 'command_substitution') found.push(child);
      if (child.type === 'process_substitution') found.push(child);
      for (const f of found) {
        if (f.type === 'command_substitution') subs.push(textOf(f));
        else procs.push(textOf(f));
      }
    }
    const { name, args, wrappers, privileged } = unwrap(words, privVars);
    const redirects: { op: string; target: string }[] = [];
    let heredoc: string | null = null;
    let cur: Node | null = node.parent;
    let text_ = textOf(node);
    if (cur && cur.type === 'redirected_statement') {
      text_ = textOf(cur);
      for (const r of cur.children) {
        if (!r) continue;
        if (r.type === 'file_redirect') {
          const dest = r.childForFieldName('destination');
          const op = r.children.find((c) => c && /^[<>&|]+$/.test(c.type) || (c && c.type.includes('>')));
          redirects.push({ op: op ? op.text : '>', target: dest ? dest.text : r.text });
        } else if (r.type === 'heredoc_redirect') {
          const body: Node[] = [];
          collect(r, new Set(['heredoc_body']), body);
          heredoc = body.map((b) => b.text).join('\n') || null;
          redirects.push({ op: '<<', target: 'heredoc' });
        } else if (r.type === 'herestring_redirect') {
          redirects.push({ op: '<<<', target: r.text.replace(/^<<<\s*/, '') });
        }
      }
    }
    const cmd: ShellCommand = {
      name,
      args,
      wrappers,
      privileged,
      text: text_.length > 600 ? `${text_.slice(0, 600)}…` : text_,
      startLine: node.startPosition.row + 1 + offset,
      endLine: node.endPosition.row + 1 + offset,
      pipeline: null,
      pipelineIndex: 0,
      redirects,
      processSubstitutions: procs,
      commandSubstitutions: subs,
      enclosingFunction: enclosingFunction(node),
      nested: isNested(node),
      heredoc,
    };
    byNode.set(node.id, cmd);
    commands.push(cmd);
  }

  // Link pipelines: members are the direct `command` children (possibly wrapped in redirected_statement).
  const pipelines: Node[] = [];
  collect(root, new Set(['pipeline']), pipelines);
  for (const p of pipelines) {
    const members: ShellCommand[] = [];
    // `cmd <<EOF | other` parses as redirected_statement(body: cmd, heredoc_redirect(pipeline(| other))):
    // the heredoc's command is the first pipeline member.
    if (p.parent?.type === 'heredoc_redirect' && p.parent.parent?.type === 'redirected_statement') {
      const body = p.parent.parent.childForFieldName('body');
      if (body && body.type === 'command') {
        const m = byNode.get(body.id);
        if (m) members.push(m);
      }
    }
    for (const child of p.children) {
      if (!child) continue;
      let c: Node | null = child;
      if (c.type === 'redirected_statement') c = c.childForFieldName('body');
      if (c && c.type === 'command') {
        const m = byNode.get(c.id);
        if (m) members.push(m);
      }
    }
    members.forEach((m, i) => {
      m.pipeline = members;
      m.pipelineIndex = i;
    });
  }

  const hasStrictMode = /^\s*set\s+(?:-[a-zA-Z]*e[a-zA-Z]*|-o\s+errexit)/m.test(text) || /^\s*set\s+-euo?\s+pipefail/m.test(text);
  return { path: opts.path, origin: opts.origin, context: opts.context, commands, text, lineOffset: offset, parseErrors, hasStrictMode };
}
