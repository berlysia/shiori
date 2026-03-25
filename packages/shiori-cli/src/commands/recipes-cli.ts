import { define } from 'gunshi';
import {
  recommendRecipes,
  formatRecipeRecommendation,
  formatRecipeRecommendationJson,
  formatFullCatalog,
} from './recipes.ts';
import { doctor } from './doctor.ts';
import type { MaturityLevel } from '../core/types.ts';
import { wrapOutputJson } from '../core/schema-envelope.ts';

export const recipesCommand = define({
  name: 'recipes',
  description:
    'Maturity-based recipe catalog — discover automation recipes for your governance stage',
  examples: `  # Show recipes for your current maturity level
  shiori recipes

  # Show recipes for a specific level
  shiori recipes --level 2

  # Show full catalog (all levels)
  shiori recipes --all

  # JSON output
  shiori recipes --json`,
  rendering: { header: null },
  args: {
    level: {
      type: 'string',
      description:
        'Maturity level (0-4) to show recipes for. Auto-detected if omitted.',
    },
    all: {
      type: 'boolean',
      description: 'Show full recipe catalog across all maturity levels',
    },
    json: {
      type: 'boolean',
      description: 'Output as JSON with schema envelope',
    },
    cwd: {
      type: 'string',
      description: 'Working directory (defaults to process.cwd())',
    },
    config: {
      type: 'string',
      description: 'Config directory path',
    },
  },
  run: async (ctx) => {
    const allMode = ctx.values.all ?? false;
    const jsonMode = ctx.values.json ?? false;

    // --all mode: show full catalog
    if (allMode) {
      if (jsonMode) {
        // Full catalog as JSON: recommend for each level
        const allRecs = [];
        for (let lvl = 0; lvl <= 4; lvl++) {
          allRecs.push(recommendRecipes(lvl as MaturityLevel));
        }
        console.log(
          wrapOutputJson(allRecs, { command: 'recipes', schemaVersion: 1 }),
        );
      } else {
        console.error(formatFullCatalog());
      }
      return;
    }

    // Determine maturity level
    let level: MaturityLevel;

    if (ctx.values.level !== undefined) {
      const parsed = parseInt(ctx.values.level, 10);
      if (Number.isNaN(parsed) || parsed < 0 || parsed > 4) {
        console.error('Error: --level must be 0-4');
        process.exitCode = 1;
        return;
      }
      level = parsed as MaturityLevel;
    } else {
      // Auto-detect from doctor
      const cwd = ctx.values.cwd ?? process.cwd();
      console.error('Detecting maturity level...');
      try {
        const doctorResult = await doctor({
          cwd,
          configDir: ctx.values.config,
          maturity: true,
        });
        level = doctorResult.maturity?.level ?? 0;
      } catch {
        console.error(
          'Could not detect maturity level (using level 0). Run "shiori init" first.',
        );
        level = 0;
      }
    }

    const recommendation = recommendRecipes(level);

    if (jsonMode) {
      console.log(formatRecipeRecommendationJson(recommendation));
    } else {
      console.error(formatRecipeRecommendation(recommendation));
    }
  },
});
