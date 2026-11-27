import path from 'node:path';
import { stat } from 'node:fs/promises';
import { scanDirectory } from '../scan.js';
import { applyGlobals, emitReport, handleError, severityOpt, limitsFrom, UsageError, type GlobalOptions } from './common.js';

/** Audit a local directory. No network access unless osv-scanner is enabled and online. */
export async function runScan(dir: string, o: GlobalOptions): Promise<number> {
  try {
    applyGlobals(o);
    const abs = path.resolve(dir);
    const st = await stat(abs).catch(() => null);
    if (!st || !st.isDirectory()) throw new UsageError(`not a directory: ${abs}`);
    const { report } = await scanDirectory(
      abs,
      { kind: 'local', name: abs },
      { limits: limitsFrom(o), offline: o.offline ?? true, shellcheck: !o.noShellcheck, osv: !o.noOsv && o.offline === false, minSeverity: severityOpt(o.minSeverity, 'info') },
    );
    return emitReport(report, o);
  } catch (e) {
    return handleError(e);
  }
}
