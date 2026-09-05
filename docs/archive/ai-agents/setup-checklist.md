# 📋 Astrid Agent Setup Checklist

Use this checklist to ensure you complete all setup steps correctly.

## **Pre-Setup Requirements**
- [ ] Astrid account with admin access
- [ ] GitHub repository with admin permissions
- [ ] AI service account (Claude/OpenAI/Gemini)

## **1. AI Service Configuration**
- [ ] Navigate to User Settings → API Keys
- [ ] Add AI service API key:
  - [ ] Claude API key (from console.anthropic.com)
  - [ ] OR OpenAI API key (from platform.openai.com)
  - [ ] OR Gemini API key (from aistudio.google.com)
- [ ] Test connection works
- [ ] Save configuration

## **2. GitHub App Creation**
- [ ] Go to GitHub → Settings → Developer settings → GitHub Apps
- [ ] Click "New GitHub App"
- [ ] Fill in app details:
  - [ ] App name: `astrid-code-assistant-[your-username]`
  - [ ] Homepage URL: `http://localhost:3000`
  - [ ] Webhook URL: `http://localhost:3000/api/github/webhook`
  - [ ] Generate webhook secret (save it!)
- [ ] Set repository permissions:
  - [ ] Contents: Read & Write
  - [ ] Issues: Read & Write
  - [ ] Metadata: Read
  - [ ] Pull requests: Read & Write
  - [ ] Checks: Read & Write
- [ ] Subscribe to events:
  - [ ] Issue comments
  - [ ] Pull requests
  - [ ] Check runs
  - [ ] Check suites
  - [ ] Push
- [ ] Set to "Only on this account"
- [ ] Create app and save App ID
- [ ] Generate and download private key (.pem file)

## **3. Environment Configuration**
- [ ] Copy .pem file to project root as `github-app-private-key.pem`
- [ ] Run: `node scripts/setup-private-key.js`
- [ ] Add to .env.local:
  - [ ] `GITHUB_APP_ID=your_app_id`
  - [ ] `GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."`
  - [ ] `GITHUB_WEBHOOK_SECRET=your_webhook_secret`
- [ ] Restart development server

## **4. GitHub App Installation**
- [ ] Go to GitHub App settings
- [ ] Click "Install App"
- [ ] Select your account/organization
- [ ] Choose "Selected repositories"
- [ ] Select target repository
- [ ] Complete installation
- [ ] Note the Installation ID from URL

## **5. Coding Agent Creation**
- [ ] Run: `DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx tsx scripts/create-coding-agent.ts`
- [ ] Verify output shows:
  - [ ] ✅ Coding Agent created successfully
  - [ ] ✅ Default coding list created
  - [ ] ✅ MCP tokens configured
  - [ ] 🤖 Astrid Agent is ready!

## **6. GitHub Integration Connection**
- [ ] Go to User Settings → GitHub Integration
- [ ] Click "Connect GitHub App"
- [ ] Enter GitHub App details:
  - [ ] App ID
  - [ ] Installation ID
  - [ ] Private Key (formatted)
  - [ ] Webhook Secret
- [ ] Select repositories to enable
- [ ] Save configuration

## **7. Staging & Preview Links (Optional)**
- [ ] **Vercel (Web Previews):**
  - [ ] Add `VERCEL_TOKEN` to .env.local
  - [ ] Verify Vercel GitHub integration is enabled
- [ ] **iOS TestFlight (choose one):**
  - [ ] **Option A - Simple:** Add `TESTFLIGHT_PUBLIC_LINK` to .env.local
  - [ ] **Option B - Advanced:** Configure App Store Connect API:
    - [ ] Create API key at App Store Connect → Users and Access → Keys
    - [ ] Download .p8 file
    - [ ] Add `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_APP_ID`, `ASC_PRIVATE_KEY` to .env.local
- [ ] Run test: `npx tsx scripts/test-staging-links.ts`

## **8. Testing & Verification**
- [ ] Create test task: "Create a Button component"
- [ ] Assign to "Astrid Agent" (should appear in dropdown)
- [ ] Verify implementation plan is generated
- [ ] Reply with "approve"
- [ ] Check GitHub for new branch and PR
- [ ] Verify code quality and completeness
- [ ] Optional: Reply with "merge" to test merge flow

## **9. Troubleshooting (if needed)**
- [ ] Run debug scripts if issues occur:
  - [ ] `npx tsx scripts/test-ai-agent-workflow.ts`
  - [ ] `npx tsx scripts/test-github-integration.ts`
  - [ ] `npx tsx scripts/test-complete-ai-workflow.ts`
- [ ] Check browser console for errors
- [ ] Verify all environment variables are set
- [ ] Confirm GitHub App permissions are correct

---

## ✅ **Setup Complete!**

When all items above are checked, your Astrid Agent is ready to:
- 🤖 Analyze coding tasks automatically
- 📝 Generate detailed implementation plans
- 💻 Write production-ready code
- 🔄 Manage GitHub workflows
- 🚀 Deploy changes via PR workflow

**Happy coding with your AI assistant!** 🎉