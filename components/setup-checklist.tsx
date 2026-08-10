"use client"

import { useState, useEffect } from "react"
import { CheckCircle } from "lucide-react"

interface SetupChecklistProps {
  className?: string
}

export function SetupChecklist({ className }: SetupChecklistProps) {
  const [connectionStatus, setConnectionStatus] = useState<any>(null)

  useEffect(() => {
    checkConnectionStatus()
  }, [])

  const checkConnectionStatus = async () => {
    try {
      const response = await fetch('/api/v1/github/status')
      if (response.ok) {
        const data = await response.json()
        setConnectionStatus(data)
      }
    } catch (error) {
      console.error('Error checking connection status:', error)
    }
  }

  // Check for MCP tokens (simplified check for now)
  const hasMCPToken = connectionStatus?.mcpTokenCount > 0 || false

  return (
    <div className={`bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 ${className}`}>
      <h4 className="font-semibold theme-text-primary mb-3 flex items-center space-x-2">
        <span>Setup Checklist:</span>
      </h4>
      <ul className="space-y-2 text-sm">
        <li className="flex items-center">
          {connectionStatus?.hasAIKeys ? (
            <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
          ) : (
            <div className="w-4 h-4 border-2 border-gray-300 rounded-full mr-2" />
          )}
          <span className={connectionStatus?.hasAIKeys ? 'text-green-700' : 'text-gray-700'}>
            AI API Key Configured {connectionStatus?.aiProviders?.length ? `(${connectionStatus.aiProviders.join(', ')})` : ''}
          </span>
        </li>
        <li className="flex items-center">
          {connectionStatus?.isGitHubConnected ? (
            <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
          ) : (
            <div className="w-4 h-4 border-2 border-gray-300 rounded-full mr-2" />
          )}
          <span className={connectionStatus?.isGitHubConnected ? 'text-green-700' : 'text-gray-700'}>
            GitHub Connected ({connectionStatus?.repositoryCount || 0} repositories)
          </span>
        </li>
        <li className="flex items-center">
          {hasMCPToken ? (
            <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
          ) : (
            <div className="w-4 h-4 border-2 border-gray-300 rounded-full mr-2" />
          )}
          <span className={hasMCPToken ? 'text-green-700' : 'text-gray-700'}>
            MCP Token Created
          </span>
        </li>
      </ul>

      {connectionStatus?.isGitHubConnected && connectionStatus?.hasAIKeys && hasMCPToken && (
        <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
          <div className="flex items-center space-x-2">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <span className="font-medium text-green-700 dark:text-green-300">
              ✨ Prerequisites Complete! Add the secrets to your GitHub Repository and your agent will be ready to work!
            </span>
          </div>
        </div>
      )}
    </div>
  )
}