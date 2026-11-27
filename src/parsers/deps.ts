import type { Dependency } from '../report/schema.js';
import type { ClassifiedFile } from '../rules/types.js';

const PINNED_SEMVER = /^v?\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?$/;

/** Extract a dependency inventory from common manifests. Pure text parsing; nothing is resolved or installed. */
export function extractDependencies(files: ClassifiedFile[]): Dependency[] {
  const deps: Dependency[] = [];
  for (const cf of files) {
    const manifest = cf.file.path;
    const text = cf.text;
    switch (cf.type) {
      case 'package-json': {
        try {
          const pkg = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
          for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
            for (const [name, ver] of Object.entries(pkg[key] ?? {})) {
              deps.push({ ecosystem: 'npm', name, version: ver, manifest, pinned: PINNED_SEMVER.test(ver) });
            }
          }
        } catch {
          /* ignore */
        }
        break;
      }
      case 'cargo-toml': {
        let section = '';
        for (const raw of text.split('\n')) {
          const l = raw.trim();
          const s = /^\[([^\]]+)\]$/.exec(l);
          if (s) {
            section = s[1] ?? '';
            continue;
          }
          if (!/dependencies/.test(section)) continue;
          const m = /^([\w-]+)\s*=\s*(.*)$/.exec(l);
          if (!m) continue;
          const name = m[1]!;
          const rhs = m[2]!;
          let version: string | undefined;
          let pinned = false;
          const vq = /^"([^"]+)"$/.exec(rhs);
          if (vq) {
            version = vq[1];
            pinned = /^=/.test(version ?? '');
          } else {
            const v = /version\s*=\s*"([^"]+)"/.exec(rhs);
            if (v) {
              version = v[1];
              pinned = /^=/.test(version ?? '');
            }
            const git = /git\s*=\s*"([^"]+)"/.exec(rhs);
            if (git) {
              version = `git:${git[1]}`;
              pinned = /rev\s*=\s*"[0-9a-f]{7,40}"/.test(rhs);
            }
          }
          deps.push({ ecosystem: 'cargo', name, ...(version ? { version } : {}), manifest, pinned });
        }
        break;
      }
      case 'go-mod': {
        let inBlock = false;
        for (const raw of text.split('\n')) {
          const l = raw.trim();
          if (l.startsWith('require (')) {
            inBlock = true;
            continue;
          }
          if (inBlock && l === ')') {
            inBlock = false;
            continue;
          }
          const m = inBlock ? /^(\S+)\s+(\S+)/.exec(l) : /^require\s+(\S+)\s+(\S+)/.exec(l);
          if (m && !l.startsWith('//')) deps.push({ ecosystem: 'go', name: m[1]!, version: m[2]!, manifest, pinned: true });
        }
        break;
      }
      case 'python-requirements': {
        for (const raw of text.split('\n')) {
          const l = raw.replace(/#.*$/, '').trim();
          if (!l || l.startsWith('-')) continue;
          const m = /^([A-Za-z0-9_.\-\[\]]+)\s*([=<>!~]=?.*)?$/.exec(l);
          if (m) {
            const ver = m[2]?.trim();
            deps.push({ ecosystem: 'pypi', name: m[1]!, ...(ver ? { version: ver } : {}), manifest, pinned: !!ver && ver.startsWith('==') });
          } else if (/^git\+/.test(l)) {
            deps.push({ ecosystem: 'pypi', name: l, manifest, pinned: /@[0-9a-f]{7,40}(?:#|$)/.test(l) });
          }
        }
        break;
      }
      case 'pkgbuild': {
        const arrays = ['depends', 'makedepends', 'optdepends', 'checkdepends'];
        for (const arr of arrays) {
          const re = new RegExp(`^\\s*${arr}(?:_[a-z0-9_]+)?=\\(([\\s\\S]*?)\\)`, 'gm');
          let m: RegExpExecArray | null;
          while ((m = re.exec(text))) {
            for (const tok of (m[1] ?? '').split(/\s+/)) {
              const t = tok.replace(/^['"]|['"]$/g, '').split(':')[0]!.trim();
              if (!t || t.startsWith('#')) continue;
              const vm = /^([\w.+@-]+)(?:([<>=]+)(.+))?$/.exec(t);
              if (vm) deps.push({ ecosystem: `pacman:${arr}`, name: vm[1]!, ...(vm[3] ? { version: `${vm[2]}${vm[3]}` } : {}), manifest, pinned: vm[2] === '=' });
            }
          }
        }
        break;
      }
      default:
        break;
    }
  }
  return deps;
}
