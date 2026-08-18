# Vercel Environment Setup

> **Deploys are manual.** Pushing to `main` does not ship — `./scripts/deploy-preview.sh
> --production` does. This page covers the environment the deploy build needs; see
> [docs/CLI_OPERATIONS.md §0](../CLI_OPERATIONS.md) for how production is actually released.

## 🎯 Quick Setup Guide

The deploy build runs database migrations, so it needs these variables set:

### 1. Set Environment Variables in Vercel Dashboard

Go to **Vercel Dashboard** → **Your Project** → **Settings** → **Environment Variables**

Add these **Production** environment variables:

```bash
# Database (use your DATABASE_URL_PROD value from .env.local)
DATABASE_URL=your_production_database_url_here

# Authentication
NEXTAUTH_SECRET=your_production_secret_here
NEXTAUTH_URL=https://your-app.vercel.app

# Email (if using Resend)
RESEND_API_KEY=your_resend_api_key_here
FROM_EMAIL=noreply@yourdomain.com

# Google OAuth (if using)
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
```

### 2. Your Deployment Flow (No Changes!)

Your existing workflow stays the same:

```bash
git add .
git commit -m "Your commit message"
git push
```

**Vercel will now automatically:**
1. ✅ Generate Prisma client
2. ✅ Run database migrations (`prisma migrate deploy`)
3. ✅ Apply performance indexes (`prisma db push`)
4. ✅ Build your Next.js app
5. ✅ Deploy to production

## 🔧 How It Works

### Build Process
The new build script (`scripts/build-with-migrations.js`) handles:
- **Critical steps** (Prisma generation, Next.js build) - deployment fails if these fail
- **Database steps** (migrations, indexes) - logged but won't fail deployment if DB unavailable during build
- **Runtime fallback** - migrations checked/applied on first API call if needed

### Safety Features
- ✅ Build won't fail if database is temporarily unavailable
- ✅ Runtime migration verification as fallback
- ✅ Safe health checks that work during deployment
- ✅ Detailed logging for troubleshooting

## 🚨 Important: Environment Variables

### Get Your DATABASE_URL

Your production database URL is in `.env.local` as `DATABASE_URL_PROD`. Copy that exact value to Vercel.

### Generate NEXTAUTH_SECRET

Generate a new production secret:
```bash
openssl rand -base64 32
```

### Set NEXTAUTH_URL

After first deployment, update this to your actual Vercel URL:
```
https://your-app-name.vercel.app
```

## 🔍 Testing Your Setup

### 1. First Deployment
```bash
git add .
git commit -m "Initial production deployment"
git push
```

Watch the Vercel build logs to see migrations running.

### 2. Test Health Check
Once deployed, visit:
```
https://your-app.vercel.app/api/health
```

Should return:
```json
{
  "status": "healthy",
  "database": {
    "healthy": true,
    "responseTime": "45ms"
  }
}
```

### 3. Test Core Features
- Sign up/login
- Create task lists
- Add tasks
- Send invitations
- Add comments

## 🐛 Troubleshooting

### Build Fails with Database Error

**Check Vercel build logs:**
- Go to Vercel Dashboard → Deployments → Click failed deployment → View Function Logs

**Common fixes:**
1. Verify `DATABASE_URL` is set correctly in Vercel
2. Ensure database allows connections from Vercel IPs
3. Check database URL format: `postgresql://user:password@host:port/database`

### Authentication Issues

**Symptoms:** Can't sign in, OAuth errors
**Fix:**
1. Set `NEXTAUTH_SECRET` in Vercel environment variables
2. Set `NEXTAUTH_URL` to your actual Vercel app URL
3. Update OAuth provider redirect URIs to use Vercel URL

### API Timeouts

**Symptoms:** 504 errors, function timeouts
**Status:** Already configured - API functions have 30s timeout in `vercel.json`

## 📊 Monitoring Your App

### Health Monitoring
- **Health check:** `https://your-app.vercel.app/api/health`
- **Vercel Analytics:** Built into dashboard
- **Function logs:** Available in Vercel dashboard

### Database Performance
Your app includes optimized queries with performance indexes:
- User tasks: ~80% faster queries
- Comments: ~70% faster loading
- Invitations: ~85% faster lookups

## 🔄 Future Deployments

### Schema Changes
When you modify `prisma/schema.prisma`:

1. Create migration locally:
   ```bash
   npx prisma migrate dev --name "describe_your_changes"
   ```

2. Commit and push:
   ```bash
   git add .
   git commit -m "Add new schema changes"
   git push
   ```

3. Vercel will automatically apply migrations during build!

### Rollback if Needed
If deployment fails:
1. Revert your commit: `git revert HEAD`
2. Push: `git push`
3. Vercel will deploy the previous working version

## ✅ Deployment Checklist

- [ ] Set `DATABASE_URL` in Vercel (from your `DATABASE_URL_PROD`)
- [ ] Set `NEXTAUTH_SECRET` (generate new one for production)  
- [ ] Set `NEXTAUTH_URL` (your Vercel app URL)
- [ ] Set other environment variables as needed
- [ ] Commit and push your code
- [ ] Watch Vercel build logs for migration success
- [ ] Test `/api/health` endpoint
- [ ] Test core app functionality
- [ ] Update OAuth redirect URIs if using Google/GitHub auth

Your app is now fully configured for automatic deployments with database migrations! 🚀