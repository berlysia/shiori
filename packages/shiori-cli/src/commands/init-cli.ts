import { define } from 'gunshi';
import {
  validateCiKind,
  validateStarterKind,
  createInitContext,
  stepConfig,
  stepScan,
  stepStarter,
  stepRegistry,
  stepGitignore,
  stepCi,
  stepVscode,
  stepSummary,
  PathBoundaryError,
  CI_TEMPLATE_KINDS,
  STARTER_KINDS,
  type CiTemplateKind,
  type StarterKind,
} from './init-steps.ts';
import { DEFAULT_REGISTRY_PATH } from '../core/config.ts';
import { ExitCode } from '../core/exit-codes.ts';

export const initCommand = define({
  name: 'init',
  description: 'Initialize shiori in a project',
  examples: `  # Initialize with defaults
  shiori init

  # Initialize with starter template (creates sample files + registry)
  shiori init --starter eslint

  # Initialize with custom registry path
  shiori init --registry custom-registry.yaml

  # Initialize with custom scan patterns
  shiori init -p "src/**/*.ts"

  # Generate GitHub Actions workflow (basic check)
  shiori init --ci basic

  # Generate delta PR comment workflow
  shiori init --ci delta-pr-comment

  # CI-only mode (skip project init, just generate workflow)
  shiori init --ci sarif --ci-only

  # Generate VS Code tasks.json for Problems panel integration
  shiori init --vscode

  # VS Code config only (skip project init)
  shiori init --vscode --vscode-only`,
  rendering: { header: null },
  args: {
    patterns: {
      type: 'string',
      short: 'p',
      description:
        'Glob patterns to scan (comma-separated). Default: "**/*.{css,scss,pcss,js,ts,tsx,jsx}"',
    },
    ignore: {
      type: 'string',
      short: 'i',
      description:
        'Patterns to ignore (comma-separated). Default: "**/node_modules/**,**/dist/**,**/.git/**"',
    },
    registry: {
      type: 'string',
      short: 'r',
      description: `Output registry file path. Default: "${DEFAULT_REGISTRY_PATH}"`,
    },
    cwd: {
      type: 'string',
      description: 'Working directory. Default: process.cwd()',
    },
    config: {
      type: 'string',
      short: 'c',
      description:
        'Path to config directory (YAML/JSON auto-detected). Default: <cwd>/.config/shiori',
    },
    starter: {
      type: 'string',
      short: 's',
      description: `Generate starter sample files and registry. Template: ${STARTER_KINDS.join(', ')}`,
    },
    ci: {
      type: 'string',
      description: `Generate a GitHub Actions workflow. Template: ${CI_TEMPLATE_KINDS.join(', ')}`,
    },
    ciOnly: {
      type: 'boolean',
      toKebab: true,
      description:
        'Skip project initialization, only generate CI workflow file. Requires --ci.',
    },
    vscode: {
      type: 'boolean',
      description:
        'Generate VS Code tasks.json for Problems panel integration.',
    },
    vscodeOnly: {
      type: 'boolean',
      toKebab: true,
      description:
        'Skip project initialization, only generate VS Code config. Requires --vscode.',
    },
  },
  run: async (ctx) => {
    const cwd = ctx.values.cwd ?? process.cwd();
    const ciKind = ctx.values.ci as CiTemplateKind | undefined;
    const starterKind = ctx.values.starter as StarterKind | undefined;

    // Validate --ci value
    const ciError = validateCiKind(ciKind);
    if (ciError) {
      console.error(ciError);
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    // Validate --starter value
    const starterError = validateStarterKind(starterKind);
    if (starterError) {
      console.error(starterError);
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    // --ci-only requires --ci
    if (ctx.values.ciOnly && !ciKind) {
      console.error('Error: --ci-only requires --ci <template>');
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    // --vscode-only requires --vscode
    if (ctx.values.vscodeOnly && !ctx.values.vscode) {
      console.error('Error: --vscode-only requires --vscode');
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    const steps: string[] = [];
    let annotationCount = 0;
    let candidateCount = 0;
    let registryEntryCount = 0;

    const skipProjectInit = ctx.values.ciOnly || ctx.values.vscodeOnly;

    // Project initialization steps (skipped with --ci-only or --vscode-only)
    if (!skipProjectInit) {
      let initCtx;
      try {
        initCtx = await createInitContext({
          cwd,
          configFlag: ctx.values.config,
          registryFlag: ctx.values.registry,
        });
      } catch (err) {
        if (err instanceof PathBoundaryError) {
          console.error(`Error: ${err.message}`);
          process.exitCode = ExitCode.ENVIRONMENT_ERROR;
          return;
        }
        throw err;
      }

      await stepConfig(initCtx);
      await stepScan(initCtx, {
        patternsFlag: ctx.values.patterns,
        ignoreFlag: ctx.values.ignore,
      });

      // Starter step: between scan and registry (Architect directive)
      if (starterKind) {
        await stepStarter(initCtx, starterKind);
      }

      await stepRegistry(initCtx);
      await stepGitignore(initCtx);
      steps.push(...initCtx.steps);

      // Collect scan state for adaptive guidance
      if (initCtx.scanResult) {
        annotationCount = initCtx.scanResult.annotations.length;
        candidateCount = initCtx.scanResult.candidates.length;
      }
      registryEntryCount = initCtx.registryEntryCount;
    }

    // CI workflow step
    if (ciKind) {
      try {
        await stepCi(cwd, ciKind, steps);
      } catch (err) {
        if (err instanceof PathBoundaryError) {
          console.error(`Error: ${err.message}`);
          process.exitCode = ExitCode.ENVIRONMENT_ERROR;
          return;
        }
        throw err;
      }
    }

    // VS Code tasks.json step
    if (ctx.values.vscode || ctx.values.vscodeOnly) {
      try {
        await stepVscode(cwd, steps);
      } catch (err) {
        if (err instanceof PathBoundaryError) {
          console.error(`Error: ${err.message}`);
          process.exitCode = ExitCode.ENVIRONMENT_ERROR;
          return;
        }
        throw err;
      }
    }

    // Summary
    stepSummary(steps, {
      ciOnly: ctx.values.ciOnly ?? false,
      ciKind,
      annotationCount,
      candidateCount,
      registryEntryCount,
      hasStarter: starterKind !== undefined,
      hasVscode: ctx.values.vscode === true || ctx.values.vscodeOnly === true,
      vscodeOnly: ctx.values.vscodeOnly ?? false,
      registryPath: ctx.values.registry,
    });
  },
});
