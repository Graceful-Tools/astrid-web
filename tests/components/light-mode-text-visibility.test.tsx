import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('Light Mode Text Visibility Regression Test', () => {
  it('should ensure light mode theme-text-muted has readable color value', () => {
    // Read the light theme CSS file
    const cssPath = path.join(process.cwd(), 'styles/themes/light-theme.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    // Check that theme-text-muted is set to a darker, more readable value
    const themeTextMutedMatch = cssContent.match(/--theme-text-muted:\s*([^;]+);/)
    expect(themeTextMutedMatch).toBeTruthy()

    const colorValue = themeTextMutedMatch![1].trim()
    expect(colorValue).toBe('107, 114, 128') // Should be the darker value, not 156, 163, 175

    // Ensure it's not the old problematic light gray
    expect(colorValue).not.toBe('156, 163, 175')
  })

  it('should not use hard-coded gray classes in task-detail tree', () => {
    // task-detail UI has been split across task-detail.tsx + task-detail/*.tsx
    // (TaskActionMenu, TaskHeader, TaskFieldEditors, TaskModals, CommentSection).
    // Scan the whole tree so the regression rule keeps holding as more pieces
    // are extracted.
    const root = process.cwd()
    const files = [
      path.join(root, 'components/task-detail.tsx'),
      ...fs.readdirSync(path.join(root, 'components/task-detail'))
        .filter(f => f.endsWith('.tsx') || f.endsWith('.ts'))
        .map(f => path.join(root, 'components/task-detail', f)),
    ]
    const combined = files.map(f => fs.readFileSync(f, 'utf-8')).join('\n')

    const problematicPatterns = [
      /text-gray-300(?!\w)/g,
      /text-gray-400(?!\w)/g,
      /text-gray-500(?!\w)/g,
    ]

    for (const pattern of problematicPatterns) {
      const matches = combined.match(pattern)
      expect(matches?.length ?? 0).toBe(0)
    }

    // Theme classes must still appear somewhere in the tree
    expect(combined).toContain('theme-text-muted')
    expect(combined).toContain('theme-text-secondary')
    expect(combined).toContain('theme-text-primary')
  })

  it('should verify theme classes are properly used for key UI elements', () => {
    const root = process.cwd()
    const taskDetailFiles = [
      fs.readFileSync(path.join(root, 'components/task-detail.tsx'), 'utf-8'),
      ...fs.readdirSync(path.join(root, 'components/task-detail'))
        .filter(f => f.endsWith('.tsx'))
        .map(f => fs.readFileSync(path.join(root, 'components/task-detail', f), 'utf-8')),
    ].join('\n')

    // 1. Comments section should use theme-text-muted (lives in CommentSection now)
    expect(taskDetailFiles).toMatch(/className="text-sm theme-text-muted">Comments/)

    // 2. Chat bubble meta should use theme-text-muted (in shared MessageBubble)
    const messageBubblePath = path.join(root, 'components/shared/MessageBubble.tsx')
    const messageBubbleContent = fs.readFileSync(messageBubblePath, 'utf-8')
    expect(messageBubbleContent).toMatch(/chat-bubble-meta theme-text-muted/)

    // 3. Task title when completed should use theme-text-muted (now in TaskHeader)
    expect(taskDetailFiles).toMatch(/line-through theme-text-muted/)
  })

  it('should verify CSS classes are semantically correct', () => {
    const cssPath = path.join(process.cwd(), 'styles/themes/light-theme.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    // Verify that the light theme has proper text hierarchy
    expect(cssContent).toMatch(/--theme-text-primary:\s*17,\s*24,\s*39/) // Dark for primary text
    expect(cssContent).toMatch(/--theme-text-secondary:\s*75,\s*85,\s*99/) // Medium for secondary text
    expect(cssContent).toMatch(/--theme-text-muted:\s*107,\s*114,\s*128/) // Readable muted text (not too light)

    // Ensure the CSS classes are defined
    expect(cssContent).toContain('.light .theme-text-muted { color: rgb(var(--theme-text-muted)); }')
    expect(cssContent).toContain('.light .theme-text-secondary { color: rgb(var(--theme-text-secondary)); }')
    expect(cssContent).toContain('.light .theme-text-primary { color: rgb(var(--theme-text-primary)); }')
  })
})