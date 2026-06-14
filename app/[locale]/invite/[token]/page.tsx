"use client"

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession, signIn } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { LoadingScreen } from "@/components/loading-screen"
import { CheckCircle, XCircle, Clock, UserPlus, List, Briefcase } from "lucide-react"

interface InvitationData {
  id: string
  email: string
  type: string
  sender: {
    name: string | null
    email: string
  } | null
  message: string | null
  expiresAt: string
}

export default function InvitePage() {
  const params = useParams<{ token?: string }>()
  const router = useRouter()
  const { data: session, status } = useSession()
  const token = typeof params?.token === "string" ? params.token : ""

  const [invitation, setInvitation] = useState<InvitationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [success, setSuccess] = useState(false)

  const fetchInvitation = useCallback(async () => {
    try {
      const response = await fetch(`/api/invitations/${token}`)
      const data = await response.json()

      if (response.ok) {
        setInvitation(data.invitation)
      } else {
        // If invitation not found, redirect based on login status
        if (data.error === "Invitation not found") {
          if (session?.user) {
            // User is logged in, redirect to home
            router.push('/')
          } else {
            // User is not logged in, redirect to signin
            router.push('/auth/signin')
          }
          return
        }
        setError(data.error || "Invitation not found")
      }
    } catch (err) {
      setError("Failed to load invitation")
    } finally {
      setLoading(false)
    }
  }, [token, session, router])

  useEffect(() => {
    if (token && status !== "loading") {
      fetchInvitation()
    }
  }, [token, status, fetchInvitation])

  const handleAccept = async () => {
    if (!session) {
      // Redirect to sign in with the invitation email pre-filled
      const signInUrl = `/auth/signin?email=${encodeURIComponent(invitation?.email || '')}&callbackUrl=${encodeURIComponent(window.location.href)}`
      router.push(signInUrl)
      return
    }

    setAccepting(true)
    try {
      const response = await fetch(`/api/invitations/${token}`, {
        method: 'POST'
      })
      
      const data = await response.json()

      if (response.ok) {
        setSuccess(true)
        // Redirect to main app after a short delay
        setTimeout(() => {
          router.push('/')
        }, 2000)
      } else {
        setError(data.error || "Failed to accept invitation")
      }
    } catch (err) {
      setError("Failed to accept invitation")
    } finally {
      setAccepting(false)
    }
  }

  const handleDecline = async () => {
    try {
      const response = await fetch(`/api/invitations/${token}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        setError("Invitation declined")
      }
    } catch (err) {
      setError("Failed to decline invitation")
    }
  }

  const getInvitationIcon = (type: string) => {
    switch (type) {
      case 'TASK_ASSIGNMENT':
        return <Briefcase className="w-8 h-8 text-blue-500" />
      case 'LIST_SHARING':
        return <List className="w-8 h-8 text-green-500" />
      case 'WORKSPACE_INVITE':
        return <UserPlus className="w-8 h-8 text-purple-500" />
      default:
        return <UserPlus className="w-8 h-8 text-blue-500" />
    }
  }

  const getInvitationTitle = (type: string) => {
    switch (type) {
      case 'TASK_ASSIGNMENT':
        return "Task Assignment"
      case 'LIST_SHARING':
        return "List Sharing"
      case 'WORKSPACE_INVITE':
        return "Workspace Invitation"
      default:
        return "Collaboration Invitation"
    }
  }

  const getInvitationDescription = (type: string, senderName: string) => {
    switch (type) {
      case 'TASK_ASSIGNMENT':
        return `${senderName} has assigned you a task and wants you to collaborate.`
      case 'LIST_SHARING':
        return `${senderName} has shared a task list with you.`
      case 'WORKSPACE_INVITE':
        return `${senderName} has invited you to join their workspace.`
      default:
        return `${senderName} has invited you to collaborate.`
    }
  }

  if (loading) {
    return <LoadingScreen />
  }

  if (error || !invitation) {
    return (
      <div className="fixed inset-0 bg-gray-900 flex items-center justify-center p-4 z-50">
        <Card className="w-full max-w-md bg-gray-800 border-gray-700">
          <CardHeader className="text-center">
            <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <CardTitle className="text-white">Invitation Error</CardTitle>
            <CardDescription className="text-gray-400">
              {error || "This invitation is no longer valid."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => router.push('/auth/signin')}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (success) {
    return (
      <div className="fixed inset-0 bg-gray-900 flex items-center justify-center p-4 z-50">
        <Card className="w-full max-w-md bg-gray-800 border-gray-700">
          <CardHeader className="text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <CardTitle className="text-white">Invitation Accepted!</CardTitle>
            <CardDescription className="text-gray-400">
              You&apos;ve successfully joined the collaboration. Redirecting to the app...
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const senderName = invitation.sender?.name || invitation.sender?.email || "Someone"
  const isExpired = new Date(invitation.expiresAt) < new Date()

  return (
    <div className="fixed inset-0 bg-gray-900 flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-md bg-gray-800 border-gray-700">
        <CardHeader className="text-center">
          {getInvitationIcon(invitation.type)}
          <CardTitle className="text-white mt-4">
            {getInvitationTitle(invitation.type)}
          </CardTitle>
          <CardDescription className="text-gray-400">
            {getInvitationDescription(invitation.type, senderName)}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Sender info */}
          <div className="flex items-center space-x-3 p-3 bg-gray-700 rounded-lg">
            <Avatar className="w-10 h-10">
              <AvatarFallback>
                {senderName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="text-white font-medium">{senderName}</div>
              <div className="text-gray-400 text-sm">{invitation.sender?.email}</div>
            </div>
          </div>

          {/* Message */}
          {invitation.message && (
            <div className="p-3 bg-gray-700 rounded-lg">
              <div className="text-gray-400 text-sm mb-1">Message:</div>
              <div className="text-white text-sm italic">&quot;{invitation.message}&quot;</div>
            </div>
          )}

          {/* Expiration */}
          <div className="flex items-center space-x-2 text-sm text-gray-400">
            <Clock className="w-4 h-4" />
            <span>
              Expires {new Date(invitation.expiresAt).toLocaleDateString()}
            </span>
          </div>

          {/* Email mismatch warning */}
          {session && session.user?.email !== invitation.email && (
            <div className="p-3 bg-yellow-900/50 border border-yellow-600 rounded-lg">
              <div className="text-yellow-400 text-sm">
                ⚠️ This invitation was sent to {invitation.email}, but you&apos;re signed in as {session.user?.email}.
                Please sign in with the correct account.
              </div>
            </div>
          )}

          {/* Actions */}
          {isExpired ? (
            <div className="text-center">
              <Badge variant="destructive">Expired</Badge>
              <p className="text-gray-400 text-sm mt-2">This invitation has expired.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {!session ? (
                <div className="space-y-2">
                  <Button onClick={handleAccept} className="w-full bg-blue-600 hover:bg-blue-700">
                    Sign In to Accept
                  </Button>
                  <p className="text-gray-400 text-xs text-center">
                    You&apos;ll be redirected to sign in with {invitation.email}
                  </p>
                </div>
              ) : session.user?.email === invitation.email ? (
                <Button 
                  onClick={handleAccept} 
                  disabled={accepting}
                  className="w-full bg-green-600 hover:bg-green-700"
                >
                  {accepting ? "Accepting..." : "Accept Invitation"}
                </Button>
              ) : (
                <Button 
                  onClick={() => signIn(undefined, { 
                    callbackUrl: window.location.href,
                    email: invitation.email 
                  })}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  Sign In with Correct Account
                </Button>
              )}
              
              <Button 
                onClick={handleDecline} 
                variant="outline" 
                className="w-full border-gray-600 text-gray-300"
              >
                Decline
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
