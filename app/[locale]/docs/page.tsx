"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Heart,
  ArrowLeft,
  Code2,
  Shield,
  Key,
  Lock,
  ExternalLink,
  BookOpen,
  MessageSquare
} from "lucide-react"

export default function APIDocsPage() {
  const router = useRouter()
  const defaultOrigin = process.env.NEXT_PUBLIC_BASE_URL || "https://astrid.cc"
  const [hostOrigin, setHostOrigin] = useState(defaultOrigin)

  useEffect(() => {
    if (typeof window !== "undefined") {
      setHostOrigin(`${window.location.protocol}//${window.location.host}`)
    }
  }, [])

  const manifestUrl = `${hostOrigin}/.well-known/ai-plugin.json`
  const openApiUrl = `${hostOrigin}/.well-known/astrid-openapi.yaml`
  const redirectUri = "https://chat.openai.com/aip/api/v1/oauth/callback"

  return (
    <div className="min-h-screen theme-bg-primary">
      {/* Header */}
      <div className="theme-header theme-border app-header">
        <div className="flex items-center space-x-4">
          <Button
            variant="ghost"
            onClick={() => router.push('/settings/api-access')}
            className="p-2 hover:bg-opacity-20"
          >
            <ArrowLeft className="w-5 h-5 theme-text-primary" />
          </Button>
          <div
            className="flex items-center space-x-2 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => router.push('/')}
            title="Go to Home"
          >
            <Heart className="w-6 h-6 text-red-500 fill-red-500" />
            <span className="text-xl font-semibold theme-text-primary">astrid</span>
          </div>
          <div className="flex items-center space-x-1 theme-count-bg rounded-full px-3 py-1">
            <div className="w-2 h-2 theme-bg-tertiary rounded-full"></div>
            <span className="text-sm theme-text-primary">API Documentation</span>
          </div>
        </div>
      </div>

      {/* Documentation Content */}
      <div className="p-2 sm:p-4">
        <div className="max-w-sm sm:max-w-4xl mx-auto space-y-4 sm:space-y-6">
          {/* Page Header */}
          <div className="flex items-center space-x-3">
            <BookOpen className="w-8 h-8 text-blue-500" />
            <div>
              <h1 className="text-2xl font-bold theme-text-primary">Astrid API Documentation</h1>
              <p className="theme-text-muted">Build powerful integrations with the Astrid API</p>
            </div>
          </div>

          {/* Getting Started */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <Code2 className="w-5 h-5 text-blue-500" />
                <span>Getting Started</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                Learn how to authenticate and make your first API request
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="font-semibold theme-text-primary mb-2">1. Create an OAuth Application</h3>
                <p className="text-sm theme-text-muted mb-2">
                  Go to Settings → API Access and create a new OAuth application. You&apos;ll receive:
                </p>
                <ul className="list-disc list-inside text-sm theme-text-muted space-y-1 ml-2">
                  <li><code className="theme-bg-tertiary px-1 rounded text-xs">client_id</code> - Your application&apos;s public identifier</li>
                  <li><code className="theme-bg-tertiary px-1 rounded text-xs">client_secret</code> - Your application&apos;s secret (shown only once)</li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold theme-text-primary mb-2">2. Obtain an Access Token</h3>
                <p className="text-sm theme-text-muted mb-2">
                  Use the OAuth 2.0 Client Credentials flow to get an access token:
                </p>
                <pre className="theme-bg-tertiary p-3 rounded-lg overflow-x-auto">
                  <code className="text-xs text-gray-300">{`curl -X POST https://astrid.cc/api/oauth/token \\
  -H "Content-Type: application/json" \\
  -d '{
    "grant_type": "client_credentials",
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_CLIENT_SECRET"
  }'`}</code>
                </pre>
                <p className="text-xs theme-text-muted mt-2">
                  Response: <code className="theme-bg-tertiary px-1 rounded">{"{ \"access_token\": \"...\", \"expires_in\": 3600 }"}</code>
                </p>
              </div>

              <div>
                <h3 className="font-semibold theme-text-primary mb-2">3. Make API Requests</h3>
                <p className="text-sm theme-text-muted mb-2">
                  Include the access token in the Authorization header:
                </p>
                <pre className="theme-bg-tertiary p-3 rounded-lg overflow-x-auto">
                  <code className="text-xs text-gray-300">{`curl https://astrid.cc/api/v1/tasks \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"`}</code>
                </pre>
              </div>

              <div className="pt-2">
                <Button
                  variant="outline"
                  onClick={() => router.push('/docs/endpoints')}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View All API Endpoints
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Authentication */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <Shield className="w-5 h-5 text-green-500" />
                <span>Authentication</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                OAuth 2.0 Client Credentials Flow
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="font-semibold theme-text-primary mb-2">OAuth Endpoint</h3>
                <div className="space-y-2">
                  <div className="flex items-start space-x-2">
                    <code className="theme-bg-tertiary px-2 py-1 rounded text-xs font-mono">POST</code>
                    <code className="theme-bg-tertiary px-2 py-1 rounded text-xs font-mono flex-1">/api/oauth/token</code>
                  </div>
                  <p className="text-sm theme-text-muted ml-14">
                    Exchange your client credentials for an access token
                  </p>
                </div>
              </div>

              <div>
                <h3 className="font-semibold theme-text-primary mb-2">Request Body</h3>
                <pre className="theme-bg-tertiary p-3 rounded-lg overflow-x-auto">
                  <code className="text-xs text-gray-300">{`{
  "grant_type": "client_credentials",
  "client_id": "YOUR_CLIENT_ID",
  "client_secret": "YOUR_CLIENT_SECRET"
}`}</code>
                </pre>
              </div>

              <div>
                <h3 className="font-semibold theme-text-primary mb-2">Response</h3>
                <pre className="theme-bg-tertiary p-3 rounded-lg overflow-x-auto">
                  <code className="text-xs text-gray-300">{`{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600
}`}</code>
                </pre>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                <div className="flex items-start space-x-2">
                  <Lock className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium theme-text-primary">Security Best Practices</p>
                    <ul className="text-xs theme-text-muted space-y-1 mt-1 ml-4 list-disc">
                      <li>Store client secrets securely (never commit to version control)</li>
                      <li>Tokens expire after 1 hour - implement automatic refresh</li>
                      <li>Use HTTPS for all API requests</li>
                      <li>Rotate client secrets periodically</li>
                    </ul>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Rate Limits */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <Key className="w-5 h-5 text-purple-500" />
                <span>Rate Limits</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                API usage limits and best practices
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm theme-text-primary">Requests per minute</span>
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-xs">60</code>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm theme-text-primary">Requests per hour</span>
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-xs">1000</code>
                </div>
                <div className="pt-2 border-t theme-border">
                  <p className="text-xs theme-text-muted">
                    Rate limit headers are included in all API responses:
                  </p>
                  <ul className="text-xs theme-text-muted space-y-1 mt-2 ml-4">
                    <li><code className="theme-bg-tertiary px-1 rounded">X-RateLimit-Limit</code> - Total requests allowed</li>
                    <li><code className="theme-bg-tertiary px-1 rounded">X-RateLimit-Remaining</code> - Requests remaining</li>
                    <li><code className="theme-bg-tertiary px-1 rounded">X-RateLimit-Reset</code> - Time when limit resets</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ChatGPT Integration */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <MessageSquare className="w-5 h-5 text-purple-500" />
                <span>ChatGPT Actions</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                Use Astrid’s OAuth consent screen and OpenAPI spec to power custom GPTs.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="theme-text-muted">
                Publish a GPT action with Astrid’s manifest, then have users connect via OAuth to add, view, and complete tasks from ChatGPT.
              </p>
              <div className="space-y-2 font-mono text-xs theme-text-primary">
                <div>
                  Manifest: <code className="theme-bg-tertiary px-2 py-1 rounded">{manifestUrl}</code>
                </div>
                <div>
                  OpenAPI: <code className="theme-bg-tertiary px-2 py-1 rounded">{openApiUrl}</code>
                </div>
                <div>
                  Redirect URI: <code className="theme-bg-tertiary px-2 py-1 rounded">{redirectUri}</code>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full justify-between"
                onClick={() => router.push('/settings/chatgpt')}
              >
                <span>Open ChatGPT Integration Guide</span>
                <ExternalLink className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>

          {/* Error Codes */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary">Common Error Codes</CardTitle>
              <CardDescription className="theme-text-muted">
                HTTP status codes you may encounter
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-start space-x-3">
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-xs font-mono">400</code>
                  <div className="flex-1">
                    <div className="text-sm font-medium theme-text-primary">Bad Request</div>
                    <div className="text-xs theme-text-muted">Invalid request parameters or body</div>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-xs font-mono">401</code>
                  <div className="flex-1">
                    <div className="text-sm font-medium theme-text-primary">Unauthorized</div>
                    <div className="text-xs theme-text-muted">Missing or invalid access token</div>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-xs font-mono">403</code>
                  <div className="flex-1">
                    <div className="text-sm font-medium theme-text-primary">Forbidden</div>
                    <div className="text-xs theme-text-muted">Valid token but insufficient permissions</div>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-xs font-mono">404</code>
                  <div className="flex-1">
                    <div className="text-sm font-medium theme-text-primary">Not Found</div>
                    <div className="text-xs theme-text-muted">Resource doesn&apos;t exist</div>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-xs font-mono">429</code>
                  <div className="flex-1">
                    <div className="text-sm font-medium theme-text-primary">Too Many Requests</div>
                    <div className="text-xs theme-text-muted">Rate limit exceeded</div>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-xs font-mono">500</code>
                  <div className="flex-1">
                    <div className="text-sm font-medium theme-text-primary">Internal Server Error</div>
                    <div className="text-xs theme-text-muted">Something went wrong on our end</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Next Steps */}
          <Card className="theme-bg-secondary theme-border border-blue-500/30">
            <CardHeader>
              <CardTitle className="theme-text-primary">Next Steps</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant="outline"
                className="w-full justify-between"
                onClick={() => router.push('/docs/endpoints')}
              >
                <span>View Complete API Reference</span>
                <ExternalLink className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-between"
                onClick={() => router.push('/docs/openclaw')}
              >
                <span>OpenClaw Agent Protocol</span>
                <ExternalLink className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-between"
                onClick={() => router.push('/settings/api-testing')}
              >
                <span>Try API Testing Tool</span>
                <ExternalLink className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-between"
                onClick={() => router.push('/settings/api-access')}
              >
                <span>Manage OAuth Applications</span>
                <ExternalLink className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
