import { hasCapability, assertUsableAuthConfiguration } from '@/lib/brand/capabilities'
import type { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import { prisma } from "./prisma"
import { getConsistentDefaultImage } from "./default-images"
import { getDevBaseUrl, isLocalDevelopment } from "./port-detection"
import { getBaseUrl } from "./base-url"
import { isAstridSubdomainUrl } from "./auth-host"
import { createDefaultListsForUser } from "./default-lists"
import { createLogger } from '@/lib/logger'

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
    return await prisma.user.create({
      data: {
        ...user,
        email: user.email.toLowerCase()
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
      if (process.env.NODE_ENV === "development") {
        log.info("[Auth] Account already exists, updating userId if needed")
      }
      // Update the userId in case it changed
      if (existingAccount.userId !== account.userId) {
        await prisma.account.update({
          where: { id: existingAccount.id },
          data: { userId: account.userId }
        })
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

  return providers
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
      
      // Handle Google OAuth sign-in/sign-up
      if (account?.provider === "google" && user?.email) {
        try {
          // Check if user already exists with this email
          const existingUser = await prisma.user.findUnique({
            where: { email: user.email.toLowerCase() },
            include: { accounts: true }
          })

          if (existingUser) {
            // Check if Google account is already linked
            const existingGoogleAccount = existingUser.accounts.find(
              acc => acc.provider === "google"
            )

            if (!existingGoogleAccount) {
              if (process.env.NODE_ENV === "development") {
                log.info({ email: existingUser.email }, "[Auth] Linking Google account to existing user")
              }

              // Link Google account to existing user
              await prisma.account.create({
                data: {
                  userId: existingUser.id,
                  type: account.type,
                  provider: account.provider,
                  providerAccountId: account.providerAccountId,
                  refresh_token: account.refresh_token,
                  access_token: account.access_token,
                  expires_at: account.expires_at,
                  token_type: account.token_type,
                  scope: account.scope,
                  id_token: account.id_token,
                  session_state: account.session_state
                }
              })
            }

            // Always update user info with Google profile data on sign-in
            // This ensures profile pictures are refreshed from Google
            const googlePicture = (profile as any)?.picture
            if (googlePicture || profile?.name) {
              const updateData: { name?: string; image?: string; emailVerified?: Date } = {
                emailVerified: new Date() // Mark email as verified since it's from Google
              }

              // Update name if provided and user doesn't have one
              if (profile?.name && !existingUser.name) {
                updateData.name = profile.name
              }

              // Always update image from Google (refresh it)
              if (googlePicture) {
                updateData.image = googlePicture
                if (process.env.NODE_ENV === "development") {
                  log.info({ pictureSnippet: googlePicture.substring(0, 50) + "..." }, "[Auth] Updating user image from Google")
                }
              }

              await prisma.user.update({
                where: { id: existingUser.id },
                data: updateData
              })
            }

            if (process.env.NODE_ENV === "development") {
              log.info({ email: existingUser.email }, "[Auth] Google OAuth successful for existing user")
            }
          } else {
            if (process.env.NODE_ENV === "development") {
              log.info({ email: user.email }, "[Auth] Google OAuth sign up for new user")
            }
          }

          return true
        } catch (error) {
          log.error({ err: error }, "[Auth] Error during Google OAuth sign-in:")
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

      return url.startsWith(baseUrl) ? url : baseUrl
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
        domain: ".astrid.cc", // Works for both astrid.cc and www.astrid.cc
      },
    },
    callbackUrl: {
      name: `__Secure-next-auth.callback-url`,
      options: {
        sameSite: "lax",
        path: "/",
        secure: true,
        domain: ".astrid.cc",
      },
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
