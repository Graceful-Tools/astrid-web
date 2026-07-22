"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Heart,
  ArrowLeft,
  List,
  CheckSquare,
  MessageSquare,
  Users,
  Settings,
  BookOpen
} from "lucide-react"
import { scrollShellClassName } from "@/components/scroll-shell"

export default function APIEndpointsPage() {
  const router = useRouter()

  return (
    <div className={`${scrollShellClassName} theme-bg-primary`}>
      {/* Header */}
      <div className="theme-header theme-border app-header">
        <div className="flex items-center space-x-4">
          <Button
            variant="ghost"
            onClick={() => router.push('/docs')}
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
            <span className="text-sm theme-text-primary">API Endpoints</span>
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
              <h1 className="text-2xl font-bold theme-text-primary">API Endpoints Reference</h1>
              <p className="theme-text-muted">Complete reference for all Astrid API v1 endpoints</p>
            </div>
          </div>

          {/* Base URL */}
          <Card className="theme-bg-secondary theme-border border-blue-500/30">
            <CardContent className="pt-6">
              <div className="flex items-start space-x-3">
                <div className="flex-1">
                  <div className="text-sm font-medium theme-text-primary mb-1">Base URL</div>
                  <code className="theme-bg-tertiary px-3 py-2 rounded text-sm block">
                    https://astrid.cc/api/v1
                  </code>
                  <p className="text-xs theme-text-muted mt-2">
                    All endpoints listed below are relative to this base URL
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tasks Endpoints */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <CheckSquare className="w-5 h-5 text-blue-500" />
                <span>Tasks</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                Manage tasks and to-do items
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* GET /tasks */}
              <div className="border-l-2 border-green-500 pl-3">
                <div className="flex items-center space-x-2 mb-2">
                  <code className="bg-green-500/20 text-green-500 px-2 py-1 rounded text-xs font-mono">GET</code>
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-sm font-mono">/tasks</code>
                </div>
                <p className="text-sm theme-text-muted mb-2">List all tasks for the authenticated user</p>
                <details className="text-xs theme-text-muted">
                  <summary className="cursor-pointer hover:text-blue-400">Query Parameters</summary>
                  <div className="mt-2 ml-4 space-y-1">
                    <div><code className="theme-bg-tertiary px-1 rounded">listId</code> - Filter by list ID</div>
                    <div><code className="theme-bg-tertiary px-1 rounded">status</code> - Filter by status (TODO, IN_PROGRESS, COMPLETED)</div>
                    <div><code className="theme-bg-tertiary px-1 rounded">limit</code> - Number of results (default: 100)</div>
                    <div><code className="theme-bg-tertiary px-1 rounded">offset</code> - Pagination offset</div>
                  </div>
                </details>
              </div>

              {/* POST /tasks */}
              <div className="border-l-2 border-blue-500 pl-3">
                <div className="flex items-center space-x-2 mb-2">
                  <code className="bg-blue-500/20 text-blue-500 px-2 py-1 rounded text-xs font-mono">POST</code>
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-sm font-mono">/tasks</code>
                </div>
                <p className="text-sm theme-text-muted mb-2">Create a new task</p>
                <details className="text-xs theme-text-muted">
                  <summary className="cursor-pointer hover:text-blue-400">Request Body</summary>
                  <pre className="mt-2 theme-bg-tertiary p-2 rounded overflow-x-auto">
                    <code>{`{
  "title": "Task title",
  "description": "Task description",
  "listId": "list-id",
  "status": "TODO",
  "priority": "MEDIUM",
  "dueDate": "2025-01-15T10:00:00Z"
}`}</code>
                  </pre>
                </details>
              </div>

              {/* GET /tasks/:id */}
              <div className="border-l-2 border-green-500 pl-3">
                <div className="flex items-center space-x-2 mb-2">
                  <code className="bg-green-500/20 text-green-500 px-2 py-1 rounded text-xs font-mono">GET</code>
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-sm font-mono">/tasks/:id</code>
                </div>
                <p className="text-sm theme-text-muted">Get a specific task by ID</p>
              </div>

              {/* PATCH /tasks/:id */}
              <div className="border-l-2 border-yellow-500 pl-3">
                <div className="flex items-center space-x-2 mb-2">
                  <code className="bg-yellow-500/20 text-yellow-500 px-2 py-1 rounded text-xs font-mono">PATCH</code>
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-sm font-mono">/tasks/:id</code>
                </div>
                <p className="text-sm theme-text-muted mb-2">Update a task</p>
                <details className="text-xs theme-text-muted">
                  <summary className="cursor-pointer hover:text-blue-400">Request Body</summary>
                  <pre className="mt-2 theme-bg-tertiary p-2 rounded overflow-x-auto">
                    <code>{`{
  "title": "Updated title",
  "status": "COMPLETED",
  "priority": "HIGH"
}`}</code>
                  </pre>
                </details>
              </div>

              {/* DELETE /tasks/:id */}
              <div className="border-l-2 border-red-500 pl-3">
                <div className="flex items-center space-x-2 mb-2">
                  <code className="bg-red-500/20 text-red-500 px-2 py-1 rounded text-xs font-mono">DELETE</code>
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-sm font-mono">/tasks/:id</code>
                </div>
                <p className="text-sm theme-text-muted">Delete a task</p>
              </div>
            </CardContent>
          </Card>

          {/* Lists Endpoints */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <List className="w-5 h-5 text-purple-500" />
                <span>Lists</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                Manage task lists and collections
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* GET /lists */}
              <div className="border-l-2 border-green-500 pl-3">
                <div className="flex items-center space-x-2 mb-2">
                  <code className="bg-green-500/20 text-green-500 px-2 py-1 rounded text-xs font-mono">GET</code>
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-sm font-mono">/lists</code>
                </div>
                <p className="text-sm theme-text-muted">Get all lists for the authenticated user</p>
              </div>

              {/* POST /lists */}
              <div className="border-l-2 border-blue-500 pl-3">
                <div className="flex items-center space-x-2 mb-2">
                  <code className="bg-blue-500/20 text-blue-500 px-2 py-1 rounded text-xs font-mono">POST</code>
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-sm font-mono">/lists</code>
                </div>
                <p className="text-sm theme-text-muted mb-2">Create a new list</p>
                <details className="text-xs theme-text-muted">
                  <summary className="cursor-pointer hover:text-blue-400">Request Body</summary>
                  <pre className="mt-2 theme-bg-tertiary p-2 rounded overflow-x-auto">
                    <code>{`{
  "name": "My List",
  "description": "List description",
  "color": "#3B82F6",
  "isPublic": false
}`}</code>
                  </pre>
                </details>
              </div>

              {/* GET /lists/:id */}
              <div className="border-l-2 border-green-500 pl-3">
                <div className="flex items-center space-x-2 mb-2">
                  <code className="bg-green-500/20 text-green-500 px-2 py-1 rounded text-xs font-mono">GET</code>
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-sm font-mono">/lists/:id</code>
                </div>
                <p className="text-sm theme-text-muted">Get a specific list by ID</p>
              </div>

              {/* PATCH /lists/:id */}
              <div className="border-l-2 border-yellow-500 pl-3">
                <div className="flex items-center space-x-2 mb-2">
                  <code className="bg-yellow-500/20 text-yellow-500 px-2 py-1 rounded text-xs font-mono">PATCH</code>
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-sm font-mono">/lists/:id</code>
                </div>
                <p className="text-sm theme-text-muted">Update a list</p>
              </div>

              {/* DELETE /lists/:id */}
              <div className="border-l-2 border-red-500 pl-3">
                <div className="flex items-center space-x-2 mb-2">
                  <code className="bg-red-500/20 text-red-500 px-2 py-1 rounded text-xs font-mono">DELETE</code>
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-sm font-mono">/lists/:id</code>
                </div>
                <p className="text-sm theme-text-muted">Delete a list</p>
              </div>
            </CardContent>
          </Card>

          {/* Comments Endpoints */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <MessageSquare className="w-5 h-5 text-green-500" />
                <span>Comments</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                Manage task comments and discussions
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* GET /tasks/:id/comments */}
              <div className="border-l-2 border-green-500 pl-3">
                <div className="flex items-center space-x-2 mb-2">
                  <code className="bg-green-500/20 text-green-500 px-2 py-1 rounded text-xs font-mono">GET</code>
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-sm font-mono">/tasks/:id/comments</code>
                </div>
                <p className="text-sm theme-text-muted">Get all comments for a task</p>
              </div>

              {/* POST /tasks/:id/comments */}
              <div className="border-l-2 border-blue-500 pl-3">
                <div className="flex items-center space-x-2 mb-2">
                  <code className="bg-blue-500/20 text-blue-500 px-2 py-1 rounded text-xs font-mono">POST</code>
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-sm font-mono">/tasks/:id/comments</code>
                </div>
                <p className="text-sm theme-text-muted mb-2">Add a comment to a task</p>
                <details className="text-xs theme-text-muted">
                  <summary className="cursor-pointer hover:text-blue-400">Request Body</summary>
                  <pre className="mt-2 theme-bg-tertiary p-2 rounded overflow-x-auto">
                    <code>{`{
  "content": "Comment text"
}`}</code>
                  </pre>
                </details>
              </div>

              {/* PATCH /comments/:id */}
              <div className="border-l-2 border-yellow-500 pl-3">
                <div className="flex items-center space-x-2 mb-2">
                  <code className="bg-yellow-500/20 text-yellow-500 px-2 py-1 rounded text-xs font-mono">PATCH</code>
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-sm font-mono">/comments/:id</code>
                </div>
                <p className="text-sm theme-text-muted">Update a comment</p>
              </div>

              {/* DELETE /comments/:id */}
              <div className="border-l-2 border-red-500 pl-3">
                <div className="flex items-center space-x-2 mb-2">
                  <code className="bg-red-500/20 text-red-500 px-2 py-1 rounded text-xs font-mono">DELETE</code>
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-sm font-mono">/comments/:id</code>
                </div>
                <p className="text-sm theme-text-muted">Delete a comment</p>
              </div>
            </CardContent>
          </Card>

          {/* User Settings Endpoints */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary flex items-center space-x-2">
                <Settings className="w-5 h-5 text-orange-500" />
                <span>User Settings</span>
              </CardTitle>
              <CardDescription className="theme-text-muted">
                Manage user preferences and settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* GET /users/me/settings */}
              <div className="border-l-2 border-green-500 pl-3">
                <div className="flex items-center space-x-2 mb-2">
                  <code className="bg-green-500/20 text-green-500 px-2 py-1 rounded text-xs font-mono">GET</code>
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-sm font-mono">/users/me/settings</code>
                </div>
                <p className="text-sm theme-text-muted">Get current user&apos;s settings</p>
              </div>

              {/* PATCH /users/me/settings */}
              <div className="border-l-2 border-yellow-500 pl-3">
                <div className="flex items-center space-x-2 mb-2">
                  <code className="bg-yellow-500/20 text-yellow-500 px-2 py-1 rounded text-xs font-mono">PATCH</code>
                  <code className="theme-bg-tertiary px-2 py-1 rounded text-sm font-mono">/users/me/settings</code>
                </div>
                <p className="text-sm theme-text-muted mb-2">Update user settings</p>
                <details className="text-xs theme-text-muted">
                  <summary className="cursor-pointer hover:text-blue-400">Request Body</summary>
                  <pre className="mt-2 theme-bg-tertiary p-2 rounded overflow-x-auto">
                    <code>{`{
  "theme": "dark",
  "reminderDefaults": {
    "enabled": true,
    "defaultTime": "09:00"
  }
}`}</code>
                  </pre>
                </details>
              </div>
            </CardContent>
          </Card>

          {/* Response Format */}
          <Card className="theme-bg-secondary theme-border">
            <CardHeader>
              <CardTitle className="theme-text-primary">Response Format</CardTitle>
              <CardDescription className="theme-text-muted">
                All API responses follow a consistent format
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="font-semibold theme-text-primary mb-2 text-sm">Success Response</h3>
                <pre className="theme-bg-tertiary p-3 rounded-lg overflow-x-auto">
                  <code className="text-xs text-gray-300">{`{
  "success": true,
  "data": {
    // Response data
  }
}`}</code>
                </pre>
              </div>

              <div>
                <h3 className="font-semibold theme-text-primary mb-2 text-sm">Error Response</h3>
                <pre className="theme-bg-tertiary p-3 rounded-lg overflow-x-auto">
                  <code className="text-xs text-gray-300">{`{
  "error": "Error message",
  "details": "Additional error information"
}`}</code>
                </pre>
              </div>
            </CardContent>
          </Card>

          {/* Back Navigation */}
          <div className="flex space-x-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => router.push('/docs')}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Documentation
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => router.push('/settings/api-access')}
            >
              Manage OAuth Apps
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
