"use client"

import { signIn, getProviders } from "next-auth/react"
import { useEffect, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Chrome, Loader2, AlertCircle, Mail, Lock, Eye, EyeOff, KeyRound } from "lucide-react"
import Image from "next/image"
import { useWebAuthn } from "@/hooks/use-webauthn"
import Link from "next/link"

export function SignInContent() {
  const [providers, setProviders] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Default to signup (Create your account) view
  const [showSignIn, setShowSignIn] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Form states
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  // Passkey signup email prompt state
  const [showPasskeyEmailPrompt, setShowPasskeyEmailPrompt] = useState(false)
  const [passkeyEmail, setPasskeyEmail] = useState("")

  const searchParams = useSearchParams()
  const router = useRouter()
  const urlError = searchParams?.get("error") ?? null

  // Passkey support
  const {
    isSupported: isPasskeySupported,
    isLoading: isPasskeyLoading,
    error: passkeyError,
    registerPasskey,
    authenticateWithPasskey,
    clearError: clearPasskeyError,
  } = useWebAuthn()

  // Fetch providers in background — render buttons immediately to avoid blocking LCP
  useEffect(() => {
    getProviders()
      .then((res) => {
        setProviders(res)
      })
      .catch((err) => {
        console.error("Failed to fetch providers:", err)
      })
  }, [])

  const handleGoogleSignIn = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await signIn("google", {
        callbackUrl: "/",
        redirect: false,
      })

      if (result?.error) {
        setError(result.error)
      } else if (result?.url) {
        window.location.href = result.url
      }
    } catch (error) {
      console.error("Google sign in error:", error)
      setError("An unexpected error occurred during sign in")
    } finally {
      setLoading(false)
    }
  }

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) {
      setError("Please fill in all fields")
      return
    }

    setLoading(true)
    setError(null)
    try {
      // Use redirect: false to handle the response manually
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError("Invalid email or password")
        setLoading(false)
      } else if (result?.ok) {
        // Successful sign in, redirect to home
        window.location.href = "/"
      } else {
        setError("An unexpected error occurred during sign in")
        setLoading(false)
      }
    } catch (error) {
      console.error("Email sign in error:", error)
      setError("An unexpected error occurred during sign in")
      setLoading(false)
    }
  }

  const handlePasskeySignIn = async () => {
    clearPasskeyError()
    setError(null)
    await authenticateWithPasskey()
  }

  // Unified passkey flow (matching iOS): Try auth first, then offer email signup if cancelled
  const handleUnifiedPasskeyFlow = async () => {
    clearPasskeyError()
    setError(null)

    // Try to authenticate with existing passkey first
    // Browser will show any available passkeys for this domain
    const result = await authenticateWithPasskey()

    // If user cancelled or authentication failed, show email prompt to create new account
    if (!result.success) {
      // Clear any error message (user cancelled is not an error to display)
      clearPasskeyError()
      setError(null)
      // Show email prompt to create new account with passkey
      setShowPasskeyEmailPrompt(true)
    }
    // If success, authenticateWithPasskey already redirects to home
  }

  const handlePasskeySignUp = async () => {
    // If no email yet, show the email prompt
    if (!passkeyEmail) {
      setShowPasskeyEmailPrompt(true)
      return
    }
    clearPasskeyError()
    setError(null)
    await registerPasskey(passkeyEmail, "My Passkey")
  }

  const handlePasskeyEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!passkeyEmail) {
      setError("Please enter your email address")
      return
    }
    clearPasskeyError()
    setError(null)
    await registerPasskey(passkeyEmail, "My Passkey")
  }

  const getErrorMessage = (error: string) => {
    // NextAuth error codes are short single-word strings
    // Passkey errors are full sentences - show them directly
    if (error.includes(" ") || error.length > 30) {
      return error
    }

    switch (error) {
      case "Configuration":
        return "There is a problem with the server configuration. Please check your environment variables."
      case "AccessDenied":
        return "Access denied. You do not have permission to sign in."
      case "Verification":
        return "The verification token has expired or has already been used."
      case "OAuthSignin":
        return "Error in constructing an authorization URL. Please check your OAuth configuration."
      case "OAuthCallback":
        return "Error in handling the response from an OAuth provider."
      case "OAuthCreateAccount":
        return "Could not create OAuth account."
      case "EmailCreateAccount":
        return "Could not create email account."
      case "Callback":
        return "Error in the OAuth callback handler route."
      case "OAuthAccountNotLinked":
        return "An account with this email already exists. Please try signing in again - we'll link your Google account automatically."
      case "EmailSignin":
        return "Sending the e-mail with the verification token failed."
      case "CredentialsSignin":
        return "Invalid email or password. Please try again."
      case "SessionRequired":
        return "The content of this page requires you to be signed in at all times."
      default:
        return "An error occurred during authentication. Please try again or contact support."
    }
  }

  const displayError = error || urlError || passkeyError

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header - Logo and Tagline (matching iOS) */}
        <div className="flex items-center justify-center gap-4 mb-4">
          <Image
            src="/images/astrid-character.png"
            alt="Astrid"
            width={88}
            height={88}
            priority
            className="rounded-2xl"
          />
          <div className="text-left">
            <h1 className="text-4xl font-bold text-white">astrid</h1>
            <p className="text-gray-400 text-lg">Get it done!</p>
          </div>
        </div>

        {/* App Store Download Button */}
        <div className="flex justify-center mb-8">
          <a
            href="https://apps.apple.com/app/astrid-tasks/id6755752694"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded-xl text-white text-sm font-medium transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
            </svg>
            Download on the App Store
          </a>
        </div>

        {/* Authentication Card */}
        <Card className="bg-gray-900 border-gray-800 shadow-2xl">
          <CardHeader className="text-center pb-6">
            <CardTitle className="text-2xl font-semibold text-white">
              {showSignIn ? "Welcome back" : "Sign in to get started!"}
            </CardTitle>
            {showSignIn && (
              <CardDescription className="text-gray-400 text-base">
                Sign in to access your tasks and collaborate with others
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="px-8 pb-8">
            {displayError && (
              <Alert className="mb-6 border-red-800 bg-red-900/20">
                <AlertCircle className="h-4 w-4 text-red-400" />
                <AlertDescription className="text-red-300">{getErrorMessage(displayError)}</AlertDescription>
              </Alert>
            )}

            {/* Create Account View (Default) */}
            {!showSignIn && !showPasskeyEmailPrompt && (
              <div className="space-y-4">
                {/* 1. Google - Most prominent (blue), rendered immediately for fast LCP */}
                <Button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading || isPasskeyLoading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium h-12 rounded-xl shadow-sm"
                  size="lg"
                >
                  {loading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Chrome className="w-5 h-5 mr-2" />}
                  {loading ? "Continuing..." : "Continue with Google"}
                </Button>

                {/* 2. Passkey - Opens dialog with New/Returning options */}
                <Button
                  type="button"
                  onClick={() => {
                    setPasskeyEmail("")
                    setShowPasskeyEmailPrompt(true)
                  }}
                  disabled={loading || isPasskeyLoading || !isPasskeySupported}
                  className={`w-full font-medium h-12 rounded-xl shadow-sm ${
                    isPasskeySupported
                      ? "bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300"
                      : "bg-gray-600 text-gray-400 cursor-not-allowed"
                  }`}
                  size="lg"
                >
                  <KeyRound className="w-5 h-5 mr-2" />
                  Continue with Passkey
                </Button>
                {!isPasskeySupported && (
                  <p className="text-xs text-gray-500 text-center -mt-2">
                    Passkeys not supported in this browser
                  </p>
                )}

                {/* Sign in link for legacy users (matching iOS) */}
                <div className="pt-4 text-center">
                  <button
                    type="button"
                    onClick={() => setShowSignIn(true)}
                    className="text-blue-400 hover:text-blue-300 text-sm font-medium"
                  >
                    Legacy email/password? Sign in
                  </button>
                </div>
              </div>
            )}

            {/* Passkey Dialog - New/Returning options */}
            {!showSignIn && showPasskeyEmailPrompt && (
              <div className="space-y-5">
                <div className="text-center mb-2">
                  <KeyRound className="w-10 h-10 text-blue-400 mx-auto mb-2" />
                  <p className="text-gray-300 font-medium">Continue with Passkey</p>
                </div>

                {/* New user - Email input */}
                <div>
                  <Label htmlFor="passkey-email" className="text-sm font-medium text-gray-400 mb-2 block">
                    New?
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      id="passkey-email"
                      type="email"
                      value={passkeyEmail}
                      onChange={(e) => setPasskeyEmail(e.target.value)}
                      placeholder="Enter your email"
                      className="pl-10 h-12 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500 focus:ring-blue-500 rounded-xl"
                      autoFocus
                    />
                  </div>
                </div>

                {/* Returning user - Only show when no email entered */}
                {!passkeyEmail && (
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-400 mb-2">Returning?</p>
                  </div>
                )}

                {/* Single button that handles both cases */}
                <Button
                  type="button"
                  onClick={async () => {
                    clearPasskeyError()
                    setError(null)
                    if (passkeyEmail) {
                      // New user with email - register passkey
                      await registerPasskey(passkeyEmail, "My Passkey")
                    } else {
                      // Returning user - authenticate with existing passkey
                      await authenticateWithPasskey()
                    }
                  }}
                  disabled={loading || isPasskeyLoading}
                  className="w-full bg-gray-100 hover:bg-gray-200 text-gray-900 font-medium h-12 rounded-xl shadow-sm border border-gray-300"
                  size="lg"
                >
                  {isPasskeyLoading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <KeyRound className="w-5 h-5 mr-2" />}
                  {isPasskeyLoading
                    ? (passkeyEmail ? "Creating account..." : "Signing in...")
                    : "Continue with Passkey"
                  }
                </Button>

                <button
                  type="button"
                  onClick={() => {
                    setShowPasskeyEmailPrompt(false)
                    setPasskeyEmail("")
                    setError(null)
                  }}
                  className="w-full text-gray-400 hover:text-gray-300 text-sm"
                >
                  Back to options
                </button>
              </div>
            )}

            {/* Sign In View (Legacy users) */}
            {showSignIn && (
              <form onSubmit={handleEmailSignIn} className="space-y-5">
                <div>
                  <Label htmlFor="email" className="text-sm font-medium text-gray-300 mb-2 block">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email"
                      className="pl-10 h-12 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500 focus:ring-blue-500 rounded-xl"
                      required
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="password" className="text-sm font-medium text-gray-300 mb-2 block">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="pl-10 pr-10 h-12 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500 focus:ring-blue-500 rounded-xl"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-300"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium h-12 rounded-xl shadow-sm"
                  size="lg"
                >
                  {loading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : "Sign In"}
                </Button>

                {/* Divider */}
                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-gray-700" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-gray-900 px-3 text-gray-500 font-medium">Or continue with</span>
                  </div>
                </div>

                {/* OAuth buttons in order: Google, Passkey, Apple */}
                <div className="space-y-3">
                  {/* 1. Google */}
                  {providers?.google && (
                    <Button
                      type="button"
                      onClick={handleGoogleSignIn}
                      disabled={loading || isPasskeyLoading}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium h-12 rounded-xl shadow-sm"
                      size="lg"
                    >
                      {loading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Chrome className="w-5 h-5 mr-2" />}
                      Continue with Google
                    </Button>
                  )}

                  {/* 2. Passkey */}
                  <Button
                    type="button"
                    onClick={handlePasskeySignIn}
                    disabled={loading || isPasskeyLoading || !isPasskeySupported}
                    className={`w-full font-medium h-12 rounded-xl shadow-sm ${
                      isPasskeySupported
                        ? "bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300"
                        : "bg-gray-600 text-gray-400 cursor-not-allowed"
                    }`}
                    size="lg"
                  >
                    {isPasskeyLoading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <KeyRound className="w-5 h-5 mr-2" />}
                    {isPasskeyLoading ? "Authenticating..." : "Sign in with Passkey"}
                  </Button>

                </div>

                {/* Back to create account */}
                <div className="pt-4 text-center">
                  <button
                    type="button"
                    onClick={() => setShowSignIn(false)}
                    className="text-blue-400 hover:text-blue-300 text-sm font-medium"
                  >
                    Don&apos;t have an account? Create one
                  </button>
                </div>
              </form>
            )}


            <div className="text-center text-sm text-gray-500 mt-6">
              <p>
                By signing in, you agree to our{" "}
                <Link href="/terms" className="text-blue-400 hover:text-blue-300 underline">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link href="/privacy" className="text-blue-400 hover:text-blue-300 underline">
                  Privacy Policy
                </Link>
              </p>
              <p className="mt-2">
                Having trouble?{" "}
                <Link href="/help" className="text-blue-400 hover:text-blue-300 underline">
                  Visit our Help Center
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Features Preview */}
        <div className="mt-8 grid grid-cols-1 gap-4 text-center">
          <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-800 shadow-sm">
            <h3 className="text-white font-semibold mb-2">Organize Your Tasks</h3>
            <p className="text-gray-400 text-sm">
              Create private, shared, and public lists to manage your work and life
            </p>
          </div>
          <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-800 shadow-sm">
            <h3 className="text-white font-semibold mb-2">Collaborate with Teams</h3>
            <p className="text-gray-400 text-sm">
              Share lists with admins and set default task settings for consistency
            </p>
          </div>
          <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-800 shadow-sm">
            <h3 className="text-white font-semibold mb-2">Discover Public Tasks</h3>
            <p className="text-gray-400 text-sm">Browse and copy tasks from public lists shared by the community</p>
          </div>
        </div>
      </div>
    </div>
  )
}
