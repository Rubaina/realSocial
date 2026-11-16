import { ruleFacts } from '../catalog/loader';
import type { Program, Question } from '../catalog/schema';
import { evaluate, openFacts, type Facts } from './rules';

/** The next question worth asking: the first one whose answer could still change some program's result. */
export function nextQuestion(questions: Question[], programs: Program[], facts: Facts): Question | undefined {
  const open = new Set(programs.flatMap((p) => openFacts(p.eligibility, facts)));
  return questions.find((q) => open.has(q.id));
}

/** Programs the household likely qualifies for, most valuable first. */
export function eligible(programs: Program[], facts: Facts): Program[] {
  return programs.filter((p) => evaluate(p.eligibility, facts) === true).sort((a, b) => b.priority - a.priority);
}

/** The answers a result was based on, kept so an admin can later see why a program was shown. */
export function reason(program: Program, facts: Facts): Record<string, string> {
  const used: Record<string, string> = {};
  for (const { fact } of ruleFacts(program.eligibility)) if (facts[fact] !== undefined) used[fact] = facts[fact];
  return used;
}
