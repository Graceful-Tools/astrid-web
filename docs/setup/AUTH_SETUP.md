# Authentication Setup Guide

This guide covers setting up authentication for both development and production environments.

## Current Authentication Flow

The app uses **NextAuth.js** with the following authentication methods:

1. **Google OAuth**: Sign in with Google account (automatic email verification)
2. **WebAuthn passkeys**: Passwordless sign-in/sign-up with platform authenticator
3. **Apple Sign-In** (iOS only): Custom endpoint at `/api/auth/apple` that verifies Apple identity tokens against Apple's JWKS (issuer + signature) plus `aud` (must equal our client id), `email`, and `email_verified`. The iOS Google path (`/api/auth/google`) similarly verifies the Google `idToken` (`aud` + `email_verified`).
4. **Invitations**: Users can be invited to lists via email (creates placeholder users if email not registered)

Email/password authentication was removed in 2026-04. See `docs/AUTHENTICATION.md` for the full architecture.

## Environment Variables Required

### Production (Vercel)

Set these environment variables in your Vercel project settings:

```bash
# NextAuth Configuration
NEXTAUTH_SECRET=your-super-secret-random-string-here
NEXTAUTH_URL=https://your-domain.vercel.app

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Database (if using external database)
DATABASE_URL=your-database-connection-string

# Email Service (for invitations)
RESEND_API_KEY=your-resend-api-key
FROM_EMAIL=noreply@yourdomain.com
```

### Development

Create a `.env.local` file in your project root:

```bash
# NextAuth Configuration
NEXTAUTH_SECRET=dev-secret-key-change-in-production
NEXTAUTH_URL=http://localhost:3000

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Database (PostgreSQL recommended)
DATABASE_URL="postgresql://user:password@localhost:5432/astrid_dev"

# Email Service (optional for development)
RESEND_API_KEY=your-resend-api-key
FROM_EMAIL=noreply@yourdomain.com
```

## Google OAuth Setup

### 1. Create Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the Google+ API
4. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client IDs"
5. Choose "Web application"
6. Add authorized redirect URIs:
   - Development: `http://localhost:3000/api/auth/callback/google`
   - Production: `https://your-domain.vercel.app/api/auth/callback/google`

### 2. Get Client ID and Secret

Copy the generated Client ID and Client Secret to your environment variables.

## Common Production Issues & Solutions

### Issue: "Error in the OAuth callback handler route"

**Causes:**
- Missing or incorrect `NEXTAUTH_SECRET`
- Incorrect `NEXTAUTH_URL`
- Google OAuth redirect URI mismatch
- Database connection issues

**Solutions:**
1. **Verify NEXTAUTH_SECRET**: Must be a strong, random string
2. **Check NEXTAUTH_URL**: Must match your production domain exactly
3. **Verify Google OAuth redirect URIs**: Must include your production domain
4. **Check database connection**: Ensure DATABASE_URL is correct

### Issue: "Configuration" error

**Cause:** Missing required environment variables

**Solution:** Ensure all required variables are set in Vercel

### Issue: "AccessDenied" error

**Cause:** Google OAuth configuration mismatch

**Solution:** Verify Google OAuth credentials and redirect URIs

## Testing Authentication

### Development Testing

1. Start the development server: `npm run dev`
2. Visit `http://localhost:3000/auth/signin`
3. Test the available authentication methods:
   - Google OAuth sign-in
   - Passkey registration + sign-in (requires a platform authenticator)
4. Verify email change verification flow works (check structured logs in dev mode)

### Production Testing

1. Deploy to Vercel
2. Visit `https://your-domain.vercel.app/auth/signin`
3. Test sign-in:
   - Google OAuth sign-in
   - Passkey sign-in
4. On iOS, test Apple Sign-In via the iOS app
5. Check Vercel function logs for any errors

## Security Best Practices

1. **NEXTAUTH_SECRET**: Use a strong, random string (32+ characters)
2. **Environment Variables**: Never commit secrets to version control
3. **Google OAuth**: Restrict redirect URIs to your domains only
4. **Database**: Use connection pooling and SSL in production

## Troubleshooting

### Check Vercel Function Logs

1. Go to your Vercel dashboard
2. Select your project
3. Go to "Functions" tab
4. Check the `/api/auth/[...nextauth]` function logs

### Verify Environment Variables

1. In Vercel dashboard, go to "Settings" → "Environment Variables"
2. Ensure all required variables are set
3. Check that they're deployed to production

### Test Database Connection

1. Verify your database is accessible from Vercel
2. Check database connection string format
3. Ensure database has the required tables (run migrations if needed)

## Support

If you continue to have issues:

1. Check Vercel function logs for detailed error messages
2. Verify all environment variables are set correctly
3. Test Google OAuth configuration in Google Cloud Console
4. Ensure database is accessible and properly configured
