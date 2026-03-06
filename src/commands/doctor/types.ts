import type { ResolvedConfig } from '../../core/config.ts';
import type { DoctorCheck, Registry } from '../../core/types.ts';

/** Options for the doctor command (pure logic) */
export interface DoctorOptions {
  /** Working directory */
  cwd: string;
  /** Explicit config directory (from --config flag) */
  configDir?: string;
  /** Whether to show fix suggestions */
  fix?: boolean;
  /** Whether to run maturity assessment (--maturity flag) */
  maturity?: boolean;
  /** Whether to run upgrade wizard (--upgrade flag) */
  upgrade?: boolean;
  /** Skip interactive confirmation (--yes flag, used with --upgrade) */
  yes?: boolean;
}

/** Result of the one-time config load */
export interface ConfigLoadResult {
  config: ResolvedConfig | undefined;
  error?: Error;
}

/** Internal result from registry check, carrying refs for downstream checks */
export interface RegistryCheckResult {
  check: DoctorCheck;
  /** Registry ref keys, available only when loading succeeded */
  registryRefs?: string[];
  /** Full registry data, available only when loading succeeded */
  registry?: Registry;
}
