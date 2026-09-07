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

On iOS, the app posts a Google `idToken` to `/api/auth/google` instead of going through the web OAuth flow. That endpoint verifies the id token against Google's JWKS (issuer + signature) and additionally checks `aud` (must equal our client id) and `email_verified`. See `lib/auth/google-identity.ts`.

### Apple Sign-In (iOS only)

iOS apps post their Apple identity token to `/api/auth/apple`. The endpoint verifies the token against Apple's JWKS at `https://appleid.apple.com/auth/keys` (issuer + signature) and additionally checks `aud` (must equal our client id), `email`, and `email_verified`, then creates or links the user account directly via Prisma. This route does **not** go through NextAuth — it issues its own session cookie. See `lib/auth/apple-identity.ts`.

### WebAuthn / Passkeys (web)

Registration: `/api/auth/webauthn/register/begin` → `/api/auth/webauthn/register/verify`. Authentication: `/api/auth/webauthn/authenticate/begin` → `/api/auth/webauthn/authenticate/verify`. See `lib/webauthn.ts`.

### Desktop browser hand-off (Windows; Mac and Linux later)

A native desktop app cannot host the NextAuth sign-in page, and should not try:
doing so would mean re-implementing passkeys, Google and Apple per platform, and
asking the user to type a password into a window that could be anything. Instead
the app opens the system browser at `/auth/desktop`, the user signs in with
whatever the web already supports, and the browser hands a one-time code back
through the app's registered URL scheme (`BRAND.appUrlScheme`).

The threat that shapes the design: **any local program can register the same URL
scheme**, so the callback is not a private channel. PKCE is what makes an
intercepted code worthless — the app keeps a random verifier to itself and sends
only its SHA-256 hash when the flow starts.

- `lib/auth/desktop-handoff.ts` — the rules, with no storage in sight: S256 only,
  fixed per-client redirect URI, five-minute lifetime.
- `lib/auth/desktop-grant-store.ts` — `DesktopAuthGrant` rows: code hashed at
  rest, claimed by a conditional write so two racing redemptions cannot both win.
- Routes: `POST /api/auth/desktop/grant` (cookie-authenticated) and
  `POST /api/v1/auth/desktop/exchange` (unauthenticated; the code is the
  credential).

Deliberately **not** built on `OAuthAuthorizationCode`. The two look alike, but an
OAuth code redeems into a scoped third-party token while one of these redeems
into a full first-party session; sharing a table would make one lookup bug enough
to turn the former into the latter.

A wrong verifier burns the code instead of allowing another attempt — the same
call this repo made for WebAuthn challenges (task 1a52195f), for the same reason.

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
- Apple and Google identity/id tokens are verified against the provider's JWKS (issuer + signature) plus `aud` (must equal our client id), `email`, and `email_verified` — closing an account-takeover gap
- OAuth access/refresh tokens are stored hashed at rest (SHA-256) with dual-read (lookup matches the hash or legacy plaintext during migration); see `lib/oauth/oauth-token-manager.ts`
- MCP tokens are dual-stored: the `token` column holds the SHA-256 hash (used for lookup) and `tokenEncrypted` holds the AES-256-GCM ciphertext (used to reveal/reuse the plaintext); see `lib/mcp-token.ts`
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
