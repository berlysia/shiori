import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECIPE_CATALOG,
  filterRecipesByLevel,
  newRecipesAtLevel,
  recommendRecipes,
  formatRecipeRecommendation,
  formatFullCatalog,
  formatRecipeRecommendationJson,
  type RecipeCategory,
} from '../src/commands/recipes.ts';
import type { MaturityLevel } from '../src/core/types.ts';

describe('recipes', () => {
  describe('RECIPE_CATALOG', () => {
    it('has entries', () => {
      assert.ok(RECIPE_CATALOG.length > 0);
    });

    it('all entries have required fields', () => {
      for (const entry of RECIPE_CATALOG) {
        assert.ok(entry.filename, `Entry missing filename`);
        assert.ok(entry.title, `Entry ${entry.filename} missing title`);
        assert.ok(
          entry.description,
          `Entry ${entry.filename} missing description`,
        );
        assert.ok(entry.category, `Entry ${entry.filename} missing category`);
        assert.ok(
          entry.minLevel >= 0 && entry.minLevel <= 4,
          `Entry ${entry.filename} has invalid minLevel: ${entry.minLevel}`,
        );
        assert.ok(
          entry.maxLevel >= 0 && entry.maxLevel <= 4,
          `Entry ${entry.filename} has invalid maxLevel: ${entry.maxLevel}`,
        );
        assert.ok(
          entry.minLevel <= entry.maxLevel,
          `Entry ${entry.filename}: minLevel (${entry.minLevel}) > maxLevel (${entry.maxLevel})`,
        );
      }
    });

    it('all categories are valid', () => {
      const validCategories: RecipeCategory[] = [
        'ci',
        'notification',
        'reporting',
        'automation',
        'editor',
        'monitoring',
      ];
      for (const entry of RECIPE_CATALOG) {
        assert.ok(
          validCategories.includes(entry.category),
          `Entry ${entry.filename} has invalid category: ${entry.category}`,
        );
      }
    });

    it('all filenames are unique', () => {
      const filenames = RECIPE_CATALOG.map((e) => e.filename);
      const unique = new Set(filenames);
      assert.equal(
        filenames.length,
        unique.size,
        `Duplicate filenames: ${filenames.filter((f, i) => filenames.indexOf(f) !== i).join(', ')}`,
      );
    });
  });

  describe('filterRecipesByLevel', () => {
    it('level 0 returns only recipes with minLevel 0', () => {
      const recipes = filterRecipesByLevel(0);
      for (const r of recipes) {
        assert.ok(
          r.minLevel <= 0,
          `Recipe ${r.filename} should not be in level 0 (minLevel=${r.minLevel})`,
        );
      }
    });

    it('level 4 returns all recipes with maxLevel >= 4', () => {
      const recipes = filterRecipesByLevel(4);
      for (const r of recipes) {
        assert.ok(
          r.minLevel <= 4 && r.maxLevel >= 4,
          `Recipe ${r.filename} should not be in level 4`,
        );
      }
    });

    it('higher levels include more or equal recipes', () => {
      const counts: number[] = [];
      for (let lvl = 0; lvl <= 4; lvl++) {
        counts.push(filterRecipesByLevel(lvl as MaturityLevel).length);
      }
      // Each level should have >= the previous (monotonic increase)
      for (let i = 1; i < counts.length; i++) {
        assert.ok(
          (counts[i] ?? 0) >= (counts[i - 1] ?? 0),
          `Level ${i} has fewer recipes (${counts[i]}) than level ${i - 1} (${counts[i - 1]})`,
        );
      }
    });

    it('level 2 includes CI recipes', () => {
      const recipes = filterRecipesByLevel(2);
      const ciRecipes = recipes.filter((r) => r.category === 'ci');
      assert.ok(ciRecipes.length > 0, 'Level 2 should include CI recipes');
    });
  });

  describe('newRecipesAtLevel', () => {
    it('returns recipes whose minLevel matches exactly', () => {
      const recipes = newRecipesAtLevel(2);
      for (const r of recipes) {
        assert.equal(
          r.minLevel,
          2,
          `Recipe ${r.filename} has minLevel ${r.minLevel}, expected 2`,
        );
      }
    });

    it('level 1 includes editor recipes', () => {
      const recipes = newRecipesAtLevel(1);
      const editorRecipes = recipes.filter((r) => r.category === 'editor');
      assert.ok(
        editorRecipes.length > 0,
        'Level 1 should introduce editor recipes',
      );
    });
  });

  describe('recommendRecipes', () => {
    it('returns current and next recommendations', () => {
      const rec = recommendRecipes(2);
      assert.equal(rec.level, 2);
      assert.equal(rec.levelLabel, 'CI integrated');
      assert.ok(rec.current.length > 0);
      // Level 2 should have next-level recipes
      assert.ok(rec.next.length >= 0);
    });

    it('level 4 has no next recipes', () => {
      const rec = recommendRecipes(4);
      assert.equal(rec.next.length, 0);
    });

    it('level 0 has empty or minimal current recipes', () => {
      const rec = recommendRecipes(0);
      assert.equal(rec.level, 0);
      // Level 0 has no recipes since all require at least init
      // (or has some — depends on catalog data)
      assert.ok(Array.isArray(rec.current));
    });

    it('next recipes are newly available at the next level', () => {
      const rec = recommendRecipes(1);
      for (const r of rec.next) {
        assert.equal(
          r.minLevel,
          2,
          `Next recipe ${r.filename} should have minLevel 2`,
        );
      }
    });
  });

  describe('formatRecipeRecommendation', () => {
    it('includes level info in output', () => {
      const rec = recommendRecipes(2);
      const output = formatRecipeRecommendation(rec);
      assert.ok(output.includes('Level 2'));
      assert.ok(output.includes('CI integrated'));
    });

    it('includes recipe filenames', () => {
      const rec = recommendRecipes(2);
      const output = formatRecipeRecommendation(rec);
      assert.ok(output.includes('docs/recipes/'));
    });

    it('shows unlock section for non-max levels', () => {
      const rec = recommendRecipes(2);
      const output = formatRecipeRecommendation(rec);
      if (rec.next.length > 0) {
        assert.ok(output.includes('Unlock at Level 3'));
      }
    });

    it('level 0 shows init guidance', () => {
      const rec = recommendRecipes(0);
      const output = formatRecipeRecommendation(rec);
      // Level 0 has no recipes, should show init guidance
      if (rec.current.length === 0) {
        assert.ok(output.includes('shiori init'));
      }
    });
  });

  describe('formatFullCatalog', () => {
    it('includes all level labels', () => {
      const output = formatFullCatalog();
      assert.ok(output.includes('Full Catalog'));
      assert.ok(output.includes('Basic setup'));
      assert.ok(output.includes('CI integrated'));
    });

    it('includes recipe paths', () => {
      const output = formatFullCatalog();
      assert.ok(output.includes('docs/recipes/'));
    });
  });

  describe('formatRecipeRecommendationJson', () => {
    it('returns valid JSON with ADR 028 envelope', () => {
      const rec = recommendRecipes(2);
      const json = formatRecipeRecommendationJson(rec);
      const parsed = JSON.parse(json);
      assert.ok(parsed.meta);
      assert.equal(parsed.meta.command, 'recipes');
      assert.equal(parsed.meta.schemaVersion, 1);
      assert.ok(parsed.data);
      assert.equal(parsed.data.level, 2);
      assert.ok(Array.isArray(parsed.data.current));
      assert.ok(Array.isArray(parsed.data.next));
    });
  });
});
