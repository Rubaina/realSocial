import type { Rule } from '../catalog/schema';

export type Facts = Record<string, string>;
/** true = meets the rule, false = does not, null = cannot tell yet (an answer is missing). */
export type Tri = boolean | null;

export function evaluate(rule: Rule, facts: Facts): Tri {
  if ('fact' in rule) {
    const value = facts[rule.fact];
    return value === undefined ? null : rule.in.includes(value);
  }
  if ('not' in rule) {
    const inner = evaluate(rule.not, facts);
    return inner === null ? null : !inner;
  }
  if ('all' in rule) {
    const parts = rule.all.map((r) => evaluate(r, facts));
    if (parts.includes(false)) return false;
    return parts.includes(null) ? null : true;
  }
  const parts = rule.any.map((r) => evaluate(r, facts));
  if (parts.includes(true)) return true;
  return parts.includes(null) ? null : false;
}

/** Facts that are still unanswered AND could still change the outcome of this rule. */
export function openFacts(rule: Rule, facts: Facts): string[] {
  if (evaluate(rule, facts) !== null) return [];
  if ('fact' in rule) return [rule.fact];
  if ('not' in rule) return openFacts(rule.not, facts);
  return ('all' in rule ? rule.all : rule.any).flatMap((r) => openFacts(r, facts));
}
