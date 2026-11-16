import { describe, expect, it } from 'vitest';
import type { Program, Question, Rule } from '../src/catalog/schema';
import { eligible, nextQuestion } from '../src/eligibility/planner';
import { evaluate, openFacts } from '../src/eligibility/rules';

const low: Rule = { any: [{ fact: 'registry', in: ['yes'] }, { fact: 'income', in: ['lt1'] }] };
const rule: Rule = { all: [low, { fact: 'child', in: ['yes'] }] };

describe('rules', () => {
  it('is undecided until enough answers are known', () => {
    expect(evaluate(rule, {})).toBe(null);
    expect(evaluate(rule, { registry: 'yes' })).toBe(null);
    expect(evaluate(rule, { registry: 'yes', child: 'yes' })).toBe(true);
  });
  it('decides early when one answer already rules it out', () => {
    expect(evaluate(rule, { child: 'no' })).toBe(false);
    expect(evaluate({ not: { fact: 'child', in: ['yes'] } }, { child: 'no' })).toBe(true);
  });
  it('needs both branches of "any" to fail', () => {
    expect(evaluate(low, { registry: 'no' })).toBe(null);
    expect(evaluate(low, { registry: 'no', income: 'gt4' })).toBe(false);
    expect(evaluate(low, { registry: 'no', income: 'lt1' })).toBe(true);
  });
  it('only lists facts that can still change the outcome', () => {
    expect(openFacts(rule, {}).sort()).toEqual(['child', 'income', 'registry']);
    expect(openFacts(rule, { registry: 'yes' })).toEqual(['child']);
    expect(openFacts(rule, { child: 'no' })).toEqual([]);
  });
});

describe('planner', () => {
  const q = (id: string): Question => ({ id, text: id, options: [{ value: 'yes', label: 'Y' }, { value: 'no', label: 'N' }] });
  const program = (id: string, eligibility: Rule, priority: number) => ({ id, eligibility, priority }) as Program;
  const questions = [q('registry'), q('income'), q('child')];
  const programs = [program('a', rule, 1), program('b', low, 5)];

  it('asks in catalog order and skips questions that no longer matter', () => {
    expect(nextQuestion(questions, programs, {})?.id).toBe('registry');
    expect(nextQuestion(questions, programs, { registry: 'yes' })?.id).toBe('child');
    expect(nextQuestion(questions, programs, { registry: 'yes', child: 'no' })).toBeUndefined();
  });
  it('ranks likely-eligible programs by priority', () => {
    expect(eligible(programs, { registry: 'yes', child: 'yes' }).map((p) => p.id)).toEqual(['b', 'a']);
    expect(eligible(programs, { registry: 'no', income: 'gt4', child: 'yes' })).toEqual([]);
  });
});
