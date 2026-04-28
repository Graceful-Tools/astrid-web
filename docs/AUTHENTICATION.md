# Authentication System

This document describes the authentication setup and important configuration details to prevent regressions.

## Overview

The application uses **NextAuth.js** with **JWT sessions**. Three sign-in surfaces are supported:

- **Web** — Google OAuth and WebAuthn passkeys (via NextAuth on the server)
- **iOS** — Apple Sign-In (custom endpoint at `/api/auth/apple`) and Google OAuth
- **API/automation** — OAuth client_credentials grant (`/api/v1/oauth/token`) and legacy MCP tokens

Email/password authentication was removed in 2026-04. There is no `User.password` column, no `CredentialsProvider`, no `/api/auth/signup` endpoint, and no `bcryptjs` dependency.

## Critical Configuration

### MUST USE JWT SESSIONS

The system uses JWT sessions (`strategy: "jwt"`), not database sessions:

```typescript
// lib/auth-config.ts
session: {
  strategy: "jwt",
  maxAge: 30 * 24 * 60 * 60, // 30 days
}
```

### Required Callbacks

Both JWT and session callbacks are required:

```typescript
callbacks: {
  jwt: ({ token, user, account }) => {
    if (user && account) {
      token.id = user.id
      token.provider = account.provider
      token.email = user.email
      token.name = user.name
      token.image = user.image
    }
    return token
  },
  session: ({ session, token }) => {
    if (session?.user && token) {
      session.user.id = token.id as string
      session.user.email = token.email as string
      session.user.name = token.name as string
      session.user.image = token.image as string
    }
    return session
  }
}
```

## Environment Variables

```bash
NEXTAUTH_URL=http://localhost:3000  # Must match actual port
NEXTAUTH_SECRET=your-secret-key
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
DATABASE_URL=postgresql://...
```

## Providers

### Google OAuth (web + iOS)

```typescript
GoogleProvider({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  authorization: {
    params: {
      prompt: "consent",
      access_type: "offline",
      response_type: "code"
    }
  }
})
```

### Apple Sign-In (iOS only)

iOS apps post their Apple identity token to `/api/auth/apple`. The endpoint verifies the token against Apple's JWKS at `https://appleid.apple.com/auth/keys` and creates or links the user account directly via Prisma. This route does **not** go through NextAuth — it issues its own session cookie.

### WebAuthn / Passkeys (web)

Registration: `/api/auth/webauthn/register/begin` → `/api/auth/webauthn/register/verify`. Authentication: `/api/auth/webauthn/authenticate/begin` → `/api/auth/webauthn/authenticate/verify`. See `lib/webauthn.ts`.

## Custom Adapter

The system uses a custom Prisma adapter that:
- Prevents duplicate user creation for OAuth
- Normalizes email case
- Links a Google account to an existing user with the same email

Database session creation is not needed with the JWT strategy.

## Account Deletion

`POST /api/account/delete` requires:
1. An active session (cookie or JWT)
2. The literal confirmation text `DELETE MY ACCOUNT`
3. The user has at least one authentication method linked (OAuth account or passkey)

The session itself is the proof of identity; the confirmation text is the user-facing acknowledgement.

## Database Schema

The `User` model includes:
- `id` (string, primary key)
- `email` (string, unique)
- `name` (string, optional)
- `image` (string, optional)
- Standard NextAuth fields for OAuth support
- WebAuthn `Authenticator` rows for passkeys

There is no `password` column.

## Security Notes

- Email addresses are normalized to lowercase
- JWT tokens are encrypted with `NEXTAUTH_SECRET`
- CSRF protection is enabled by default
- Apple identity tokens are verified against Apple's JWKS (issuer + signature checks)
- WebAuthn challenges are signed and time-bound

## Debugging

Enable debug mode in development:

```typescript
debug: process.env.NODE_ENV === "development"
```

Check structured logs (pino) for `[Auth]`-prefixed messages: JWT/session callback events, Google OAuth account linking, sign-in events.

## Version History

- **v3.0** (2026-04) — Removed email/password authentication entirely. Web uses Google OAuth + passkeys; iOS uses Apple Sign-In + Google OAuth.
- **v2.0** — Switched to JWT sessions
- **v1.0** — Database sessions (deprecated)
