# ⚡ Quick Start Guide

**Get your Astrid Agent running in 10 minutes!**

## 🚀 **Essential Steps Only**

### **1. Setup AI Service (2 minutes)**
```bash
# Go to User Settings → API Keys
# Add one of these:
- Claude: console.anthropic.com
- OpenAI: platform.openai.com
- Gemini: aistudio.google.com
```

### **2. Create GitHub App (3 minutes)**
```bash
# GitHub → Settings → Developer settings → GitHub Apps
App name: astrid-code-assistant-[username]
Homepage: http://localhost:3000
Webhook: http://localhost:3000/api/github/webhook
Permissions: Contents, Issues, PRs (Read & Write)
Events: Issue comments, Pull requests, Push
```

### **3. Setup Environment (2 minutes)**
```bash
# Download .pem file, then:
cp ~/Downloads/*.pem ./github-app-private-key.pem
node scripts/setup-private-key.js

# Add to .env.local:
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."
GITHUB_WEBHOOK_SECRET=your_secret
```

### **4. Create Agent (1 minute)**
```bash
DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev" npx tsx scripts/create-coding-agent.ts
```

### **5. Connect GitHub (1 minute)**
```bash
# User Settings → GitHub Integration
# Enter: App ID, Installation ID, Private Key, Webhook Secret
# Select your repository
```

### **6. Test It! (1 minute)**
```bash
# Create task: "Build a Button component"
# Assign to: "Astrid Agent"
# Reply: "approve"
# Check GitHub for new PR!
```

---

## ✅ **That's It!**

Your AI coding assistant is now ready to:
- Generate implementation plans
- Write production code
- Create GitHub PRs
- Handle approvals via comments

**See the full [README.md](./README.md) for detailed instructions and troubleshooting.**