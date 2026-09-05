# ASTRID.md Configuration Guide

**Enable robust, consistent AI code generation with project-specific guidelines**

## 🎯 What is ASTRID.md?

ASTRID.md is a configuration file you place in your repository root that tells AI agents how to work on your project. It's like a comprehensive onboarding guide that ensures AI agents:

- ✅ Follow your coding conventions and patterns
- ✅ Use your preferred tools and workflows
- ✅ Meet your quality standards
- ✅ Understand your architecture and design decisions
- ✅ Communicate effectively through task comments

## 🚀 Quick Start

### 1. Download the Template

```bash
# Option 1: Download from Astrid (recommended)
curl -o ASTRID.md https://astrid.cc/astrid-template

# Option 2: From your Astrid settings
# Go to Settings → AI Coding Workflow → Cloud Setup → Step 7
# Click "Download Template"

# Option 3: Copy from this repository (if you have it locally)
cp docs/templates/ASTRID.md ./ASTRID.md
```

### 2. Customize for Your Project

Edit `ASTRID.md` to include your:

- **Technology stack** - Frameworks, libraries, tools
- **Project structure** - Directory organization and purpose
- **Development workflows** - How features are built, bugs are fixed
- **Code conventions** - Naming, imports, patterns
- **Testing requirements** - Coverage standards, test patterns
- **Quality gates** - Lint, type-check, build requirements

### 3. Commit to Your Repository

```bash
git add ASTRID.md
git commit -m "feat: add AI agent configuration"
git push origin main
```

### 4. Test with an AI Agent

1. Create a task in Astrid
2. Assign it to "Astrid Agent"
3. Agent automatically reads ASTRID.md
4. Watch it follow your project-specific guidelines!

## 📋 What to Include in ASTRID.md

### Essential Sections

#### **1. Communication Protocol**
Define how the agent should interact with users:

```markdown
### Communication Protocol
**⚠️ MANDATORY**: ALL communication MUST happen through task comments.
Never assume user approval - always ask and wait for response.
```

#### **2. Development Workflow**
Specify your step-by-step process:

```markdown
### Development Process
1. Analysis & Planning - Read task, explore codebase, create plan
2. User Approval - Wait for "approve" comment
3. Implementation - Create branch, commit changes, create PR
4. User Review - Handle feedback via task comments
```

#### **3. Technology Stack**
List your frameworks and tools:

```markdown
Frontend: Next.js 14 with TypeScript
Backend: Next.js API routes
Database: PostgreSQL with Prisma
Styling: Tailwind CSS + Shadcn/ui
Testing: Vitest with React Testing Library
```

#### **4. Code Quality Standards**
Define quality gates:

```markdown
Before creating PR:
- [ ] Type checking passes (npm run typecheck)
- [ ] Linting passes (npm run lint)
- [ ] Tests pass (npm test)
- [ ] Build succeeds (npm run build)
```

#### **5. File Naming Conventions**
Specify naming patterns:

```markdown
- Components: PascalCase.tsx (UserProfile.tsx)
- Hooks: use-kebab-case.ts (use-auth.ts)
- Utils: kebab-case.ts (date-utils.ts)
- API Routes: kebab-case/route.ts
```

#### **6. Code Patterns**
Show examples to follow:

```typescript
// API Route Structure
export async function POST(request: Request) {
  try {
    // 1. Authentication
    // 2. Input validation
    // 3. Permission check
    // 4. Business logic
    // 5. Response
  } catch (error) {
    // Error handling
  }
}
```

#### **7. Testing Requirements**
Define test expectations:

```markdown
- Critical paths: 100% coverage
- Business logic: 90%+ coverage
- UI components: Test interactions and edge cases
- API endpoints: Test happy path + error cases
```

### Optional but Recommended

- **Project Structure** - Directory organization
- **Common Workflows** - How to add features, fix bugs
- **Error Handling Patterns** - Consistent error management
- **Performance Considerations** - Optimization guidelines
- **Deployment Checklist** - Pre-deployment verification
- **Common Pitfalls** - Known issues and solutions

## 🎨 Real-World Examples

### Example: Next.js Project with Strict Conventions

```markdown
## Code Quality Requirements

Before creating a PR, ensure:

\`\`\`bash
npm run typecheck  # TypeScript must pass
npm run lint       # ESLint must pass
npm test           # All tests must pass
npm run build      # Build must succeed
\`\`\`

## File Naming Conventions

- **Components**: PascalCase.tsx
- **Hooks**: use-kebab-case.ts
- **API Routes**: kebab-case/route.ts

## Import Order

\`\`\`typescript
// 1. External libraries
import { useState } from "react"

// 2. Internal utilities
import { cn } from "@/lib/utils"

// 3. Components
import { Button } from "@/components/ui/button"

// 4. Types
import type { User } from "@/types"
\`\`\`
```

### Example: Python Django Project

```markdown
## Development Workflow

### Step 1: Analysis
1. Read task description
2. Check related models and views
3. Create implementation plan with specific files

### Step 2: Implementation
1. Update models (if needed) + create migration
2. Create/update views and serializers
3. Add URL routes
4. Write tests
5. Run quality checks

## Quality Gates

\`\`\`bash
python manage.py test        # All tests pass
python manage.py makemigrations  # No pending migrations
black .                      # Code formatted
mypy .                       # Type checking passes
\`\`\`
```

### Example: React Component Library

```markdown
## Component Development Standards

### Structure
\`\`\`typescript
// 1. Props interface
interface ButtonProps {
  variant?: 'primary' | 'secondary'
  size?: 'sm' | 'md' | 'lg'
  children: React.ReactNode
}

// 2. Component with default props
export function Button({
  variant = 'primary',
  size = 'md',
  children
}: ButtonProps) {
  // Component logic
}

// 3. Export with displayName
Button.displayName = 'Button'
\`\`\`

### Testing
\`\`\`typescript
describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })

  it('applies variant styles', () => {
    render(<Button variant="primary">Click</Button>)
    expect(screen.getByRole('button')).toHaveClass('btn-primary')
  })
})
\`\`\`
```

## 🔧 How It Works

### Agent Workflow with ASTRID.md

1. **Task Assignment**
   - User assigns task to AI agent
   - Agent triggered via cloud workflow or local MCP

2. **Context Loading**
   - Agent automatically checks for `ASTRID.md` in repository root
   - Reads and parses project-specific guidelines
   - Combines with base agent instructions

3. **Implementation**
   - Agent follows ASTRID.md guidelines for:
     - Communication patterns (task comments)
     - Code structure and conventions
     - Testing requirements
     - Quality gates
   - Posts updates via task comments

4. **Quality Assurance**
   - Agent runs checks specified in ASTRID.md
   - Ensures all quality gates pass
   - Creates PR with comprehensive description

5. **User Review**
   - User reviews code and preview deployment
   - Provides feedback via task comments
   - Agent responds and updates as needed

## 📊 Benefits

### For Development Teams

- **Consistency** - All AI-generated code follows same patterns
- **Quality** - Enforced quality gates and testing standards
- **Onboarding** - New team members see conventions clearly
- **Documentation** - Living guide to project standards

### For AI Agents

- **Context** - Understands project-specific requirements
- **Guidance** - Clear instructions for every step
- **Patterns** - Examples to follow for common tasks
- **Quality** - Knows exactly what checks to run

### For Users

- **Predictability** - Agent behavior is consistent and documented
- **Control** - Define exactly how you want code generated
- **Transparency** - All communication via task comments
- **Reliability** - Quality gates ensure production-ready code

## 🚨 Best Practices

### 1. Keep It Current
```markdown
**Update ASTRID.md as your project evolves:**
- New patterns or conventions
- Changed quality requirements
- Updated deployment processes
- Lessons learned from issues
```

### 2. Be Specific
```markdown
**Provide concrete examples:**
❌ "Use good naming conventions"
✅ "Components: PascalCase.tsx, Hooks: use-kebab-case.ts"

❌ "Write tests"
✅ "Write tests for all user-facing features with >90% coverage"
```

### 3. Prioritize Critical Information
```markdown
**Most important sections:**
1. Communication protocol (how to interact)
2. Quality gates (what must pass)
3. Code patterns (how to structure code)
4. Testing requirements (what to test)
```

### 4. Include Examples
```markdown
**Show, don't just tell:**
- Include code snippets for patterns
- Show API route structure
- Demonstrate component patterns
- Provide test examples
```

### 5. Document Common Issues
```markdown
**Prevent repeated mistakes:**
- List known pitfalls
- Explain solutions
- Reference relevant docs
```

## 🔗 Integration with Astrid Workflow

### Local Workflow (MCP)

1. Configure MCP in your AI client (Claude Desktop, Cursor, etc.)
2. Add ASTRID.md to your repository
3. AI client reads ASTRID.md via MCP when working on tasks
4. Agent follows project guidelines automatically

### Cloud Workflow (GitHub Actions)

1. Set up cloud workflow in Astrid settings
2. Add ASTRID.md to your repository
3. Agent reads ASTRID.md when assigned to tasks
4. All communication via task comments
5. Automatic PR creation with preview deployments

## 📚 Additional Resources

- **[ASTRID.md Template](../templates/ASTRID.md)** - Comprehensive template to start from
- **[AI Agents Overview](./README.md)** - Complete AI agent setup guide
- **[Cloud Workflow Setup](../../app/[locale]/settings/coding-integration/page.tsx)** - Cloud integration instructions
- **[MCP Testing Guide](../testing/MCP_TESTING_GUIDE.md)** - Local MCP setup and testing

## ❓ FAQ

**Q: Is ASTRID.md required?**
A: No, but highly recommended. Without it, the agent uses generic best practices.

**Q: Can I use ASTRID.md with other AI agents?**
A: Yes! It's a standard markdown file that any AI agent can read and follow.

**Q: How often should I update ASTRID.md?**
A: Update it whenever you establish new patterns, change workflows, or learn from issues.

**Q: Can I have different ASTRID.md for different branches?**
A: Yes, the agent reads from the branch it's working on.

**Q: What happens if ASTRID.md conflicts with base instructions?**
A: Project-specific guidelines in ASTRID.md take precedence.

**Q: Can I include sensitive information in ASTRID.md?**
A: No, ASTRID.md is committed to your repository. Keep secrets in environment variables.

---

**Start using ASTRID.md today to enable robust, consistent AI code generation tailored to your project!**
