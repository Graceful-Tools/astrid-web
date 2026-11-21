// Runs astrid-web's goals-and-guardrails rules (lib/goals-guardrails.ts) over a case matrix and
// prints, for each submitted value, whether it is accepted, the normalised value, and the lines a
// client draws and an agent reads. ADEV-179: iOS, Android and Windows validate and render the same
// way as the web and as the prompt agents are given.
// Invoked by scripts/export-contract-fixtures.ts; not useful on its own.
//
// Usage: node scripts/contract-fixtures/drivers/goals.mjs <path-to-astrid-web>

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'

const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/goals.mjs <path-to-astrid-web>')
  process.exit(2)
}

registerWebAliases(webRoot)

const rules = await import(pathToFileURL(join(webRoot, 'lib/goals-guardrails.ts')).href)

const long = n => 'x'.repeat(n)

const INPUTS = [
  ['nothing stated (null)', null],
  ['empty lists', { goals: [], guardrails: [] }],
  ['a goal with a measure and target', {
    goals: [{ id: 'g1', statement: 'Maximise long-term returns', measure: 'IRR', target: '≥ 8%/yr' }],
    guardrails: [],
  }],
  ['a goal with measure, target and current', {
    goals: [{ id: 'g1', statement: 'Grow weekly users', measure: 'WAU', target: '10k', current: '7.2k' }],
  }],
  ['a goal with only a current reading', { goals: [{ id: 'g1', statement: 'Ship the beta', current: 'in review' }] }],
  ['a goal with no measure', { goals: [{ id: 'g1', statement: 'Keep the product simple' }] }],
  ['stated and enforced guardrails', {
    goals: [{ id: 'g1', statement: 'Maximise long-term returns', measure: 'IRR', target: '≥ 8%/yr' }],
    guardrails: [
      { id: 'r1', statement: 'Break no applicable laws', kind: 'stated' },
      { id: 'r2', statement: 'Never deploy a destructive migration alone', kind: 'enforced' },
    ],
  }],
  ['guardrail kind defaults to stated', { guardrails: [{ id: 'r1', statement: 'Be kind' }] }],
  ['text is trimmed and blank optional fields dropped', {
    goals: [{ id: ' g1 ', statement: '  Be fast  ', measure: '   ', target: '' }],
  }],
  ['goal without a statement', { goals: [{ id: 'g1' }] }],
  ['goal without an id', { goals: [{ statement: 'Be fast' }] }],
  ['duplicate id across goals and guardrails', {
    goals: [{ id: 'a', statement: 'One' }],
    guardrails: [{ id: 'a', statement: 'Two', kind: 'stated' }],
  }],
  ['unknown guardrail kind', { guardrails: [{ id: 'r1', statement: 'Be kind', kind: 'suggested' }] }],
  ['statement at the limit', { goals: [{ id: 'g1', statement: long(rules.STATEMENT_MAX_CHARS) }] }],
  ['statement over the limit', { goals: [{ id: 'g1', statement: long(rules.STATEMENT_MAX_CHARS + 1) }] }],
  ['measure over the limit', { goals: [{ id: 'g1', statement: 'Be fast', measure: long(rules.FIELD_MAX_CHARS + 1) }] }],
  ['too many goals', { goals: Array.from({ length: rules.MAX_GOALS + 1 }, (_, i) => ({ id: `g${i}`, statement: 'Goal' })) }],
  ['goals is not a list', { goals: 'be fast' }],
  ['not an object', 'be fast'],
]

const cases = INPUTS.map(([name, input]) => {
  const parsed = rules.parseGoalsAndGuardrails(input)
  return parsed.ok
    ? {
        name,
        input,
        accepted: true,
        value: parsed.value,
        measures: parsed.value ? parsed.value.goals.map(goal => rules.formatGoalMeasure(goal)) : [],
        agentText: rules.formatGoalsForAgent(parsed.value),
      }
    : { name, input, accepted: false, error: parsed.error }
})

process.stdout.write(JSON.stringify({
  generatedFrom: 'lib/goals-guardrails.ts',
  rule: 'A project states goals (statement, optional measure/target/current) and guardrails (statement, kind stated|enforced; default stated). A value is trimmed, blank optional fields dropped, ids unique across both lists, text bounded; anything else is refused with `error`. Nothing in either list is "nothing stated" (null). The measure line is "<measure>: <current> → <target>", and the agent text is the goals then the guardrails, an enforced guardrail marked.',
  limits: {
    maxGoals: rules.MAX_GOALS,
    maxGuardrails: rules.MAX_GUARDRAILS,
    statementMaxChars: rules.STATEMENT_MAX_CHARS,
    fieldMaxChars: rules.FIELD_MAX_CHARS,
  },
  kinds: rules.GUARDRAIL_KINDS,
  cases,
}))
