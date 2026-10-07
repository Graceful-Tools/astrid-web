import { BRAND } from '@/lib/brand/config'
import { hasCapability, assertUsableAuthConfiguration } from '@/lib/brand/capabilities'
import type { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import GithubProvider from "next-auth/providers/github"
import AppleProvider from "next-auth/providers/apple"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import { prisma } from "./prisma"
import { getConsistentDefaultImage } from "./default-images"
import { getDevBaseUrl, isLocalDevelopment } from "./port-detection"
import { getBaseUrl } from "./base-url"
import { isAstridSubdomainUrl, sameOrigin } from "./auth-host"
import { createDefaultListsForUser } from "./default-lists"
import { createLogger } from '@/lib/logger'
import { isGoogleEmailVerified } from '@/lib/auth/google-identity'
import { linkFederatedIdentity, type FederatedSignIn } from '@/lib/auth/federated-identity-linking'
import { githubVerifiedPrimaryEmail } from '@/lib/auth/github-verified-email'
import { isEmailVerified as isAppleEmailVerified } from '@/lib/auth/apple-identity'
import { appleClientSecret } from '@/lib/auth/apple-client-secret'
import { hasAppleWebCredentials } from '@/lib/auth/provider-credentials'

const log = createLogger('auth-config')


// Set default NEXTAUTH_URL for development using dynamic port detection
if (!process.env.NEXTAUTH_URL) {
  if (process.env.NODE_ENV === "development" && isLocalDevelopment()) {
    // Use development URL with dynamic port detection
    process.env.NEXTAUTH_URL = getDevBaseUrl()
    log.info({ url: process.env.NEXTAUTH_URL }, "[Auth] 🔧 Using dynamic NEXTAUTH_URL")
    log.info("[Auth] 💡 To override, set NEXTAUTH_URL in .env.local")
  } else {
    // Use centralized base URL utility - ensures HTTPS in production
    process.env.NEXTAUTH_URL = getBaseUrl()
    if (process.env.NODE_ENV === "production") {
      log.warn(
        "[Auth] ⚠️  NEXTAUTH_URL not set - using fallback. " +
        "Set NEXTAUTH_URL in production environment variables for correct authentication URLs."
      )
    }
  }
}

// Debug environment variables (development only)
if (process.env.NODE_ENV === "development") {
  log.info({
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ? "SET" : "NOT SET",
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ? "SET" : "NOT SET",
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? "SET" : "NOT SET"
  }, "[Auth] Environment check:")
}

// Note: Default list creation is now handled by shared utility in lib/default-lists.ts

// Custom adapter that handles account linking and credentials sessions
const customAdapter = {
  ...PrismaAdapter(prisma),
  async createUser(user: any) {
    if (process.env.NODE_ENV === "development") {
      log.info(user.email, "[Auth] CreateUser called:")
    }
    
    // Check if a user with this email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: user.email.toLowerCase() }
    })
    
    if (existingUser) {
      if (process.env.NODE_ENV === "development") {
        log.info({ email: existingUser.email }, "[Auth] User already exists, returning existing user")
      }
      return existingUser
    }
    
    // Create new user if none exists
    if (process.env.NODE_ENV === "development") {
      log.info(user.email, "[Auth] Creating new user:")
    }
    // Only the OAuth flow reaches this adapter (passkeys and the mobile routes
    // create users themselves), and signIn has already refused any email the
    // provider does not vouch for (linkFederatedIdentity). So the row starts
    // verified — left null, the user's next sign-in would "adopt" their own
    // account and revoke passkeys they had added in between (AWTD-1088).
    return await prisma.user.create({
      data: {
        ...user,
        email: user.email.toLowerCase(),
        emailVerified: user.emailVerified ?? new Date()
      }
    })
  },
  async linkAccount(account: any): Promise<void> {
    if (process.env.NODE_ENV === "development") {
      log.info({
        userId: account.userId,
        provider: account.provider,
        providerAccountId: account.providerAccountId
      }, "[Auth] LinkAccount called:")
    }
    
    // Check if account already exists
    const existingAccount = await prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: account.provider,
          providerAccountId: account.providerAccountId
        }
      }
    })
    
    if (existingAccount) {
      // An identity belongs to exactly one user. This used to "update the
      // userId in case it changed" — silently moving a Google (or any) login
      // from one account to another (AWTD-1088).
      if (existingAccount.userId !== account.userId) {
        log.warn({ provider: account.provider }, "[Auth] Refusing to move a provider identity to a different user")
        throw new Error("This sign-in is already linked to another account")
      }
      return
    }
    
    // Create new account link
    await prisma.account.create({
      data: account
    })
  },
  async createSession(session: any) {
    if (process.env.NODE_ENV === "development") {
      log.info({
        userId: session.userId,
        sessionToken: session.sessionToken?.substring(0, 10) + "...",
        expires: session.expires
      }, "[Auth] CreateSession called:")
    }
    
    return await prisma.session.create({
      data: session
    })
  }
}

/**
 * Sign-in providers this deployment offers.
 *
 * Google is omitted entirely when the capability is off, so NextAuth will not mint a
 * callback route for it and `signIn("google")` is refused by the framework rather than
 * by our own code. Task 97208a72.
 *
 * assertUsableAuthConfiguration() runs first: a build with no sign-in method at all is
 * a total outage, not a degraded feature, and must fail at startup rather than at the
 * first user's sign-in attempt.
 */
function buildProviders() {
  assertUsableAuthConfiguration()

  const providers: NextAuthOptions["providers"] = []

  if (hasCapability('authGithub')) {
    // The brand's GitHub App's own OAuth client — one consent gives the session
    // and, later, the user-to-server token (spec §7). Its Callback URL must
    // include /api/auth/callback/github.
    providers.push(GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }))
  }

  if (hasCapability('authSso')) {
    // Deployment-level OIDC SSO (spec §6.4 v1): one IdP from env. Identities
    // are trusted only for AUTH_SSO_DOMAINS — see emailTrustFor.
    providers.push({
      id: 'sso',
      name: process.env.AUTH_SSO_LABEL?.trim() || 'SSO',
      type: 'oauth',
      wellKnown: `${process.env.AUTH_SSO_ISSUER!.replace(/\/+$/, '')}/.well-known/openid-configuration`,
      clientId: process.env.AUTH_SSO_CLIENT_ID!,
      clientSecret: process.env.AUTH_SSO_CLIENT_SECRET!,
      authorization: { params: { scope: 'openid email profile' } },
      idToken: true,
      checks: ['pkce', 'state'],
      profile(claims: Record<string, string | undefined>) {
        return {
          id: claims.sub!,
          email: claims.email ?? null,
          name: claims.name ?? claims.preferred_username ?? claims.email ?? null,
          image: claims.picture ?? null,
        }
      },
    })
  }

  if (hasCapability('authGoogle')) {
    providers.push(GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Ensure the callback URL is properly set
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code"
        }
      }
    }))
  }

  // Apple is a legacy default-on provider, and its native sign-in (iOS/Mac) needs
  // no server secret — so the switch alone must not put a web button on every
  // deployment. The web provider exists only once its credentials do (AWTD-1110).
  // Its Services ID's Return URL must be /api/auth/callback/apple.
  if (hasCapability('authApple') && hasAppleWebCredentials()) {
    providers.push(AppleProvider({
      clientId: process.env.APPLE_SERVICES_ID!,
      clientSecret: appleClientSecret({
        teamId: process.env.APPLE_TEAM_ID!,
        keyId: process.env.APPLE_KEY_ID!,
        clientId: process.env.APPLE_SERVICES_ID!,
        privateKey: process.env.APPLE_PRIVATE_KEY!,
      }),
    }))
  }

  return providers
}

/** Providers whose sign-in goes through linkFederatedIdentity. */
const FEDERATED_PROVIDERS = new Set(['google', 'github', 'sso', 'apple'])

/**
 * How far a provider vouches for the email it handed over (spec §6.3).
 * Google and Apple: their email_verified claim. GitHub: the primary address it reports as
 * verified in /user/emails — the profile email can be unverified, and NextAuth's
 * own fallback picks the primary without checking. SSO: domain-bound.
 */
async function emailTrustFor(
  provider: string,
  email: string,
  account: { access_token?: string | null },
  profile: unknown,
): Promise<Pick<FederatedSignIn, 'emailTrust' | 'allowedDomains'>> {
  if (provider === 'google') {
    const claim = (profile as { email_verified?: string | boolean } | undefined)?.email_verified
    return { emailTrust: isGoogleEmailVerified(claim) ? 'verified' : 'none' }
  }
  if (provider === 'github') {
    const verified = account.access_token ? await githubVerifiedPrimaryEmail(account.access_token) : null
    return { emailTrust: verified && verified.toLowerCase() === email.toLowerCase() ? 'verified' : 'none' }
  }
  if (provider === 'apple') {
    // The id token's claim, as the native routes read it (lib/auth/apple-identity.ts).
    const claim = (profile as { email_verified?: string | boolean } | undefined)?.email_verified
    return { emailTrust: isAppleEmailVerified(claim) ? 'verified' : 'none' }
  }
  if (provider === 'sso') {
    const allowedDomains = (process.env.AUTH_SSO_DOMAINS ?? '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
    return { emailTrust: 'domain-bound', allowedDomains }
  }
  return { emailTrust: 'none' }
}

const authConfig: NextAuthOptions = {
  adapter: customAdapter,
  providers: buildProviders(),
  callbacks: {
    async signIn({ user, account, profile, email, credentials }) {
      if (process.env.NODE_ENV === "development") {
        log.info({
          userId: user?.id,
          userEmail: user?.email,
          provider: account?.provider,
          hasCredentials: !!credentials
        }, "[Auth] SignIn callback triggered:")
      }
      
      // Federated providers sign in only through the shared linking rule
      // (lib/auth/federated-identity-linking.ts, spec §6.3): an identity
      // already linked signs in; otherwise the email must be one the provider
      // vouches for, and linking adopts the account first. Google used to have
      // its own copy here, which linked on any email at all (AWTD-1088).
      if (account && FEDERATED_PROVIDERS.has(account.provider)) {
        if (!user?.email) return false
        try {
          return await linkFederatedIdentity({
            provider: account.provider,
            account: account as never,
            email: user.email,
            ...(await emailTrustFor(account.provider, user.email, account, profile)),
            profile: {
              name: profile?.name ?? user.name,
              image: (profile as { picture?: string } | undefined)?.picture ?? user.image ?? null,
            },
          })
        } catch (error) {
          log.error({ err: error, provider: account.provider }, "[Auth] Error during federated sign-in")
          return false
        }
      }

      // Handle credentials sign-in
      if (account?.provider === "credentials") {
        if (process.env.NODE_ENV === "development") {
          log.info(user?.email, "[Auth] Credentials sign in successful for:")
        }
        return true
      }
      
      return true
    },
    async redirect({ url, baseUrl }) {
      if (process.env.NODE_ENV === "development") {
        log.info({ url, baseUrl }, "[Auth] Redirect callback:")
      }

      // Avoid redirect loops - if URL already has checkReturnTo, go to base
      if (url.includes('checkReturnTo=1')) {
        return baseUrl
      }

      // After successful OAuth authentication, check for stored return URL
      // Only apply to OAuth callbacks - NOT sign-out redirects to /auth/signin
      if (url.includes('/api/auth/callback/')) {
        // For client-side sessionStorage access, we'll redirect to a special page that handles it
        return `${baseUrl}?checkReturnTo=1`
      }

      // Handle relative URLs (e.g., "/auth/signin" from sign-out)
      if (url.startsWith('/')) {
        return `${baseUrl}${url}`
      }

      // Allow returning a signed-in user to any astrid.cc subdomain — a
      // preview deploy bounces Google sign-in to astrid.cc and passes its
      // own origin as callbackUrl. The session cookie is .astrid.cc-scoped
      // so the preview is authenticated once the user lands back on it.
      if (isAstridSubdomainUrl(url)) {
        return url
      }

      // Compare ORIGINS, not string prefixes. `url.startsWith(baseUrl)` is an
      // open redirect: with baseUrl https://www.astrid.cc, the URL
      // https://www.astrid.cc.evil.test/phish passes the test and the user is
      // sent off-site immediately after authenticating. isAstridSubdomainUrl
      // two lines above already does the parsed-hostname comparison; this line
      // was the one that did not (task b54bfb37).
      return sameOrigin(url, baseUrl) ? url : baseUrl
    },
    jwt: ({ token, user, account }) => {
      if (process.env.NODE_ENV === "development") {
        log.info({
          hasToken: !!token,
          hasUser: !!user,
          hasAccount: !!account,
          provider: account?.provider,
          userEmail: user?.email || token?.email
        }, "[Auth] JWT callback:")
      }

      // First time signin - store user info in token
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
      if (process.env.NODE_ENV === "development") {
        log.info({
          hasSession: !!session,
          hasToken: !!token,
          tokenId: token?.id,
          userEmail: session?.user?.email
        }, "[Auth] Session callback (JWT):")
      }

      // Pass token data to session
      if (session?.user && token) {
        session.user.id = token.id as string
        session.user.email = token.email as string
        session.user.name = token.name as string
        session.user.image = token.image as string
      }

      return session
    }
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  // Set cookie domain to work across www and non-www in production
  cookies: process.env.NODE_ENV === "production" ? {
    sessionToken: {
      name: `__Secure-next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: true,
        domain: `.${BRAND.domain}`, // Works for both {BRAND.domain} and www.{BRAND.domain}
      },
    },
    callbackUrl: {
      name: `__Secure-next-auth.callback-url`,
      options: {
        sameSite: "lax",
        path: "/",
        secure: true,
        domain: `.${BRAND.domain}`,
      },
    },
    // Apple returns with a cross-site form_post, on which a SameSite=Lax cookie is
    // not sent — the callback would find no PKCE verifier or state and fail. None
    // (Secure) lets them through; both are single-use and httpOnly (AWTD-1110).
    pkceCodeVerifier: {
      name: `__Secure-next-auth.pkce.code_verifier`,
      options: { httpOnly: true, sameSite: "none", path: "/", secure: true, maxAge: 60 * 15 },
    },
    state: {
      name: `__Secure-next-auth.state`,
      options: { httpOnly: true, sameSite: "none", path: "/", secure: true, maxAge: 60 * 15 },
    },
    csrfToken: {
      name: `__Host-next-auth.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: true,
        // Note: __Host- cookies cannot have domain set
      },
    },
  } : undefined,
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  debug: process.env.NODE_ENV === "development",
  events: {
    async signIn(message) {
      if (process.env.NODE_ENV === "development") {
        log.info({ email: message.user.email, provider: message.account?.provider }, "[Auth] SignIn event")
      }
    },
    async signOut(message) {
      if (process.env.NODE_ENV === "development") {
        log.info({ message }, "[Auth] SignOut event:")
      }
    },
    async createUser(message) {
      if (process.env.NODE_ENV === "development") {
        log.info({ email: message.user.email }, "[Auth] CreateUser event")
      }

      // Create default lists for the new user
      await createDefaultListsForUser(message.user.id)
    },
    async linkAccount(message) {
      if (process.env.NODE_ENV === "development") {
        log.info({ email: message.user.email, provider: message.account.provider }, "[Auth] LinkAccount event")
      }
    },
    async session(message) {
      if (process.env.NODE_ENV === "development") {
        log.info(message.session.user?.email, "[Auth] Session event:")
      }
    }
  }
}

export { authConfig }
