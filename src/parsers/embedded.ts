import type { ClassifiedFile } from '../rules/types.js';

/** A fragment of shell text found inside a non-shell file. */
export interface EmbeddedSnippet {
  path: string;
  text: string;
  /** 1-based line in the host file where the snippet starts. */
  line: number;
  context: string;
  origin: 'embedded' | 'documentation';
}

/**
 * Markdown under docs/ whose path marks it as planning or design material (plans, specs, ADRs, roadmaps, research
 * notes…). Code blocks there are drafts and sketches, not what users are told to run; README files and install or usage
 * guides keep their 'documentation' origin.
 */
export function isDesignDoc(p: string): boolean {
  const m = /^(?:.*\/)?docs?\/(.+)$/i.exec(p);
  if (!m) return false;
  return /(?:^|[\/_.-])(?:plans?|planning|designs?|specs?|specifications?|rfcs?|adrs?|architecture|roadmaps?|proposals?|notes|research|decisions?|brainstorms?|superpowers|changelog|todo|internal|meetings?|retros?)(?:$|[\/_.-])/i.test(m[1]!);
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Parse a JS/QML-style string-literal array like ["bash", "-c", "curl …"] into words. */
function parseStringArray(src: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push((m[1] ?? m[2] ?? m[3] ?? '').replace(/\\(["'`\\])/g, '$1'));
  return out;
}

function shellFromWords(words: string[]): string {
  if (words.length === 0) return '';
  const first = words[0]!.split('/').pop();
  if ((first === 'bash' || first === 'sh' || first === 'zsh' || first === 'dash') && words[1] === '-c' && words[2] !== undefined) return words[2];
  return words.map((w) => (/[\s'"$|&;<>()]/.test(w) ? `'${w.replace(/'/g, `'\\''`)}'` : w)).join(' ');
}

export function extractEmbeddedShell(cf: ClassifiedFile): EmbeddedSnippet[] {
  const { type, text } = cf;
  const path = cf.file.path;
  const out: EmbeddedSnippet[] = [];
  const lines = text.split('\n');

  switch (type) {
    case 'systemd-unit': {
      lines.forEach((l, i) => {
        const m = /^\s*(Exec(?:Start|StartPre|StartPost|Stop|StopPost|Reload|Condition))\s*=\s*(.*)$/.exec(l);
        if (m && m[2]) {
          const cmd = m[2].replace(/^[-@+!:]+/, '');
          if (cmd.trim()) out.push({ path, text: cmd, line: i + 1, context: `systemd ${m[1]}`, origin: 'embedded' });
        }
      });
      break;
    }
    case 'desktop-entry': {
      lines.forEach((l, i) => {
        const m = /^\s*(Exec|TryExec)\s*=\s*(.*)$/.exec(l);
        if (m && m[2]) {
          const cmd = m[2].replace(/%[a-zA-Z%]/g, '').trim();
          if (cmd) out.push({ path, text: cmd, line: i + 1, context: `desktop ${m[1]}`, origin: 'embedded' });
        }
      });
      break;
    }
    case 'hyprland-conf': {
      lines.forEach((l, i) => {
        let m = /^\s*(exec-once|exec|exec-shutdown)\s*=\s*(.*)$/.exec(l);
        if (m && m[2]) {
          out.push({ path, text: m[2].trim(), line: i + 1, context: `hyprland ${m[1]}`, origin: 'embedded' });
          return;
        }
        m = /^\s*bind[a-z]*\s*=\s*(.*)$/.exec(l);
        if (m && m[1]) {
          const parts = m[1].split(',').map((s) => s.trim());
          const ix = parts.findIndex((p) => p === 'exec' || p === 'execr');
          if (ix >= 0 && ix + 1 < parts.length) {
            out.push({ path, text: parts.slice(ix + 1).join(','), line: i + 1, context: 'hyprland bind exec', origin: 'embedded' });
          }
        }
      });
      break;
    }
    case 'pacman-hook': {
      lines.forEach((l, i) => {
        const m = /^\s*Exec\s*=\s*(.*)$/.exec(l);
        if (m && m[1]) out.push({ path, text: m[1].trim(), line: i + 1, context: 'pacman hook Exec', origin: 'embedded' });
      });
      break;
    }
    case 'qml': {
      // Quickshell Process { command: ["bash", "-c", "..."] } and similar arrays.
      const re = /\b(command|exec)\s*:\s*\[([^\]]*)\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const words = parseStringArray(m[2] ?? '');
        const shell = shellFromWords(words);
        if (shell.trim()) out.push({ path, text: shell, line: lineOf(text, m.index), context: `QML Process ${m[1]}`, origin: 'embedded' });
      }
      // Quickshell.Io Process with a string command, or Qt.openUrlExternally etc. are not shell; skip.
      break;
    }
    case 'github-workflow': {
      // `run: |` blocks and `run: single line`
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]!;
        const m = /^(\s*)(?:-\s+)?run\s*:\s*(.*)$/.exec(l);
        if (!m) continue;
        const rest = (m[2] ?? '').trim();
        if (rest === '|' || rest === '|-' || rest === '>' || rest === '>-' || rest === '') {
          const indent = (m[1] ?? '').length;
          const block: string[] = [];
          let j = i + 1;
          while (j < lines.length) {
            const bl = lines[j]!;
            if (bl.trim() === '') {
              block.push('');
              j++;
              continue;
            }
            const ind = bl.length - bl.trimStart().length;
            if (ind <= indent) break;
            block.push(bl.trimStart());
            j++;
          }
          if (block.join('\n').trim()) out.push({ path, text: block.join('\n'), line: i + 2, context: 'GitHub Actions run step', origin: 'embedded' });
          i = j - 1;
        } else {
          out.push({ path, text: rest.replace(/^["']|["']$/g, ''), line: i + 1, context: 'GitHub Actions run step', origin: 'embedded' });
        }
      }
      break;
    }
    case 'makefile': {
      lines.forEach((l, i) => {
        if (l.startsWith('\t') && l.trim()) {
          out.push({ path, text: l.replace(/^\t[-@+]*/, '').replace(/\$\$/g, '$'), line: i + 1, context: 'Makefile recipe', origin: 'embedded' });
        }
      });
      break;
    }
    case 'package-json': {
      try {
        const pkg = JSON.parse(text) as { scripts?: Record<string, string> };
        for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
          if (typeof cmd !== 'string') continue;
          const idx = text.indexOf(`"${name}"`);
          out.push({ path, text: cmd, line: idx >= 0 ? lineOf(text, idx) : 1, context: `package.json script "${name}"`, origin: 'embedded' });
        }
      } catch {
        /* malformed JSON is reported elsewhere */
      }
      break;
    }
    case 'dockerfile': {
      lines.forEach((l, i) => {
        const m = /^\s*RUN\s+(.*)$/i.exec(l);
        if (m && m[1]) out.push({ path, text: m[1].replace(/\\\s*$/, ''), line: i + 1, context: 'Dockerfile RUN', origin: 'embedded' });
      });
      break;
    }
    case 'markdown': {
      const re = /```([\w-]*)[^\n]*\n([\s\S]*?)```/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const lang = (m[1] ?? '').toLowerCase();
        if (lang && !['bash', 'sh', 'shell', 'zsh', 'console', 'terminal', 'shell-session', 'text', 'txt', 'fish', 'nushell'].includes(lang)) continue;
        let body = m[2] ?? '';
        if (lang === 'console' || lang === 'shell-session' || /^\s*\$\s/m.test(body)) {
          body = body
            .split('\n')
            .filter((l) => /^\s*[$#]\s/.test(l))
            .map((l) => l.replace(/^\s*[$#]\s/, ''))
            .join('\n');
        }
        if (body.trim()) out.push({ path, text: body, line: lineOf(text, m.index) + 1, context: 'README code block', origin: 'documentation' });
      }
      break;
    }
    default:
      break;
  }
  return out;
}
