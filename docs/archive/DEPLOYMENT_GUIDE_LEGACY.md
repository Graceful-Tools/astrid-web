# Historical Deployment Guide - Vercel Production Deployment

This guide walks you through deploying your task management application to Vercel with the production database.

## 🚀 Pre-Deployment Steps

### 1. Migrate Production Database

First, apply all database migrations and optimizations to your production database:

```bash
npm run db:migrate-production
```

This script will:
- Connect to your production database using `DATABASE_URL_PROD` from `.env.local`
- Apply all pending migrations
- Add performance indexes
- Run optimization checks

### 2. Verify Local Build

Ensure everything builds locally:

```bash
npm run predeploy:essential
```

This runs:
- TypeScript compilation check
- Production build test

## 🔧 Vercel Setup

### 1. Install Vercel CLI (if not already installed)

```bash
npm install -g vercel
```

### 2. Login to Vercel

```bash
vercel login
```

### 3. Link Project (if not already linked)

```bash
vercel link
```

## 🌍 Environment Variables Setup

You need to configure these environment variables in the Vercel dashboard:

### Required Environment Variables

1. **Go to your Vercel dashboard** → Your Project → Settings → Environment Variables

2. **Add these variables for Production:**

```bash
# Database
DATABASE_URL=your_production_database_url_here

# Authentication (generate a new secret for production)
NEXTAUTH_SECRET=your_production_nextauth_secret_here
NEXTAUTH_URL=https://your-app.vercel.app

# Google OAuth (if using Google auth)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Email Service (if using email features)
RESEND_API_KEY=your_resend_api_key_here
FROM_EMAIL=noreply@yourdomain.com

# Redis Cache (optional, improves performance)
UPSTASH_REDIS_REST_URL=your_upstash_redis_url_here
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_token_here

# Optional: Monitoring
ENABLE_LOGGING=true
```

### 3. Environment Variable Sources

**DATABASE_URL**: Use your `DATABASE_URL_PROD` value from `.env.local`

**NEXTAUTH_SECRET**: Generate a new one:
```bash
openssl rand -base64 32
```

**NEXTAUTH_URL**: Will be `https://your-app.vercel.app` (update after first deployment)

## 🚀 Deployment Process

### Option 1: Deploy via CLI (Recommended)

```bash
# Deploy to preview first (optional)
vercel

# Deploy to production
vercel --prod
```

### Option 2: Deploy via Git Integration

1. Push to your main branch
2. Vercel will automatically deploy if connected to GitHub/GitLab

### Option 3: Deploy with Custom Domain

```bash
# Deploy with production flag
vercel --prod

# Add custom domain (optional)
vercel domains add your-domain.com
```

## 🔍 Post-Deployment Verification

### 1. Check Deployment Status

```bash
vercel ls
```

### 2. Test Database Connection

Once deployed, test the database connection:

```bash
# Use your production URL
curl https://your-app.vercel.app/api/health
```

### 3. Run Database Health Check

You can also check the database health via the optimization endpoint if you add one:

```bash
curl https://your-app.vercel.app/api/admin/health
```

### 4. Test Core Functionality

1. **Authentication**: Sign up/sign in
2. **List Creation**: Create a task list
3. **Task Management**: Add, edit, complete tasks
4. **Invitations**: Send and accept invitations
5. **Comments**: Add comments to tasks

### 5. Test Redis Caching (Production)

1. **Check cache is working**:
   ```bash
   # Check Vercel function logs for Redis connection messages
   vercel logs --follow
   ```

2. **Test cache performance**:
   - Load tasks page → Check browser console for "❌ Cache miss" 
   - Refresh immediately → Should show "✅ Cache hit"
   - Create a new task → Cache should invalidate automatically

3. **Verify cache invalidation**:
   - Create/edit/delete tasks
   - Check that changes appear immediately (cache invalidates properly)
   - Lists and tasks should update in real-time

## 🐛 Troubleshooting

### Common Issues

#### 1. Database Connection Issues

**Error**: "Can't reach database server"
**Solution**: 
- Verify `DATABASE_URL` in Vercel environment variables
- Ensure production database allows connections from Vercel IPs
- Check database URL format: `postgresql://user:password@host:port/database`

#### 2. Build Failures

**Error**: "Prisma client not generated"
**Solution**:
- Verify `vercel.json` has correct build command
- Check that Prisma schema is valid
- Ensure all dependencies are in `package.json`

#### 3. Authentication Issues

**Error**: "NextAuth configuration error"
**Solution**:
- Set correct `NEXTAUTH_URL` (your Vercel app URL)
- Generate new `NEXTAUTH_SECRET` for production
- Verify OAuth provider configurations

#### 4. API Timeouts

**Error**: "Function timeout"
**Solution**:
- Increase function timeout in `vercel.json` (already set to 30s)
- Optimize database queries
- Add proper error handling

### Debug Commands

```bash
# Check deployment logs
vercel logs

# Check function logs
vercel logs --follow

# Check build logs
vercel build
```

## 📊 Performance Optimization

### Database Connection Pooling

Your app is configured for optimal Vercel performance:
- Connection pooling enabled
- Max 10 connections in production
- Proper timeout handling

### Monitoring

Add these optional monitoring tools:

1. **Vercel Analytics** (built-in)
2. **Prisma Accelerate** (for database optimization)
3. **Custom monitoring endpoints**

## 🔐 Security Considerations

### Environment Variables

- Never commit `.env` files to Git
- Use different secrets for production
- Regularly rotate authentication secrets

### Database Security

- Use connection pooling
- Enable SSL connections
- Restrict database access to necessary IPs

### API Security

- Rate limiting is implemented
- Input validation on all endpoints
- Proper authentication checks

## 📈 Scaling Considerations

Your app is optimized for scale with:

- **Database indexes** for fast queries
- **Connection pooling** for efficient DB usage  
- **Serverless functions** for automatic scaling
- **Optimized queries** using composite indexes

For high traffic, consider:
- **Prisma Accelerate** for connection pooling
- **Redis caching** for frequently accessed data (already implemented!)
- **CDN integration** for static assets
- **Read replicas** for read-heavy workloads

## 🎯 Deployment Checklist

- [ ] Run `npm run db:migrate-production`
- [ ] Set all environment variables in Vercel dashboard
- [ ] Configure Redis (Upstash) environment variables
- [ ] Test local build with `npm run predeploy:essential`
- [ ] Deploy with `vercel --prod`
- [ ] Update `NEXTAUTH_URL` with actual Vercel URL
- [ ] Test authentication flow
- [ ] Test core functionality (lists, tasks, invitations)
- [ ] **Test Redis caching in production:**
  - [ ] Check browser console for cache hit/miss logs
  - [ ] Test task loading speed (should be faster on repeat loads)
  - [ ] Verify cache invalidation (create/update tasks, check they update immediately)
- [ ] Check database performance with optimized queries
- [ ] Monitor deployment logs for any issues
- [ ] Set up custom domain (optional)

## 🔄 Continuous Deployment

For ongoing deployments:

1. **Git Integration**: Connect repository to Vercel for auto-deployments
2. **Preview Deployments**: Test changes in preview environments
3. **Production Deployments**: Deploy to production after testing
4. **Database Migrations**: Use `npm run db:migrate-production` for schema changes

Your app is now ready for production deployment with high-performance database optimizations and proper Vercel configuration!