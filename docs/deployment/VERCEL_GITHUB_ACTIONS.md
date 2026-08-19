# Vercel Deployment via GitHub Actions

This document explains how Astrid deploys to Vercel using GitHub Actions
workflows instead of Vercel's automatic Git integration.

> **Two separate facts, routinely conflated — and the conflation has produced
> three wrong versions of the deploy rule:**
>
> 1. **Why Actions rather than Vercel's Git integration** — the integration
>    blocks commits authored by an email with no Vercel account, which is every
>    AI-agent commit. That is what the rest of this page is about.
> 2. **Why production deploys are manual** — because
>    `production-deployment.yml` is `workflow_dispatch` only. Nothing to do with
>    the Git integration.
>
> Turning the Git integration off did NOT make deploys manual. While the
> workflow still had `push: [main]`, merging deployed production and applied
> migrations, with the integration off the whole time. Reasoning from
> "integration is off" (or from `source=cli` in the deployment list) to "nothing
> deploys automatically" is exactly the mistake that shipped five unreviewed
> migrations.

## Why GitHub Actions Instead of Vercel Git Integration?

**Problem:** Vercel's automatic Git integration tries to deploy commits from all contributors, including automated agents. When commits are authored by `ai-agent@astrid.cc` (an email without a Vercel account), Vercel blocks the deployment with:

```
The git deployment is blocked due to insufficient permissions.
The github user ai-agent@astrid.cc does not have an account on Vercel.
```

**Solution:** We disable Vercel's Git integration and use GitHub Actions workflows to control all deployments. These workflows use a Vercel service token (`VERCEL_TOKEN`) that has proper permissions, bypassing the user authentication issue.

## Architecture

### Deployment Flow

```
Code Push → GitHub → GitHub Actions → Vercel CLI → Vercel Deployment
```

### Key Components

1. **GitHub Actions Workflows** (`.github/workflows/`)
   - `production-deployment.yml` - Deploys to production
   - `preview-deployment.yml` - Creates preview deployments for PRs (with custom `*.astrid.cc` aliases)

2. **Vercel CLI** - Used by workflows to deploy via service token
3. **Vercel Service Token** - Stored in GitHub secrets as `VERCEL_TOKEN`

## Setup Instructions

### Quick Setup (Recommended)

Run the automated setup script:

```bash
# Install GitHub CLI if not already installed
brew install gh
gh auth login

# Run the setup script
npm run setup:github-secrets
```

This script will configure all required GitHub secrets automatically.

### Manual Setup

#### 1. Disable Vercel's Automatic Git Integration

This is a **critical step** to prevent the "insufficient permissions" error:

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Git**
3. Find the section for **Git Integration** or **Automatic Deployments**
4. **Disable** or **Disconnect** the Git integration
5. Save the changes

**Result:** Vercel will no longer try to automatically deploy on git pushes. All deployments will be controlled by GitHub Actions.

#### 2. Configure GitHub Secrets

The following secrets are required in your GitHub repository (Settings → Secrets and variables → Actions):

##### Vercel Configuration (Pre-configured values)

| Secret Name | Value | Description |
|-------------|-------|-------------|
| `VERCEL_TOKEN` | *(your token)* | Service token from Vercel |
| `VERCEL_ORG_ID` | `team_gFxp7fWaX7e8tUPt8Vt3YXl0` | Jon Paris' projects team ID |
| `VERCEL_PROJECT_ID` | `prj_MUWxfWJ9lIZOi2clHPZhlHsYqSiy` | Production (astrid.cc) |
| `VERCEL_TEAM_ID` | `team_gFxp7fWaX7e8tUPt8Vt3YXl0` | Same as ORG_ID |

##### Database Configuration

| Secret Name | Description |
|-------------|-------------|
| `DATABASE_URL` | Production database URL (from .env.local `DATABASE_URL_PROD`) |

##### Astrid Integration (for AI Agent)

| Secret Name | Description |
|-------------|-------------|
| `ASTRID_OAUTH_CLIENT_ID` | OAuth client ID from astrid.cc |
| `ASTRID_OAUTH_CLIENT_SECRET` | OAuth client secret |
| `ASTRID_MCP_TOKEN` | MCP token for AI agent authentication |

#### 3. Create Vercel Service Token

1. Go to [Vercel Account Settings → Tokens](https://vercel.com/account/tokens)
2. Click **Create Token**
3. Name it something descriptive like "GitHub Actions Deployment"
4. Select the appropriate scope:
   - **Full Access** (recommended for automated deployments)
   - Or limit to specific projects
5. Copy the token immediately (you won't see it again)
6. Add it to GitHub secrets as `VERCEL_TOKEN`

### 4. Verify Workflow Configuration

Check that your workflows have proper git configuration for any steps that create commits:

```yaml
- name: Auto-commit fixes
  run: |
    git config --local user.email "action@github.com"
    git config --local user.name "GitHub Action"

    # Your commit logic here
```

**Important:** Never use `ai-agent@astrid.cc` or any email without a Vercel account as the git committer in workflows that trigger deployments.

## Triggering Deployments

### From Local CLI (Command Line)

```bash
# Deploy to production (dispatches the workflow — pushing alone does nothing)
npm run deploy:production

# Trigger any workflow manually
npm run deploy:trigger production    # Production deployment
npm run deploy:trigger preview       # Preview deployment
npm run deploy:trigger ai-agent --task-id <taskId>  # AI agent workflow
npm run deploy:trigger monitor       # Run deployment monitoring
```

### From Cloud AI Agent (astrid.cc)

The Astrid AI Coding Agent at `astrid.cc/settings/coding-integration` can trigger deployments via:

1. **Automatic PR Previews**: When the AI creates a PR, the `preview-deployment.yml` workflow automatically creates a preview URL
2. **Production Deployment**: `production-deployment.yml` must be dispatched deliberately. Merging a PR to main does NOT trigger it.
3. **Manual Trigger**: The AI agent can trigger workflows via the `repository_dispatch` event

The cloud agent uses the `ASTRID_MCP_TOKEN` secret to authenticate and the workflows communicate back via webhooks to update task status.

### From GitHub UI

1. Go to [Actions](https://github.com/Graceful-Tools/astrid-res-www/actions)
2. Select the workflow you want to run
3. Click "Run workflow"
4. Configure options if needed
5. Click "Run workflow"

---

## Deployment Workflows

### Production Deployment

**File:** `.github/workflows/production-deployment.yml`

**Trigger:** `workflow_dispatch` ONLY — a human (or `gh workflow run`) starts it.

> **Pushing to `main` does not deploy, and merging a PR does not deploy.** Both
> used to (`push: [main]` with no path filter, and `pull_request: closed`, which
> fired even for PRs closed *unmerged*). PR #204 removed both triggers.
>
> Check the workflow file itself, never the Vercel deployment list — an Actions
> deploy goes out through the Vercel CLI and appears there as `source=cli`,
> indistinguishable from a hand-run one. Misreading that list is what produced
> three wrong versions of this rule:
>
> ```bash
> gh run list --workflow=production-deployment.yml --limit 5
> sed -n '1,25p' .github/workflows/production-deployment.yml
> ```

**Steps:**
1. Quality gates (tests, linting, typecheck)
2. Database migrations
3. Deploy to Vercel production
4. Health checks
5. Update AI tasks (if applicable)

**Usage:**
```bash
# There is no automatic path. Pushing to main ships nothing.

# Manual via npm script
npm run deploy:production

# Manual via GitHub CLI
gh workflow run production-deployment.yml
```

### Preview Deployment

**File:** `.github/workflows/preview-deployment.yml`

**Triggers:**
- Pull request opened/updated
- Manual workflow dispatch

**Purpose:** Creates preview deployments with custom `*.astrid.cc` aliases (e.g., `feature-xyz.astrid.cc`) for testing PRs before merging. Preview URLs are automatically posted to task comments.

## Monitoring and Debugging

### Check Deployment Status

**GitHub Actions:**
```bash
# View recent workflow runs
https://github.com/YOUR_USERNAME/YOUR_REPO/actions

# View specific workflow
https://github.com/YOUR_USERNAME/YOUR_REPO/actions/workflows/production-deployment.yml
```

**Vercel Dashboard:**
```bash
# View deployment history
https://vercel.com/YOUR_USERNAME/YOUR_PROJECT/deployments
```

### Common Issues

#### Issue: "Insufficient permissions" error from Vercel

**Cause:** Vercel's Git integration is still enabled and trying to deploy automatically.

**Fix:**
1. Disable Vercel Git integration (see Setup step 1)
2. Ensure GitHub Actions workflows are using `VERCEL_TOKEN`

#### Issue: GitHub Actions workflows failing with authentication errors

**Cause:** `VERCEL_TOKEN` is missing, invalid, or expired.

**Fix:**
1. Regenerate token in Vercel → Account Settings → Tokens
2. Update `VERCEL_TOKEN` in GitHub secrets
3. Re-run the workflow

#### Issue: Deployments succeeding but not showing in Vercel

**Cause:** Wrong `VERCEL_ORG_ID` or `VERCEL_PROJECT_ID`.

**Fix:**
1. Verify IDs in Vercel project settings
2. Update GitHub secrets with correct IDs
3. Re-run the workflow

#### Issue: Database migrations failing

**Cause:** `DATABASE_URL` not set or incorrect.

**Fix:**
1. Verify database URL in Vercel environment variables
2. Add `DATABASE_URL` to GitHub secrets
3. Re-run the workflow

### Debugging Tips

**View detailed workflow logs:**
```bash
# Go to Actions tab in GitHub
# Click on the workflow run
# Click on individual job to see detailed logs
```

**Test Vercel CLI authentication locally:**
```bash
export VERCEL_TOKEN="your-token-here"
vercel whoami --token=$VERCEL_TOKEN
```

**Check Vercel deployment logs:**
```bash
# In Vercel dashboard, click on deployment
# View "Logs" tab for build and runtime logs
```

## Git Committer Identity

### Why This Matters

When commits are pushed to GitHub, Vercel (if Git integration is enabled) checks the committer's email against Vercel user accounts. If the email doesn't have a Vercel account, deployments are blocked.

### Best Practices

**Use GitHub Actions bot identity:**
```yaml
git config --local user.email "action@github.com"
git config --local user.name "GitHub Action"
```

or

```yaml
git config --local user.email "github-actions[bot]@users.noreply.github.com"
git config --local user.name "github-actions[bot]"
```

**Don't use:**
```yaml
# AVOID: Email without Vercel account
git config --local user.email "ai-agent@astrid.cc"
```

### Current Workflow Configuration

Our workflows use proper git configuration:

- `monitor-deployments.yml:181-182` - Uses `action@github.com` ✅
- Other workflows don't create commits, so no configuration needed ✅

## Maintenance

### Rotating Vercel Token

Periodically rotate the `VERCEL_TOKEN` for security:

1. Create new token in Vercel dashboard
2. Update `VERCEL_TOKEN` in GitHub secrets
3. Test deployments work with new token
4. Revoke old token in Vercel dashboard

### Updating Workflows

When modifying deployment workflows:

1. Test changes on a feature branch first
2. Use `workflow_dispatch` to manually trigger and test
3. Monitor deployment logs carefully
4. Verify health checks pass

### Adding New Environments

To add a new environment (e.g., "development"):

1. Create new Vercel project or environment
2. Get project ID from Vercel settings
3. Add `VERCEL_PROJECT_ID_DEVELOPMENT` to GitHub secrets
4. Copy and modify existing workflow file
5. Update environment variables in workflow

## Security Considerations

### Secrets Management

- **Never** commit tokens or secrets to git
- Use GitHub's encrypted secrets feature
- Rotate tokens regularly (every 90 days recommended)
- Use least-privilege tokens (limit to specific projects)

### Access Control

- Limit GitHub Actions permissions to necessary scopes
- Review workflow permissions regularly
- Use `GITHUB_TOKEN` with minimal permissions
- Require PR reviews before merging to `main`

### Audit Trail

- All deployments are logged in GitHub Actions
- Vercel maintains deployment history
- Use commit messages to track changes
- Tag production releases for easy rollback

## Rollback Procedures

### Quick Rollback via Vercel Dashboard

1. Go to Vercel project → Deployments
2. Find the last known good deployment
3. Click "..." → "Promote to Production"

### Rollback via Git

```bash
# Find the commit to roll back to
git log --oneline

# Create rollback commit
git revert <commit-hash>
git push origin main

# Or reset to previous commit (use with caution)
git reset --hard <commit-hash>
git push --force origin main
```

### Rollback via GitHub Actions

Use manual workflow dispatch to redeploy a specific commit:

1. Go to Actions → Production Deployment
2. Click "Run workflow"
3. Select the branch/tag to deploy
4. Run workflow

## Resources

- [Vercel CLI Documentation](https://vercel.com/docs/cli)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Vercel Deployment Documentation](https://vercel.com/docs/deployments)
- [Vercel API Tokens](https://vercel.com/docs/rest-api#authentication)

## Support

If you encounter issues not covered in this guide:

1. Check GitHub Actions logs for detailed error messages
2. Review Vercel deployment logs in dashboard
3. Verify all secrets are correctly configured
4. Test Vercel CLI authentication locally
5. Contact your team lead or DevOps engineer

---

**Last Updated:** 2025-12-16
**Maintained By:** Astrid Development Team
