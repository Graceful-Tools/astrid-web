# Database Setup Guide

This guide explains how to set up databases for development and production environments.

## 🔧 **Development Setup (Local)**

For local development, you can use either SQLite or PostgreSQL:

### Option 1: SQLite (Simple - Current Development)
```bash
# Create .env.local with:
DATABASE_URL="file:./dev.db"
```

### Option 2: PostgreSQL (Recommended for Production Similarity)
```bash
# Install PostgreSQL locally or use Docker
docker run --name astrid-postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=astrid_dev -p 5432:5432 -d postgres:15

# Create .env.local with:
DATABASE_URL="postgresql://postgres:password@localhost:5432/astrid_dev"
```

## 🚀 **Production Setup (Vercel)**

### Step 1: Choose a Database Provider

#### **Option A: Vercel Postgres (Recommended)**
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Navigate to your project
3. Go to **Storage** tab
4. Click **Create Database** → **Postgres**
5. Choose a plan (Hobby is free for small projects)
6. Vercel will automatically set the `DATABASE_URL` environment variable

#### **Option B: Neon (Free PostgreSQL)**
1. Sign up at [Neon](https://neon.tech)
2. Create a new project
3. Copy the connection string
4. Add to Vercel environment variables

#### **Option C: Supabase (Free PostgreSQL + Features)**
1. Sign up at [Supabase](https://supabase.com)
2. Create a new project
3. Go to Settings → Database
4. Copy the connection string (URI format)
5. Add to Vercel environment variables

#### **Option D: Railway (Free Tier Available)**
1. Sign up at [Railway](https://railway.app)
2. Create a new project
3. Add PostgreSQL service
4. Copy the connection string
5. Add to Vercel environment variables

### Step 2: Configure Environment Variables

In your Vercel project settings, add these environment variables:

```
DATABASE_URL=postgresql://username:password@host:port/database?sslmode=require
NEXTAUTH_SECRET=your-secret-key-here
NEXTAUTH_URL=https://your-app.vercel.app
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

### Step 3: Deploy Database Schema

After setting up your database, you need to push the schema:

```bash
# Generate Prisma client
npx prisma generate

# Push schema to production database
npx prisma db push

# Or run migrations (if you have them)
npx prisma migrate deploy
```

> **Recent migrations:** `perf_indexes` adds performance indexes for frequently queried fields, and `mcp_token_encrypted` adds the `MCPToken.tokenEncrypted` column (AES-256-GCM ciphertext for token reuse, alongside the SHA-256 `token` hash used for lookup). Both are applied by `npx prisma migrate deploy`.

## 🔄 **Migration Commands**

### Development
```bash
# Reset database (careful - deletes all data)
npx prisma db push --force-reset

# Generate client after schema changes
npx prisma generate

# View database in Prisma Studio
npx prisma studio
```

### Production
```bash
# Deploy migrations to production
npx prisma migrate deploy

# Generate client for production
npx prisma generate
```

## 🛠 **Switching Between Databases**

### For Development with PostgreSQL
Update your `.env.local`:
```
DATABASE_URL="postgresql://username:password@localhost:5432/dbname"
```

### For Development with SQLite
Update your `.env.local`:
```
DATABASE_URL="file:./dev.db"
```

## 🔍 **Verifying Database Connection**

Test your database connection:

```javascript
// test-db.js
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  try {
    await prisma.$connect()
    console.log('✅ Database connected successfully')
    
    const userCount = await prisma.user.count()
    console.log(`📊 Users in database: ${userCount}`)
  } catch (error) {
    console.error('❌ Database connection failed:', error)
  } finally {
    await prisma.$disconnect()
  }
}

main()
```

Run with: `node test-db.js`

## 🚨 **Important Notes**

1. **SQLite in Production**: SQLite files cannot be used in Vercel's serverless environment. Always use PostgreSQL for production.

2. **Connection Pooling**: For high-traffic applications, consider using connection pooling:
   ```
   DATABASE_URL="postgresql://username:password@host:port/database?sslmode=require&connection_limit=5"
   ```

3. **SSL Requirements**: Most cloud databases require SSL. Ensure your connection string includes `sslmode=require`.

4. **Environment Variables**: Never commit database credentials to git. Always use environment variables.

5. **Backup Strategy**: Set up regular backups for your production database.

## 🐛 **Common Issues**

### "Unable to open database file"
- **Cause**: SQLite file not accessible in serverless environment
- **Solution**: Switch to PostgreSQL for production

### "Database connection failed"
- **Cause**: Incorrect connection string or network issues  
- **Solution**: Verify connection string format and network access

### "Migration failed"
- **Cause**: Schema conflicts or permission issues
- **Solution**: Review migration files and database permissions

### "Client initialization error"
- **Cause**: Prisma client not generated
- **Solution**: Run `npx prisma generate` before deployment
