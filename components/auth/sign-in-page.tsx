"use client"

import { BRAND } from '@/lib/brand/config'
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { signIn } from "next-auth/react"
import { Heart, Chrome, Loader2, KeyRound, Mail } from "lucide-react"
import { useWebAuthn } from "@/hooks/use-webauthn"
import { trackLogin, trackSignUp } from "@/lib/analytics"

export function SignInPage() {
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [activeTab, setActiveTab] = useState("signin")

  const {
    isSupported: isPasskeySupported,
    isLoading: isPasskeyLoading,
    error: passkeyError,
    registerPasskey,
    authenticateWithPasskey,
    clearError: clearPasskeyError,
  } = useWebAuthn()

  const handleGoogleSignIn = async (isSignUp = false) => {
    setIsSigningIn(true)
    setError(null)

    try {
      // Track the intent (success will be tracked via PostHog user identification)
      if (isSignUp) {
        trackSignUp("google")
      } else {
        trackLogin("google")
      }
      await signIn("google", { callbackUrl: "/" })
    } catch (err) {
      setError("Failed to sign in. Please try again.")
      console.error("Sign in error:", err)
    } finally {
      setIsSigningIn(false)
    }
  }

  const handlePasskeySignIn = async () => {
    clearPasskeyError()
    setError(null)
    await authenticateWithPasskey()
  }

  const handlePasskeySignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) {
      setError("Please enter your email address")
      return
    }
    clearPasskeyError()
    setError(null)
    await registerPasskey(email, "My Passkey")
  }

  const displayError = error || passkeyError
  const isLoading = isSigningIn || isPasskeyLoading

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center space-x-2 mb-4">
            <Heart className="w-8 h-8 text-red-500 fill-red-500" />
            <span className="text-3xl font-bold text-white">astrid</span>
          </div>
          <p className="text-gray-400">Your personal task management companion</p>
        </div>

        {/* Sign In Card */}
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader className="text-center">
            <CardTitle className="text-white">Welcome to {BRAND.appName}</CardTitle>
            <CardDescription className="text-gray-400">
              Sign in to access your tasks and collaborate with others
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-gray-700">
                <TabsTrigger value="signin" className="data-[state=active]:bg-gray-600">Sign In</TabsTrigger>
                <TabsTrigger value="signup" className="data-[state=active]:bg-gray-600">Sign Up</TabsTrigger>
              </TabsList>

              <TabsContent value="signin" className="space-y-4 mt-4">
                {/* Passkey Sign In */}
                {isPasskeySupported && (
                  <Button
                    onClick={handlePasskeySignIn}
                    disabled={isLoading}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
                    size="lg"
                  >
                    {isPasskeyLoading ? (
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    ) : (
                      <KeyRound className="w-5 h-5 mr-2" />
                    )}
                    {isPasskeyLoading ? "Authenticating..." : "Sign in with Passkey"}
                  </Button>
                )}

                {/* Google Sign In */}
                <Button
                  onClick={() => handleGoogleSignIn(false)}
                  disabled={isLoading}
                  className="w-full bg-white hover:bg-gray-100 text-gray-900 font-medium"
                  size="lg"
                >
                  {isSigningIn ? (
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  ) : (
                    <Chrome className="w-5 h-5 mr-2" />
                  )}
                  {isSigningIn ? "Signing in..." : "Continue with Google"}
                </Button>
              </TabsContent>

              <TabsContent value="signup" className="space-y-4 mt-4">
                {/* Passkey Sign Up */}
                {isPasskeySupported && (
                  <form onSubmit={handlePasskeySignUp} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-gray-300">Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input
                          id="email"
                          type="email"
                          placeholder="you@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="pl-10 bg-gray-700 border-gray-600 text-white placeholder:text-gray-400"
                          disabled={isLoading}
                        />
                      </div>
                    </div>
                    <Button
                      type="submit"
                      disabled={isLoading || !email}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
                      size="lg"
                    >
                      {isPasskeyLoading ? (
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      ) : (
                        <KeyRound className="w-5 h-5 mr-2" />
                      )}
                      {isPasskeyLoading ? "Creating account..." : "Create account with Passkey"}
                    </Button>
                  </form>
                )}

                {!isPasskeySupported && (
                  <div className="text-center text-gray-400 py-4">
                    <p>Passkeys are not supported on this device.</p>
                    <p className="text-sm mt-2">Please use Google Sign In instead.</p>
                  </div>
                )}

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-gray-600" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-gray-800 px-2 text-gray-400">Or</span>
                  </div>
                </div>

                {/* Google Sign Up */}
                <Button
                  onClick={() => handleGoogleSignIn(true)}
                  disabled={isLoading}
                  className="w-full bg-white hover:bg-gray-100 text-gray-900 font-medium"
                  size="lg"
                >
                  {isSigningIn ? (
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  ) : (
                    <Chrome className="w-5 h-5 mr-2" />
                  )}
                  {isSigningIn ? "Creating account..." : "Sign up with Google"}
                </Button>
              </TabsContent>
            </Tabs>

            {displayError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md">
                <p className="text-red-400 text-sm text-center">{displayError}</p>
              </div>
            )}

            <div className="text-center text-sm text-gray-400">
              <p>By signing in, you agree to our Terms of Service and Privacy Policy</p>
            </div>
          </CardContent>
        </Card>

        {/* Features Preview */}
        <div className="mt-8 grid grid-cols-1 gap-4 text-center">
          <div className="bg-gray-800/50 rounded-lg p-4">
            <h3 className="text-white font-medium mb-2">Organize Your Tasks</h3>
            <p className="text-gray-400 text-sm">
              Create private, shared, and public lists to manage your work and life
            </p>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-4">
            <h3 className="text-white font-medium mb-2">Collaborate with Teams</h3>
            <p className="text-gray-400 text-sm">
              Share lists with admins and set default task settings for consistency
            </p>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-4">
            <h3 className="text-white font-medium mb-2">Discover Public Tasks</h3>
            <p className="text-gray-400 text-sm">Browse and copy tasks from public lists shared by the community</p>
          </div>
        </div>
      </div>
    </div>
  )
}
