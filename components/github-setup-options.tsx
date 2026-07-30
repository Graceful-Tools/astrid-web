/**
 * GitHub Setup Options Component
 * Offers both shared and individual GitHub App setup
 */

"use client"

import { BRAND } from '@/lib/brand/config'
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ExternalLink,
  Users,
  User,
  Github,
  ArrowRight,
  CheckCircle,
  AlertTriangle
} from "lucide-react"

export function GitHubSetupOptions() {
  const [selectedOption, setSelectedOption] = useState<'shared' | 'individual' | null>(null)

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gray-900 rounded-lg flex items-center justify-center">
              <Github className="w-6 h-6 text-white" />
            </div>
            <div>
              <CardTitle>GitHub Integration Setup</CardTitle>
              <CardDescription>
                Choose how you want to connect GitHub repositories to your coding agent
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Setup Options */}
      <div className="grid md:grid-cols-2 gap-6">

        {/* Option 1: Shared GitHub App */}
        <Card className={`cursor-pointer transition-all ${
          selectedOption === 'shared' ? 'ring-2 ring-blue-500 border-blue-500' : 'hover:border-gray-300'
        }`} onClick={() => setSelectedOption('shared')}>
          <CardHeader>
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-lg">Shared GitHub App</CardTitle>
                <CardDescription>Use the main {BRAND.appName} Agent app</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <h4 className="font-medium text-green-800 mb-2">✅ Pros</h4>
                <ul className="text-sm text-green-700 space-y-1">
                  <li>• Simple one-click installation</li>
                  <li>• No GitHub App creation needed</li>
                  <li>• Maintained by {BRAND.appName} team</li>
                  <li>• Works immediately</li>
                </ul>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <h4 className="font-medium text-yellow-800 mb-2">⚠️ Considerations</h4>
                <ul className="text-sm text-yellow-700 space-y-1">
                  <li>• Requires trusting the main app</li>
                  <li>• Limited customization</li>
                </ul>
              </div>

              <div className="pt-2">
                <p className="text-sm text-gray-600 mb-3">
                  <strong>Best for:</strong> Most users who want quick setup
                </p>
                {selectedOption === 'shared' && (
                  <Button className="w-full">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Install {BRAND.appName} Agent
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Option 2: Individual GitHub App */}
        <Card className={`cursor-pointer transition-all ${
          selectedOption === 'individual' ? 'ring-2 ring-purple-500 border-purple-500' : 'hover:border-gray-300'
        }`} onClick={() => setSelectedOption('individual')}>
          <CardHeader>
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center">
                <User className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-lg">Individual GitHub App</CardTitle>
                <CardDescription>Create your own GitHub App</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <h4 className="font-medium text-green-800 mb-2">✅ Pros</h4>
                <ul className="text-sm text-green-700 space-y-1">
                  <li>• Full control over permissions</li>
                  <li>• Your own app credentials</li>
                  <li>• Customizable settings</li>
                  <li>• Complete ownership</li>
                </ul>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <h4 className="font-medium text-yellow-800 mb-2">⚠️ Considerations</h4>
                <ul className="text-sm text-yellow-700 space-y-1">
                  <li>• More complex setup (10-15 min)</li>
                  <li>• Requires GitHub App creation</li>
                  <li>• Environment configuration needed</li>
                </ul>
              </div>

              <div className="pt-2">
                <p className="text-sm text-gray-600 mb-3">
                  <strong>Best for:</strong> Developers who want full control
                </p>
                {selectedOption === 'individual' && (
                  <Button variant="outline" className="w-full">
                    <Github className="w-4 h-4 mr-2" />
                    Create GitHub App
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Selected Option Details */}
      {selectedOption && (
        <Card>
          <CardHeader>
            <CardTitle>
              {selectedOption === 'shared' ? 'Using Shared GitHub App' : 'Creating Individual GitHub App'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedOption === 'shared' ? (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-medium text-blue-800 mb-2">📋 Quick Setup Steps</h3>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-blue-700">
                    <li>Click the &quot;Install {BRAND.appName} Agent&quot; button above</li>
                    <li>Authorize the app for your repositories</li>
                    <li>Come back here and connect your installation</li>
                    <li>Start using AI-powered coding!</li>
                  </ol>
                </div>

                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="font-medium mb-2">🔗 Installation URL</h3>
                  <p className="text-sm text-gray-600 mb-2">
                    If the button doesn&apos;t work, use this direct link:
                  </p>
                  <code className="block bg-gray-100 p-2 rounded text-xs break-all">
                    https://github.com/apps/{BRAND.githubAppSlug}/installations/new
                  </code>
                </div>

                <Button className="w-full" size="lg">
                  <CheckCircle className="w-5 h-5 mr-2" />
                  I&apos;ve Installed the App - Connect It Now
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <h3 className="font-medium text-purple-800 mb-2">🛠 Individual Setup Process</h3>
                  <p className="text-sm text-purple-700 mb-3">
                    This will guide you through creating your own GitHub App with full control.
                  </p>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-purple-700">
                    <li>Create GitHub App with proper permissions</li>
                    <li>Configure environment variables</li>
                    <li>Install app on your repositories</li>
                    <li>Connect to {BRAND.appName} settings</li>
                    <li>Test the integration</li>
                  </ol>
                </div>

                <Button className="w-full" size="lg" variant="outline">
                  <ArrowRight className="w-5 h-5 mr-2" />
                  Start Individual Setup Guide
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Help Section */}
      <Card className="border-gray-200">
        <CardContent className="pt-6">
          <div className="flex items-start space-x-3">
            <AlertTriangle className="w-5 h-5 text-orange-500 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-gray-900 mb-1">Need Help Choosing?</p>
              <p className="text-gray-600">
                Most users should start with the <strong>Shared GitHub App</strong> for simplicity.
                You can always switch to an individual app later if you need more control.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}