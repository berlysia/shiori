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
  });
});
