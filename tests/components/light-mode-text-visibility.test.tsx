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

  it('should not use hard-coded gray classes in task-detail.tsx', () => {
    // Read the task detail component file
    const componentPath = path.join(process.cwd(), 'components/task-detail.tsx')
    const componentContent = fs.readFileSync(componentPath, 'utf-8')

    // Check for problematic hardcoded gray classes that were replaced
    const problematicPatterns = [
      /text-gray-300(?!\w)/, // text-gray-300 but not text-gray-300-something
      /text-gray-400(?!\w)/, // text-gray-400 but not text-gray-400-something
      /text-gray-500(?!\w)/, // text-gray-500 but not text-gray-500-something
    ]

    problematicPatterns.forEach((pattern) => {
      const matches = componentContent.match(new RegExp(pattern.source, 'g'))
      if (matches) {
        expect(matches.length).toBe(0,
          `Found ${matches.length} instances of problematic gray text classes. Should use theme classes instead.`
        )
      }
    })

    // Ensure we're using theme classes instead
    expect(componentContent).toContain('theme-text-muted')
    expect(componentContent).toContain('theme-text-secondary')
    expect(componentContent).toContain('theme-text-primary')
  })

  it('should verify theme classes are properly used for key UI elements', () => {
    const componentPath = path.join(process.cwd(), 'components/task-detail.tsx')
    const componentContent = fs.readFileSync(componentPath, 'utf-8')
    const commentSectionPath = path.join(process.cwd(), 'components/task-detail/CommentSection.tsx')
    const commentSectionContent = fs.readFileSync(commentSectionPath, 'utf-8')

    // Check specific fixes were applied:

    // 1. Comments section should use theme-text-muted (now in CommentSection component)
    expect(commentSectionContent).toMatch(/className="text-sm theme-text-muted">Comments/)

    // 2. Chat bubble meta should use theme-text-muted (now in CommentSection component)
    expect(commentSectionContent).toMatch(/chat-bubble-meta theme-text-muted/)

    // 3. Task title when completed should use theme-text-muted
    expect(componentContent).toMatch(/line-through theme-text-muted/)
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