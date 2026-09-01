import { existsSync, readFileSync } from 'node:fs'
import { globSync } from 'glob'
import ts from 'typescript'
import { V1_ROUTE_FAMILY_COVERAGE } from '../tests/fixtures/v1-route-coverage'

const riskDomains = {
  auth: ['lib/api-auth-wrapper.ts', 'tests/lib/api-auth-wrapper.test.ts'],
  permissions: ['lib/list-permissions.ts', 'tests/lib/list-permissions.test.ts'],
  routes: ['tests/api/legacy-v1-risk-parity.test.ts', 'tests/api/v1-contract.test.ts'],
  offline: ['lib/offline-sync.ts', 'tests/lib/offline-sync.test.ts'],
  sse: ['lib/sse-manager.ts', 'tests/lib/sse-manager.test.ts'],
  files: ['lib/upload-validation.ts', 'tests/lib/upload-validation.test.ts'],
  invitations: ['lib/list-invite.ts', 'tests/lib/list-invite.test.ts'],
  agents: ['lib/ai/prompt-trust.ts', 'tests/lib/assistant-prompt-trust.test.ts'],
} as const

const missing = Object.entries(riskDomains).flatMap(([domain, files]) =>
  files.filter((file) => !existsSync(file)).map((file) => `${domain}: ${file}`)
)
if (missing.length > 0) {
  throw new Error(`Risk coverage manifest references missing files:\n${missing.join('\n')}`)
}

const testFiles = globSync(['tests/**/*.{test,spec}.{ts,tsx}', 'e2e/**/*.spec.ts'], {
  nodir: true,
})
const indefiniteSkips = testFiles.flatMap((file) => {
  const sourceText = readFileSync(file, 'utf8')
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const violations: string[] = []

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const receiver = node.expression.expression.getText(source)
      const isDisabledTest = ['skip', 'fixme', 'todo'].includes(method)
      const isTestReceiver = /(?:^|\.)(?:test|it|describe)$/.test(receiver) ||
        /^(?:test|it|describe)\./.test(receiver)

      if (isDisabledTest && isTestReceiver) {
        const condition = node.arguments[0]
        const conditionalSkip =
          method !== 'todo' &&
          receiver !== 'describe' &&
          receiver !== 'test.describe' &&
          condition !== undefined &&
          condition.kind !== ts.SyntaxKind.TrueKeyword

        if (!conditionalSkip) {
          const position = source.getLineAndCharacterOfPosition(node.getStart(source))
          violations.push(
            `${file}:${position.line + 1}: ${node.getText(source).split('\n')[0]}`
          )
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return violations
})
if (indefiniteSkips.length > 0) {
  throw new Error(
    `Indefinite test skips are not allowed; assert the condition or create a dated task:\n${indefiniteSkips.join('\n')}`
  )
}

const v1Routes = globSync('app/api/v1/**/route.ts', { nodir: true })
const v1Tests = globSync('tests/api/v1-*.test.ts', { nodir: true })
if (v1Routes.length === 0 || v1Tests.length === 0) {
  throw new Error('The v1 route/test census is unexpectedly empty')
}

const routeFamilies = new Set(
  v1Routes.map((route) => route.slice('app/api/v1/'.length).split('/')[0])
)
const triagedFamilies = new Set(Object.keys(V1_ROUTE_FAMILY_COVERAGE))
const untriagedFamilies = [...routeFamilies].filter((family) => !triagedFamilies.has(family))
const staleFamilies = [...triagedFamilies].filter((family) => !routeFamilies.has(family))
const missingCoverageTests = Object.entries(V1_ROUTE_FAMILY_COVERAGE).flatMap(
  ([family, coverage]) =>
    coverage.tests
      .filter((file) => !existsSync(file))
      .map((file) => `${family}: ${file}`)
)
if (untriagedFamilies.length || staleFamilies.length || missingCoverageTests.length) {
  throw new Error([
    untriagedFamilies.length ? `Untriaged v1 route families: ${untriagedFamilies.join(', ')}` : '',
    staleFamilies.length ? `Stale v1 route families: ${staleFamilies.join(', ')}` : '',
    missingCoverageTests.length
      ? `Missing v1 coverage tests:\n${missingCoverageTests.join('\n')}`
      : '',
  ].filter(Boolean).join('\n'))
}

console.log(
  `Risk controls: ${Object.keys(riskDomains).length} domains, ${v1Routes.length} v1 routes across ${routeFamilies.size} triaged families, ${v1Tests.length} direct v1 test files, no indefinite skips`
)
