/**
 * Every harness that works the web board reads the same /fixall procedure.
 *
 * The web half of /fixall used to live in `.claude/commands/fixall.md`, which
 * only Claude Code reads. Copilot and Codex worked the same board without it:
 * without the deploy rule, the definition of done, or the claim step that stops
 * two loops writing the same fix. The procedure is now in docs/FIXALL_WEB.md,
 * and each adapter points to it and stays thin (docs/AGENT_FLEET.md).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

const ADAPTERS = ['.claude/commands/fixall.md', 'AGENTS.md', '.github/copilot-instructions.md']

describe('fixall harness parity', () => {
  it.each(ADAPTERS)('%s points at both shared fixall documents', adapter => {
    const source = read(adapter)
    expect(source).toMatch(/docs\/FIXALL_WORKFLOW\.md/)
    expect(source).toMatch(/docs\/FIXALL_WEB\.md/)
  })

  it('the Claude adapter stays an adapter', () => {
    // The 188-line copy is what let the other harnesses miss the rules. A thin
    // adapter has no room for a second copy to drift in.
    expect(read('.claude/commands/fixall.md').split('\n').length).toBeLessThan(40)
  })

  it('the web procedure names no single harness as the one running it', () => {
    const web = read('docs/FIXALL_WEB.md')
    expect(web).toMatch(/--agent <claude\|copilot\|codex>/)
    expect(web).not.toMatch(/--agent claude`/)
  })

  it('every agent run shares one setup and never touches production', () => {
    const setupUse = /uses: \.\/\.github\/actions\/agent-setup/
    for (const wf of ['copilot-setup-steps.yml', 'agent-run.yml']) {
      const source = read(`.github/workflows/${wf}`)
      expect(source, `${wf} must use the shared agent setup`).toMatch(setupUse)
      expect(source, `${wf} must not declare the production environment`).not.toMatch(/^\s*environment:\s*production\s*$/m)
      expect(source, `${wf} must not be able to dispatch a deploy`).not.toMatch(/^\s*actions:\s*write\s*$/m)
    }
  })
})
