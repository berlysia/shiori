import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  USE_CASES,
  groupUseCases,
  findUseCase,
  formatUseCase,
  formatAllUseCases,
  formatUseCasesJson,
  type UseCaseCategory,
} from '../src/commands/guide.ts';

describe('guide', () => {
  describe('USE_CASES', () => {
    it('has at least one use case', () => {
      assert.ok(USE_CASES.length > 0);
    });

    it('all use cases have unique ids', () => {
      const ids = USE_CASES.map((uc) => uc.id);
      const unique = new Set(ids);
      assert.equal(
        ids.length,
        unique.size,
        `Duplicate IDs found: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`,
      );
    });

    it('all use cases have required fields', () => {
      for (const uc of USE_CASES) {
        assert.ok(uc.id, `Use case missing id`);
        assert.ok(uc.label, `Use case ${uc.id} missing label`);
        assert.ok(uc.category, `Use case ${uc.id} missing category`);
        assert.ok(uc.commands.length > 0, `Use case ${uc.id} has no commands`);
        assert.ok(uc.explanation, `Use case ${uc.id} missing explanation`);
      }
    });

    it('all categories are valid', () => {
      const validCategories: UseCaseCategory[] = [
        'setup',
        'daily',
        'review',
        'governance',
        'diagnostics',
      ];
      for (const uc of USE_CASES) {
        assert.ok(
          validCategories.includes(uc.category),
          `Use case ${uc.id} has invalid category: ${uc.category}`,
        );
      }
    });

    it('options arrays contain non-empty strings when present', () => {
      for (const uc of USE_CASES) {
        if (uc.options) {
          assert.ok(
            Array.isArray(uc.options),
            `Use case ${uc.id}: options must be an array`,
          );
          for (const opt of uc.options) {
            assert.ok(
              typeof opt === 'string' && opt.length > 0,
              `Use case ${uc.id}: option must be a non-empty string`,
            );
          }
        }
      }
    });

    it('recipe filenames end with .md when present', () => {
      for (const uc of USE_CASES) {
        if (uc.recipes) {
          assert.ok(
            Array.isArray(uc.recipes),
            `Use case ${uc.id}: recipes must be an array`,
          );
          for (const recipe of uc.recipes) {
            assert.ok(
              recipe.endsWith('.md'),
              `Use case ${uc.id}: recipe "${recipe}" must end with .md`,
            );
          }
        }
      }
    });

    it('at least some use cases have options', () => {
      const withOptions = USE_CASES.filter(
        (uc) => uc.options && uc.options.length > 0,
      );
      assert.ok(
        withOptions.length > 0,
        'Expected at least some use cases to have options',
      );
    });

    it('at least some use cases have recipes', () => {
      const withRecipes = USE_CASES.filter(
        (uc) => uc.recipes && uc.recipes.length > 0,
      );
      assert.ok(
        withRecipes.length > 0,
        'Expected at least some use cases to have recipes',
      );
    });
  });

  describe('groupUseCases', () => {
    it('returns groups in expected category order', () => {
      const grouped = groupUseCases();
      const categories = grouped.map((g) => g.category);
      assert.deepEqual(categories, [
        'setup',
        'daily',
        'review',
        'governance',
        'diagnostics',
      ]);
    });

    it('every use case is assigned to a group', () => {
      const grouped = groupUseCases();
      const groupedCount = grouped.reduce(
        (sum, g) => sum + g.useCases.length,
        0,
      );
      assert.equal(groupedCount, USE_CASES.length);
    });

    it('each group has a human-readable category label', () => {
      const grouped = groupUseCases();
      for (const group of grouped) {
        assert.ok(group.categoryLabel, `Group ${group.category} missing label`);
        assert.notEqual(group.categoryLabel, group.category);
      }
    });
  });

  describe('findUseCase', () => {
    it('finds existing use case by id', () => {
      const result = findUseCase('quick-check');
      assert.ok(result);
      assert.equal(result.id, 'quick-check');
      assert.equal(result.category, 'daily');
    });

    it('returns undefined for unknown id', () => {
      const result = findUseCase('nonexistent-id');
      assert.equal(result, undefined);
    });
  });

  describe('formatUseCase', () => {
    it('includes label, explanation, and commands', () => {
      const uc = findUseCase('quick-check')!;
      const output = formatUseCase(uc);
      assert.ok(output.includes(uc.label));
      assert.ok(output.includes(uc.explanation));
      for (const cmd of uc.commands) {
        assert.ok(output.includes(`$ ${cmd}`));
      }
    });

    it('shows options section when use case has options', () => {
      const uc = findUseCase('generate-report')!;
      assert.ok(
        uc.options && uc.options.length > 0,
        'generate-report should have options',
      );
      const output = formatUseCase(uc);
      assert.ok(output.includes('Options:'));
      for (const opt of uc.options!) {
        assert.ok(output.includes(opt), `Missing option: ${opt}`);
      }
    });

    it('shows recipes section when use case has recipes', () => {
      const uc = findUseCase('generate-report')!;
      assert.ok(
        uc.recipes && uc.recipes.length > 0,
        'generate-report should have recipes',
      );
      const output = formatUseCase(uc);
      assert.ok(output.includes('Recipes:'));
      for (const recipe of uc.recipes!) {
        assert.ok(
          output.includes(`docs/recipes/${recipe}`),
          `Missing recipe path: ${recipe}`,
        );
      }
    });

    it('omits options section when use case has no options', () => {
      const uc = findUseCase('full-docs')!;
      assert.ok(!uc.options, 'full-docs should not have options');
      const output = formatUseCase(uc);
      assert.ok(!output.includes('Options:'));
    });

    it('omits recipes section when use case has no recipes', () => {
      const uc = findUseCase('adopt-existing')!;
      assert.ok(!uc.recipes, 'adopt-existing should not have recipes');
      const output = formatUseCase(uc);
      assert.ok(!output.includes('Recipes:'));
    });
  });

  describe('formatAllUseCases', () => {
    it('includes header and all category labels', () => {
      const grouped = groupUseCases();
      const output = formatAllUseCases(grouped);
      assert.ok(output.includes('shiori guide'));
      for (const group of grouped) {
        assert.ok(
          output.includes(group.categoryLabel),
          `Missing category label: ${group.categoryLabel}`,
        );
      }
    });

    it('includes all use case labels', () => {
      const grouped = groupUseCases();
      const output = formatAllUseCases(grouped);
      for (const uc of USE_CASES) {
        assert.ok(
          output.includes(uc.label),
          `Missing use case label: ${uc.label}`,
        );
      }
    });

    it('shows recipe count for use cases with recipes', () => {
      const grouped = groupUseCases();
      const output = formatAllUseCases(grouped);
      // generate-report has 3 recipes
      assert.ok(
        output.includes('3 recipes'),
        'generate-report should show 3 recipes',
      );
      // multi-repo has 1 recipe
      assert.ok(
        output.includes('1 recipe)'),
        'multi-repo should show 1 recipe',
      );
    });
  });

  describe('formatUseCasesJson', () => {
    it('produces valid JSON with all groups', () => {
      const grouped = groupUseCases();
      const json = formatUseCasesJson(grouped);
      const parsed = JSON.parse(json);
      assert.ok(Array.isArray(parsed));
      assert.equal(parsed.length, grouped.length);
    });

    it('each group in JSON has category and useCases', () => {
      const grouped = groupUseCases();
      const json = formatUseCasesJson(grouped);
      const parsed = JSON.parse(json) as Array<{
        category: string;
        categoryLabel: string;
        useCases: Array<{ id: string }>;
      }>;
      for (const group of parsed) {
        assert.ok(group.category);
        assert.ok(group.categoryLabel);
        assert.ok(Array.isArray(group.useCases));
        assert.ok(group.useCases.length > 0);
      }
    });

    it('includes options and recipes in JSON output', () => {
      const grouped = groupUseCases();
      const json = formatUseCasesJson(grouped);
      const parsed = JSON.parse(json) as Array<{
        useCases: Array<{
          id: string;
          options?: string[];
          recipes?: string[];
        }>;
      }>;
      // Find generate-report which has both options and recipes
      const allUseCases = parsed.flatMap((g) => g.useCases);
      const report = allUseCases.find((uc) => uc.id === 'generate-report');
      assert.ok(report, 'generate-report should be in JSON output');
      assert.ok(
        Array.isArray(report.options) && report.options.length > 0,
        'generate-report should have options in JSON',
      );
      assert.ok(
        Array.isArray(report.recipes) && report.recipes.length > 0,
        'generate-report should have recipes in JSON',
      );
    });
  });
});
