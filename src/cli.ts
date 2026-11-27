import { Command, Option } from 'commander';
import { VERSION } from './version.js';
import { runCheck } from './commands/check.js';
import { runScan } from './commands/scan.js';
import { runFind } from './commands/find.js';
import { runCompare } from './commands/compare.js';
import { runDoctor } from './commands/doctor.js';
import { FileCache } from './cache/fileCache.js';
import { EXIT } from './commands/common.js';

function withGlobals(cmd: Command): Command {
  return cmd
    .option('--json', 'machine-readable JSON output (report schema v1)')
    .option('-v, --verbose', 'show remediation and more evidence; debug logging')
    .option('-q, --quiet', 'only errors on stderr')
    .option('--no-color', 'disable colours')
    .option('--offline', 'use only cached data; never touch the network')
    .option('--cache-dir <dir>', 'cache directory (default: $XDG_CACHE_HOME/omaaudit)')
    .addOption(new Option('--fail-on <severity>', 'exit 2 when a finding at or above this severity exists').default('high').choices(['critical', 'high', 'medium', 'low', 'info', 'never']))
    .addOption(new Option('--min-severity <severity>', 'hide findings below this severity').default('info').choices(['critical', 'high', 'medium', 'low', 'info']))
    .option('--no-shellcheck', 'do not run ShellCheck even if installed')
    .option('--no-osv', 'do not run osv-scanner even if installed')
    .option('--max-findings <n>', 'maximum findings printed in human output', '60')
    .option('--max-files <n>', 'file budget for the scan tree (default 4000)')
    .option('--max-mb <n>', 'byte budget for the scan tree in MiB (default 64)');
}

export async function main(argv: string[]): Promise<number> {
  const program = new Command();
  program
    .name('omaaudit')
    .description('Discover, compare and statically audit Omarchy tools before you install them. Nothing from the audited repository is ever executed.')
    .version(VERSION)
    .showHelpAfterError()
    .exitOverride();

  let code: number = EXIT.ok;

  withGlobals(
    program
      .command('check')
      .argument('<target>', 'owner/repo, GitHub URL, or marketplace plugin id')
      .option('--ref <ref>', 'branch, tag or commit to inspect (default: default branch head)')
      .option('--no-marketplace', 'skip the marketplace catalog lookup')
      .description('Inspect installation scripts, privileges, downloads, persistence and dependency risks before installing'),
  ).action(async (target: string, opts) => {
    code = await runCheck(target, { ...opts, shellcheck: undefined, noShellcheck: opts.shellcheck === false, noOsv: opts.osv === false, noMarketplace: opts.marketplace === false });
  });

  withGlobals(program.command('scan').argument('[dir]', 'directory to audit', '.').option('--online', 'allow network use (lets osv-scanner query osv.dev); source is still never uploaded').description('Audit local source without uploading it (offline by default)')).action(async (dir: string, opts) => {
    code = await runScan(dir, { ...opts, offline: opts.online ? false : true, noShellcheck: opts.shellcheck === false, noOsv: opts.osv === false });
  });

  withGlobals(
    program
      .command('find')
      .argument('<query...>', 'what you are looking for, e.g. "iOS interoperability"')
      .option('--limit <n>', 'results per source', '10')
      .option('--no-github', 'skip GitHub search')
      .option('--refresh', 'force a marketplace catalog refresh')
      .description('Search the Omarchy plugin marketplace and GitHub, with evidence and coverage limits'),
  ).action(async (query: string[], opts) => {
    code = await runFind(query.join(' '), { ...opts, noGithub: opts.github === false });
  });

  withGlobals(program.command('compare').argument('<targets...>', 'two or more owner/repo targets').description('Compare capabilities, dependencies, maintenance and findings side by side')).action(async (targets: string[], opts) => {
    if (targets.length < 2) {
      process.stderr.write('compare needs at least two targets\n');
      code = EXIT.usage;
      return;
    }
    code = await runCompare(targets, { ...opts, noShellcheck: opts.shellcheck === false, noOsv: opts.osv === false });
  });

  withGlobals(program.command('doctor').description('Read-only checks of local dependencies, GitHub access, cache and Omarchy compatibility')).action(async (opts) => {
    code = await runDoctor(opts);
  });

  program
    .command('cache')
    .description('Show or clear the local cache')
    .option('--clear', 'delete the cache directory')
    .option('--cache-dir <dir>')
    .action(async (opts: { clear?: boolean; cacheDir?: string }) => {
      const cache = new FileCache(opts.cacheDir);
      if (opts.clear) {
        await cache.clear();
        process.stdout.write(`cleared ${cache.root}\n`);
      } else {
        const s = await cache.size();
        process.stdout.write(`${cache.root}: ${s.files} files, ${(s.bytes / 1024 / 1024).toFixed(1)} MiB\n`);
      }
    });

  program.command('rules').description('List built-in rules').action(async () => {
    const { ALL_RULES } = await import('./rules/engine.js');
    for (const r of ALL_RULES) process.stdout.write(`${r.id.padEnd(12)} ${r.severity.padEnd(8)} ${r.title}\n`);
  });

  try {
    await program.parseAsync(argv);
  } catch (e) {
    const err = e as { code?: string; exitCode?: number };
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version' || err.code === 'commander.help') return EXIT.ok;
    if (typeof err.code === 'string' && err.code.startsWith('commander.')) return EXIT.usage;
    throw e;
  }
  return code;
}
