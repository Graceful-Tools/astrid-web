"use client"

import { BRAND } from '@/lib/brand/config'
import React, { useState, useEffect, useMemo, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Play,
  Copy,
  Code,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Key,
  Zap,
  User
} from "lucide-react"
import { toast } from "sonner"

interface APIEndpoint {
  name: string
  description: string
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  category: 'Tasks' | 'Lists' | 'Comments' | 'User'
  example: any
  requiresId?: boolean
}

interface TestResult {
  endpoint: string
  status: 'success' | 'error' | 'pending'
  response?: any
  error?: string
  duration?: number
  timestamp: Date
  statusCode?: number
}

type AuthMode = 'session' | 'oauth'

// Storage key for cached tokens
const TOKEN_STORAGE_KEY = 'astrid_api_test_tokens'

/**
 * OAuth API Testing Tool
 *
 * Interactive testing interface for Astrid API v1 endpoints
 * Supports both session-based auth (quick test) and OAuth tokens
 */
export function OAuthAPITester() {
  const searchParams = useSearchParams()
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>("")
  const [authMode, setAuthMode] = useState<AuthMode>('session')
  const [accessToken, setAccessToken] = useState<string>("")
  const [testResults, setTestResults] = useState<TestResult[]>([])
  const [loading, setLoading] = useState(false)
  const [inputData, setInputData] = useState<any>({})
  const [savedTaskIds, setSavedTaskIds] = useState<{id: string, title: string}[]>([])
  const [savedListIds, setSavedListIds] = useState<{id: string, name: string}[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string>("")
  const [selectedListId, setSelectedListId] = useState<string>("")
  const [completionFilter, setCompletionFilter] = useState<string>("all")

  // State for OAuth flow from URL params
  const [clientIdFromUrl, setClientIdFromUrl] = useState<string>("")
  const [clientNameFromUrl, setClientNameFromUrl] = useState<string>("")
  const [clientSecretInput, setClientSecretInput] = useState<string>("")
  const [obtainingToken, setObtainingToken] = useState(false)

  // Load cached tokens from sessionStorage
  const getCachedToken = useCallback((clientId: string): string | null => {
    if (typeof window === 'undefined') return null
    try {
      const cached = sessionStorage.getItem(TOKEN_STORAGE_KEY)
      if (cached) {
        const tokens = JSON.parse(cached)
        return tokens[clientId] || null
      }
    } catch {}
    return null
  }, [])

  // Save token to sessionStorage
  const cacheToken = useCallback((clientId: string, token: string) => {
    if (typeof window === 'undefined') return
    try {
      const cached = sessionStorage.getItem(TOKEN_STORAGE_KEY)
      const tokens = cached ? JSON.parse(cached) : {}
      tokens[clientId] = token
      sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens))
    } catch {}
  }, [])

  // Load token or client info from URL params
  useEffect(() => {
    const tokenParam = searchParams?.get('token')
    const clientIdParam = searchParams?.get('clientId')
    const clientNameParam = searchParams?.get('clientName')

    if (tokenParam) {
      setAccessToken(tokenParam)
      setAuthMode('oauth')
      // Cache the token if we have a client ID
      if (clientIdParam) {
        cacheToken(clientIdParam, tokenParam)
      }
      toast.success("Access token loaded")
    } else if (clientIdParam) {
      setClientIdFromUrl(clientIdParam)
      setClientNameFromUrl(clientNameParam || "OAuth App")
      setAuthMode('oauth')
      // Try to load cached token
      const cachedToken = getCachedToken(clientIdParam)
      if (cachedToken) {
        setAccessToken(cachedToken)
        toast.success("Using cached access token")
      }
    }
  }, [searchParams, cacheToken, getCachedToken])

  // API v1 Endpoints
  const apiEndpoints: APIEndpoint[] = useMemo(() => [
    // Tasks
    {
      name: "List all tasks",
      description: "Get all tasks for the authenticated user",
      method: "GET",
      path: "/api/v1/tasks",
      category: "Tasks",
      example: {}
    },
    {
      name: "Get task by ID",
      description: "Get a specific task with all details",
      method: "GET",
      path: "/api/v1/tasks/:id",
      category: "Tasks",
      requiresId: true,
      example: {}
    },
    {
      name: "Create task",
      description: "Create a new task",
      method: "POST",
      path: "/api/v1/tasks",
      category: "Tasks",
      example: {
        title: "Test task from API",
        description: "Created via OAuth API testing",
        listId: "LIST_ID",
        priority: "MEDIUM",
        status: "TODO"
      }
    },
    {
      name: "Update task",
      description: "Update an existing task",
      method: "PATCH",
      path: "/api/v1/tasks/:id",
      category: "Tasks",
      requiresId: true,
      example: {
        title: "Updated task title",
        status: "IN_PROGRESS",
        priority: "HIGH"
      }
    },
    {
      name: "Delete task",
      description: "Delete a task",
      method: "DELETE",
      path: "/api/v1/tasks/:id",
      category: "Tasks",
      requiresId: true,
      example: {}
    },
    // Lists
    {
      name: "List all lists",
      description: "Get all lists for the authenticated user",
      method: "GET",
      path: "/api/v1/lists",
      category: "Lists",
      example: {}
    },
    {
      name: "Get list by ID",
      description: "Get a specific list with details",
      method: "GET",
      path: "/api/v1/lists/:id",
      category: "Lists",
      requiresId: true,
      example: {}
    },
    {
      name: "Get tasks for list",
      description: "Get all tasks for a specific list (with optional completion filter)",
      method: "GET",
      path: "/api/lists/:id/tasks",
      category: "Lists",
      requiresId: true,
      example: {}
    },
    {
      name: "Create list",
      description: "Create a new list",
      method: "POST",
      path: "/api/v1/lists",
      category: "Lists",
      example: {
        name: "API Test List",
        description: "Created via OAuth API",
        color: "#3B82F6",
        isPublic: false
      }
    },
    {
      name: "Update list",
      description: "Update list properties",
      method: "PATCH",
      path: "/api/v1/lists/:id",
      category: "Lists",
      requiresId: true,
      example: {
        name: "Updated List Name",
        color: "#10B981"
      }
    },
    {
      name: "Delete list",
      description: "Delete a list",
      method: "DELETE",
      path: "/api/v1/lists/:id",
      category: "Lists",
      requiresId: true,
      example: {}
    },
    // Comments
    {
      name: "Get task comments",
      description: "Get all comments for a task",
      method: "GET",
      path: "/api/v1/tasks/:id/comments",
      category: "Comments",
      requiresId: true,
      example: {}
    },
    {
      name: "Add comment",
      description: "Add a comment to a task",
      method: "POST",
      path: "/api/v1/tasks/:id/comments",
      category: "Comments",
      requiresId: true,
      example: {
        content: "This is a test comment from the API"
      }
    },
    {
      name: "Update comment",
      description: "Update a comment",
      method: "PATCH",
      path: "/api/v1/comments/:id",
      category: "Comments",
      requiresId: true,
      example: {
        content: "Updated comment text"
      }
    },
    {
      name: "Delete comment",
      description: "Delete a comment",
      method: "DELETE",
      path: "/api/v1/comments/:id",
      category: "Comments",
      requiresId: true,
      example: {}
    },
    // User Settings
    {
      name: "Get user settings",
      description: "Get current user's settings and preferences",
      method: "GET",
      path: "/api/v1/users/me/settings",
      category: "User",
      example: {}
    },
    {
      name: "Update user settings",
      description: "Update user settings and preferences",
      method: "PATCH",
      path: "/api/v1/users/me/settings",
      category: "User",
      example: {
        theme: "dark",
        reminderDefaults: {
          enabled: true,
          defaultTime: "09:00"
        }
      }
    }
  ], [])

  const replacePlaceholders = useCallback((obj: any, endpoint: APIEndpoint): any => {
    if (typeof obj !== 'object' || obj === null) {
      if (typeof obj === 'string') {
        if (obj === 'LIST_ID' && selectedListId) {
          return selectedListId
        }
      }
      return obj
    }

    if (Array.isArray(obj)) {
      return obj.map(item => replacePlaceholders(item, endpoint))
    }

    const result: any = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = replacePlaceholders(value, endpoint)
    }
    return result
  }, [selectedListId])

  useEffect(() => {
    if (selectedEndpoint) {
      const endpoint = apiEndpoints.find(ep => ep.name === selectedEndpoint)
      if (endpoint) {
        setInputData(replacePlaceholders(endpoint.example, endpoint))
      }
    }
  }, [selectedEndpoint, apiEndpoints, replacePlaceholders])

  const extractIdsFromResponse = (response: any, endpoint: APIEndpoint) => {
    if (!response) return

    // Extract task IDs
    if (endpoint.category === 'Tasks' || endpoint.name === "Get tasks for list") {
      // Check for array response (e.g., { tasks: [...] })
      if (Array.isArray(response.tasks)) {
        const tasks = response.tasks.map((task: any) => ({
          id: task.id,
          title: task.title || `Task ${task.id.slice(0, 8)}...`
        }))
        setSavedTaskIds(prev => {
          const existing = new Set(prev.map(t => t.id))
          const newTasks = tasks.filter((t: any) => !existing.has(t.id))
          return [...prev, ...newTasks]
        })
      }
      // Check for single task response (e.g., { task: {...} })
      else if (response.task?.id) {
        setSavedTaskIds(prev => {
          if (prev.some(t => t.id === response.task.id)) return prev
          return [...prev, { id: response.task.id, title: response.task.title || 'New Task' }]
        })
      }
    }

    // Extract list IDs
    if (endpoint.category === 'Lists') {
      // Check for array response (e.g., { lists: [...] })
      if (Array.isArray(response.lists)) {
        const lists = response.lists.map((list: any) => ({
          id: list.id,
          name: list.name || `List ${list.id.slice(0, 8)}...`
        }))
        setSavedListIds(prev => {
          const existing = new Set(prev.map(l => l.id))
          const newLists = lists.filter((l: any) => !existing.has(l.id))
          return [...prev, ...newLists]
        })
      }
      // Check for single list response (e.g., { list: {...} })
      else if (response.list?.id) {
        setSavedListIds(prev => {
          if (prev.some(l => l.id === response.list.id)) return prev
          return [...prev, { id: response.list.id, name: response.list.name || 'New List' }]
        })
      }
    }
  }

  const runTest = async () => {
    const endpoint = apiEndpoints.find(ep => ep.name === selectedEndpoint)
    if (!endpoint) return

    // Only require token in oauth mode
    if (authMode === 'oauth' && !accessToken) {
      toast.error("Please provide an access token or switch to Session mode")
      return
    }

    if (endpoint.requiresId && !selectedTaskId && !selectedListId) {
      toast.error("This endpoint requires selecting a saved ID")
      return
    }

    const startTime = Date.now()

    try {
      setLoading(true)

      const testResult: TestResult = {
        endpoint: endpoint.name,
        status: 'pending',
        timestamp: new Date()
      }

      setTestResults(prev => [testResult, ...prev])

      // Build the path with ID if needed
      let path = endpoint.path
      if (endpoint.requiresId) {
        const id = endpoint.category === 'Tasks' ? selectedTaskId :
                   endpoint.category === 'Lists' ? selectedListId :
                   selectedTaskId // Default to task ID for comments
        path = path.replace(':id', id || '')
      }

      // Add query parameters for "Get tasks for list" endpoint
      if (endpoint.name === "Get tasks for list" && completionFilter !== "all") {
        path += `?completion=${completionFilter}`
      }

      // Make the API call - use session cookies or OAuth token
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      }

      // Only add Authorization header for OAuth mode
      if (authMode === 'oauth' && accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`
      }

      const options: RequestInit = {
        method: endpoint.method,
        headers,
        // Include credentials for session-based auth
        credentials: authMode === 'session' ? 'include' : 'same-origin'
      }

      if (['POST', 'PATCH'].includes(endpoint.method)) {
        options.body = JSON.stringify(inputData)
      }

      console.log(`🔧 [API Test] ${authMode} mode: ${endpoint.method} ${path}`)

      const response = await fetch(path, options)
      const responseData = await response.json()

      console.log(`🔧 [API Test] Response:`, responseData)

      const duration = Date.now() - startTime

      if (!response.ok) {
        throw new Error(responseData.error || `HTTP ${response.status}`)
      }

      setTestResults(prev => prev.map(result =>
        result.endpoint === endpoint.name && result.status === 'pending'
          ? {
              ...result,
              status: 'success',
              response: responseData,
              duration,
              statusCode: response.status
            }
          : result
      ))

      extractIdsFromResponse(responseData, endpoint)

      toast.success(`${endpoint.name} completed in ${duration}ms`)

    } catch (error) {
      const duration = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      setTestResults(prev => prev.map(result =>
        result.endpoint === endpoint.name && result.status === 'pending'
          ? {
              ...result,
              status: 'error',
              error: errorMessage,
              duration
            }
          : result
      ))

      toast.error(`${endpoint.name} failed: ${errorMessage}`)

    } finally {
      setLoading(false)
    }
  }

  const obtainAccessToken = async () => {
    if (!clientIdFromUrl || !clientSecretInput) {
      toast.error("Client ID and secret are required")
      return
    }

    try {
      setObtainingToken(true)

      const response = await fetch('/api/v1/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: clientIdFromUrl,
          client_secret: clientSecretInput,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to obtain access token')
      }

      const data = await response.json()
      setAccessToken(data.access_token)
      // Cache the token for future use
      cacheToken(clientIdFromUrl, data.access_token)
      setClientSecretInput('') // Clear secret after use
      toast.success('Access token obtained and cached! Ready to test API')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to obtain token')
    } finally {
      setObtainingToken(false)
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Copied to clipboard")
    } catch (error) {
      toast.error("Failed to copy")
    }
  }

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'Tasks': return 'bg-blue-100 text-blue-800'
      case 'Lists': return 'bg-purple-100 text-purple-800'
      case 'Comments': return 'bg-green-100 text-green-800'
      case 'User': return 'bg-orange-100 text-orange-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle2 className="w-4 h-4 text-green-600" />
      case 'error': return <XCircle className="w-4 h-4 text-red-600" />
      case 'pending': return <Clock className="w-4 h-4 text-yellow-600 animate-spin" />
      default: return null
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-3xl font-bold flex items-center gap-2 theme-text-primary">
            <Code className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
            API Testing
          </h1>
          <p className="theme-text-muted text-sm mt-1">
            Test {BRAND.appName} API endpoints
          </p>
        </div>
        <Badge variant="outline" className="bg-blue-50 text-blue-700 self-start sm:self-auto">
          <Zap className="w-3 h-3 mr-1" />
          {apiEndpoints.length} Endpoints
        </Badge>
      </div>

      {/* Auth Mode Toggle */}
      <Card className="theme-bg-secondary theme-border">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              variant={authMode === 'session' ? 'default' : 'outline'}
              onClick={() => setAuthMode('session')}
              className="flex-1"
              size="sm"
            >
              <User className="w-4 h-4 mr-2" />
              Quick Test (Session)
            </Button>
            <Button
              variant={authMode === 'oauth' ? 'default' : 'outline'}
              onClick={() => setAuthMode('oauth')}
              className="flex-1"
              size="sm"
            >
              <Key className="w-4 h-4 mr-2" />
              OAuth Token
            </Button>
          </div>
          <p className="text-xs theme-text-muted mt-2 text-center">
            {authMode === 'session'
              ? "Uses your current login session - no token needed"
              : "Test with OAuth access tokens like external apps would"
            }
          </p>
        </CardContent>
      </Card>

      {/* OAuth Token Input (only shown in oauth mode) */}
      {authMode === 'oauth' && (
        <>
          {/* OAuth Client Secret Input (shown when clientId is in URL and no token) */}
          {clientIdFromUrl && !accessToken && (
            <Card className="theme-bg-secondary theme-border border-blue-500/50">
              <CardHeader className="pb-3">
                <CardTitle className="theme-text-primary flex items-center gap-2 text-base">
                  <Key className="w-5 h-5 text-blue-500" />
                  Get Token for {clientNameFromUrl}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label htmlFor="client-secret" className="text-sm">Client Secret</Label>
                  <Input
                    id="client-secret"
                    type="password"
                    value={clientSecretInput}
                    onChange={(e) => setClientSecretInput(e.target.value)}
                    placeholder="Paste your client secret"
                    className="font-mono text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && clientSecretInput) {
                        obtainAccessToken()
                      }
                    }}
                  />
                </div>
                <Button
                  onClick={obtainAccessToken}
                  disabled={obtainingToken || !clientSecretInput}
                  className="w-full"
                  size="sm"
                >
                  {obtainingToken ? 'Getting Token...' : 'Get Token'}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Manual token input */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader className="pb-3">
              <CardTitle className="theme-text-primary flex items-center gap-2 text-base">
                <Key className="w-5 h-5" />
                Access Token
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                rows={2}
                placeholder="Paste OAuth access token here"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                className="font-mono text-xs"
              />
              {accessToken && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-green-50 text-green-700">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Token ready
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAccessToken('')}
                    className="text-xs h-6"
                  >
                    Clear
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Testing Interface */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Endpoint Selection */}
        <Card className="theme-bg-secondary theme-border">
          <CardHeader className="pb-3">
            <CardTitle className="theme-text-primary text-base">Select Endpoint</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={selectedEndpoint} onValueChange={setSelectedEndpoint}>
              <SelectTrigger>
                <SelectValue placeholder="Choose an endpoint..." />
              </SelectTrigger>
              <SelectContent>
                {apiEndpoints.map((ep) => (
                  <SelectItem key={ep.name} value={ep.name}>
                    <div className="flex items-center gap-2">
                      <Badge className={getCategoryColor(ep.category)} variant="secondary">
                        {ep.method}
                      </Badge>
                      <span className="text-sm">{ep.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedEndpoint && (() => {
              const endpoint = apiEndpoints.find(ep => ep.name === selectedEndpoint)
              const isBodyRequired = endpoint && ['POST', 'PATCH'].includes(endpoint.method)
              const isTasksForList = endpoint?.name === "Get tasks for list"

              return (
                <>
                  {isBodyRequired && (
                    <div>
                      <Label className="text-sm">Request Body</Label>
                      <Textarea
                        rows={6}
                        placeholder="Request body..."
                        value={JSON.stringify(inputData, null, 2)}
                        onChange={(e) => {
                          try {
                            setInputData(JSON.parse(e.target.value || '{}'))
                          } catch {
                            // Invalid JSON - ignore
                          }
                        }}
                        className="font-mono text-xs"
                      />
                    </div>
                  )}

                  {isTasksForList && (
                    <div>
                      <Label className="text-sm">Filter</Label>
                      <Select value={completionFilter} onValueChange={setCompletionFilter}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All tasks</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                          <SelectItem value="incomplete">Incomplete</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              )
            })()}

            <Button
              onClick={runTest}
              disabled={!selectedEndpoint || loading || (authMode === 'oauth' && !accessToken)}
              className="w-full"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Run Test
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Latest Result */}
        {testResults.length > 0 && (
          <Card className="theme-bg-secondary theme-border border-l-4 border-l-blue-500">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-sm theme-text-primary flex items-center gap-2">
                  {getStatusIcon(testResults[0].status)}
                  <span className="truncate">{testResults[0].endpoint}</span>
                </CardTitle>
                <div className="flex items-center gap-2 text-xs theme-text-muted">
                  {testResults[0].statusCode && (
                    <Badge variant="outline">{testResults[0].statusCode}</Badge>
                  )}
                  {testResults[0].duration && (
                    <span>{testResults[0].duration}ms</span>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {testResults[0].status === 'success' && testResults[0].response && (
                <div>
                  <pre className="bg-green-50 text-green-900 p-2 sm:p-3 rounded text-xs overflow-x-auto max-h-64 sm:max-h-96 overflow-y-auto">
                    {JSON.stringify(testResults[0].response, null, 2)}
                  </pre>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => copyToClipboard(JSON.stringify(testResults[0].response, null, 2))}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Copy
                  </Button>
                </div>
              )}

              {testResults[0].status === 'error' && testResults[0].error && (
                <div className="bg-red-50 p-2 sm:p-3 rounded text-sm text-red-800">
                  {testResults[0].error}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Saved IDs for Testing */}
        <Card className="theme-bg-secondary theme-border">
          <CardHeader className="pb-3">
            <CardTitle className="theme-text-primary text-base">Saved IDs</CardTitle>
            <CardDescription className="theme-text-muted text-xs">
              For endpoints that require an ID
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">Task</Label>
                <Select value={selectedTaskId} onValueChange={setSelectedTaskId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select task" />
                  </SelectTrigger>
                  <SelectContent>
                    {savedTaskIds.map((task) => (
                      <SelectItem key={task.id} value={task.id}>
                        <span className="truncate">{task.title}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {savedTaskIds.length === 0 && (
                  <p className="text-xs theme-text-muted mt-1">
                    Run &quot;List all tasks&quot; first
                  </p>
                )}
              </div>

              <div>
                <Label className="text-sm">List</Label>
                <Select value={selectedListId} onValueChange={setSelectedListId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select list" />
                  </SelectTrigger>
                  <SelectContent>
                    {savedListIds.map((list) => (
                      <SelectItem key={list.id} value={list.id}>
                        <span className="truncate">{list.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {savedListIds.length === 0 && (
                  <p className="text-xs theme-text-muted mt-1">
                    Run &quot;List all lists&quot; first
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Endpoint Info - Hidden on mobile, shown on desktop */}
        <Card className="theme-bg-secondary theme-border hidden lg:block">
          <CardHeader className="pb-3">
            <CardTitle className="theme-text-primary text-base">Endpoint Details</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedEndpoint ? (
              <div className="space-y-3">
                {(() => {
                  const ep = apiEndpoints.find(e => e.name === selectedEndpoint)
                  if (!ep) return null

                  return (
                    <>
                      <div>
                        <p className="text-sm theme-text-muted">{ep.description}</p>
                      </div>

                      <div>
                        <code className="block theme-bg-tertiary px-2 py-1 rounded text-xs">
                          {ep.method} {ep.path}
                        </code>
                      </div>

                      {ep.requiresId && (
                        <div className="bg-yellow-50 border border-yellow-200 rounded p-2">
                          <p className="text-xs text-yellow-800">
                            Requires {ep.category === 'Tasks' ? 'Task' : 'List'} ID
                          </p>
                        </div>
                      )}

                      {/* Request Preview */}
                      <div className="border-t border-gray-200 pt-3">
                        <p className="text-xs font-medium theme-text-muted mb-2">Request Preview</p>
                        <code className="block bg-gray-900 text-green-400 px-2 py-1 rounded text-xs overflow-x-auto">
                          {ep.method} {(() => {
                            let path = ep.path
                            if (ep.requiresId) {
                              const id = ep.category === 'Tasks' ? selectedTaskId :
                                         ep.category === 'Lists' ? selectedListId :
                                         selectedTaskId
                              path = path.replace(':id', id || ':id')
                            }
                            return path
                          })()}
                        </code>
                        <pre className="bg-gray-900 text-blue-400 px-2 py-1 rounded text-xs mt-2">
{authMode === 'session' ? 'Cookie: (session)' : `Authorization: Bearer ${accessToken ? '...' : '<TOKEN>'}`}
                        </pre>
                      </div>
                    </>
                  )
                })()}
              </div>
            ) : (
              <p className="theme-text-muted text-sm text-center py-4">
                Select an endpoint
              </p>
            )}
          </CardContent>
        </Card>

        {/* Clear Results Button */}
        {testResults.length > 0 && (
          <div className="lg:col-span-2">
            <Button
              variant="outline"
              onClick={() => setTestResults([])}
              size="sm"
              className="w-full sm:w-auto"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Clear Results ({testResults.length})
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
