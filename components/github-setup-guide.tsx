/**
 * GitHub Setup Guide Component
 * Embedded guide for setting up GitHub integration
 */

"use client"

import { BRAND } from '@/lib/brand/config'
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ExternalLink,
  CheckCircle,
  AlertCircle,
  Copy,
  Github,
  ArrowRight,
  ChevronDown,
  ChevronUp
} from "lucide-react"

interface SetupStep {
  id: string
  title: string
  description: string
  completed: boolean
}

export function GitHubSetupGuide() {
  const [expandedStep, setExpandedStep] = useState<string | null>("step1")
  // Initialize with empty string - will be set from window.location in useEffect
  // This prevents any insecure HTTP URLs from appearing even temporarily
  const [baseUrl, setBaseUrl] = useState("")

  // Detect the current base URL dynamically (ensures correct protocol in production)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const currentUrl = `${window.location.protocol}//${window.location.host}`
      setBaseUrl(currentUrl)
    }
  }, [])
  const [steps, setSteps] = useState<SetupStep[]>([
    {
      id: "step1",
      title: "Create GitHub App",
      description: "Set up a GitHub App with proper permissions",
      completed: false
    },
    {
      id: "step2",
      title: "Configure Environment",
      description: "Add GitHub App credentials to your environment",
      completed: false
    },
    {
      id: "step3",
      title: "Install App on Repository",
      description: "Grant access to your target repositories",
      completed: false
    },
    {
      id: "step4",
      title: "Connect in Settings",
      description: `Link your GitHub App to ${BRAND.appName}`,
      completed: false
    },
    {
      id: "step5",
      title: "Test Integration",
      description: "Verify the workflow with a test task",
      completed: false
    }
  ])

  const toggleStep = (stepId: string) => {
    setExpandedStep(expandedStep === stepId ? null : stepId)
  }

  const markCompleted = (stepId: string) => {
    setSteps(steps.map(step =>
      step.id === stepId ? { ...step, completed: true } : step
    ))
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

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
                Enable AI-powered code generation with automatic PR creation
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-4 mb-6">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <div className="font-medium text-green-800">What You&apos;ll Get</div>
              <ul className="text-sm text-green-700 mt-1 space-y-1">
                <li>• Automatic branch creation</li>
                <li>• Generated code commits</li>
                <li>• Pull request management</li>
                <li>• Comment-based approvals</li>
              </ul>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="font-medium text-blue-800">Time Required</div>
              <div className="text-sm text-blue-700 mt-1">
                ~10-15 minutes for complete setup
              </div>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
              <div className="font-medium text-purple-800">Prerequisites</div>
              <ul className="text-sm text-purple-700 mt-1 space-y-1">
                <li>• GitHub repository access</li>
                <li>• AI API key configured</li>
                <li>• Admin permissions</li>
              </ul>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-600">Progress:</span>
              <div className="w-32 bg-gray-200 rounded-full h-2">
                <div
                  className="bg-green-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(steps.filter(s => s.completed).length / steps.length) * 100}%` }}
                ></div>
              </div>
              <span className="text-sm text-gray-600">
                {steps.filter(s => s.completed).length}/{steps.length}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open('/github-setup', '_blank')}
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Detailed Guide
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Setup Steps */}
      <div className="space-y-4">
        {/* Step 1: Create GitHub App */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  steps[0].completed ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'
                }`}>
                  {steps[0].completed ? <CheckCircle className="w-5 h-5" /> : '1'}
                </div>
                <div>
                  <h3 className="font-medium">{steps[0].title}</h3>
                  <p className="text-sm text-gray-600">{steps[0].description}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleStep('step1')}
              >
                {expandedStep === 'step1' ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </Button>
            </div>
          </CardHeader>
          {expandedStep === 'step1' && (
            <CardContent className="pt-0">
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-medium mb-2">🔗 Quick Navigation</h4>
                  <p className="text-sm text-gray-700 mb-3">
                    Go to: <strong>GitHub.com</strong> → <strong>Settings</strong> → <strong>Developer settings</strong> → <strong>GitHub Apps</strong> → <strong>New GitHub App</strong>
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open('https://github.com/settings/apps/new', '_blank')}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Create GitHub App
                  </Button>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <h4 className="font-medium">📝 Basic Information</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between bg-gray-50 p-2 rounded">
                        <span className="text-gray-800"><strong>App name:</strong></span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard('astrid-code-assistant-' + Math.random().toString(36).substr(2, 5))}
                        >
                          <Copy className="w-3 h-3 mr-1" />
                          Copy
                        </Button>
                      </div>
                      <div className="bg-gray-100 p-2 rounded text-xs font-mono text-gray-800">
                        astrid-code-assistant-[username]
                      </div>

                      <div className="flex items-center justify-between bg-gray-50 p-2 rounded">
                        <span className="text-gray-800"><strong>Homepage URL:</strong></span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(baseUrl)}
                        >
                          <Copy className="w-3 h-3 mr-1" />
                          Copy
                        </Button>
                      </div>
                      <div className="bg-gray-100 p-2 rounded text-xs font-mono text-gray-800">
                        {baseUrl}
                      </div>

                      <div className="flex items-center justify-between bg-gray-50 p-2 rounded">
                        <span className="text-gray-800"><strong>Webhook URL:</strong></span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(`${baseUrl}/api/github/webhook`)}
                        >
                          <Copy className="w-3 h-3 mr-1" />
                          Copy
                        </Button>
                      </div>
                      <div className="bg-gray-100 p-2 rounded text-xs font-mono text-gray-800">
                        {baseUrl}/api/github/webhook
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h4 className="font-medium">🔐 Permissions & Events</h4>
                    <div className="space-y-2 text-sm">
                      <div>
                        <strong>Repository permissions:</strong>
                        <ul className="ml-4 mt-1 space-y-1">
                          <li>• Contents: Read & Write</li>
                          <li>• Issues: Read & Write</li>
                          <li>• Metadata: Read</li>
                          <li>• Pull requests: Read & Write</li>
                          <li>• Checks: Read & Write</li>
                        </ul>
                      </div>
                      <div>
                        <strong>Subscribe to events:</strong>
                        <ul className="ml-4 mt-1 space-y-1">
                          <li>• Issue comments</li>
                          <li>• Pull requests</li>
                          <li>• Check runs & suites</li>
                          <li>• Push</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <div className="flex items-start space-x-2">
                    <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5" />
                    <div className="text-sm text-yellow-800">
                      <strong>Important:</strong> After creating the app, generate and download the private key (.pem file) and save the App ID.
                    </div>
                  </div>
                </div>

                <Button
                  onClick={() => markCompleted('step1')}
                  className="w-full"
                  disabled={steps[0].completed}
                >
                  {steps[0].completed ? (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Completed
                    </>
                  ) : (
                    <>
                      Mark as Complete
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Step 2: Environment Configuration */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  steps[1].completed ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'
                }`}>
                  {steps[1].completed ? <CheckCircle className="w-5 h-5" /> : '2'}
                </div>
                <div>
                  <h3 className="font-medium">{steps[1].title}</h3>
                  <p className="text-sm text-gray-600">{steps[1].description}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleStep('step2')}
              >
                {expandedStep === 'step2' ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </Button>
            </div>
          </CardHeader>
          {expandedStep === 'step2' && (
            <CardContent className="pt-0">
              <div className="space-y-4">
                <div className="bg-black rounded-lg p-4">
                  <h4 className="font-medium mb-2 text-white">💻 Terminal Commands</h4>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <code className="text-green-400 text-sm">
                        cp ~/Downloads/*.pem ./github-app-private-key.pem
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard('cp ~/Downloads/*.pem ./github-app-private-key.pem')}
                      >
                        <Copy className="w-3 h-3 text-white" />
                      </Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <code className="text-green-400 text-sm">
                        node scripts/setup-private-key.js
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard('node scripts/setup-private-key.js')}
                      >
                        <Copy className="w-3 h-3 text-white" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <h4 className="font-medium mb-2">📝 Add to .env.local</h4>
                  <div className="space-y-2">
                    <div className="bg-gray-100 p-3 rounded font-mono text-xs overflow-x-auto">
                      <div># GitHub App Configuration</div>
                      <div>GITHUB_APP_ID=123456</div>
                      <div>GITHUB_APP_PRIVATE_KEY=&quot;-----BEGIN RSA PRIVATE KEY-----</div>
                      <div>[your formatted key here]</div>
                      <div>-----END RSA PRIVATE KEY-----&quot;</div>
                      <div>GITHUB_WEBHOOK_SECRET=your_secret_here</div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(`# GitHub App Configuration
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
[your formatted key here]
-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your_secret_here`)}
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Template
                    </Button>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex items-start space-x-2">
                    <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5" />
                    <div className="text-sm text-blue-800">
                      <strong>Remember:</strong> Restart your development server after adding environment variables.
                    </div>
                  </div>
                </div>

                <Button
                  onClick={() => markCompleted('step2')}
                  className="w-full"
                  disabled={steps[1].completed}
                >
                  {steps[1].completed ? (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Completed
                    </>
                  ) : (
                    <>
                      Mark as Complete
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Steps 3-5 with similar structure but collapsed by default */}
        {[
          {
            step: steps[2],
            stepId: 'step3',
            number: '3',
            content: (
              <div className="space-y-4">
                <p className="text-sm text-gray-700">
                  Install your GitHub App on the repositories you want to use with {BRAND.appName}.
                </p>
                <div className="bg-gray-50 rounded-lg p-4">
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Go to your GitHub App settings</li>
                    <li>Click &quot;Install App&quot; in sidebar</li>
                    <li>Select your account/organization</li>
                    <li>Choose &quot;Selected repositories&quot;</li>
                    <li>Select target repositories</li>
                    <li>Note the Installation ID from the URL</li>
                  </ol>
                </div>
                <Button
                  onClick={() => markCompleted('step3')}
                  className="w-full"
                  disabled={steps[2].completed}
                >
                  {steps[2].completed ? (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Completed
                    </>
                  ) : (
                    <>
                      Mark as Complete
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            )
          },
          {
            step: steps[3],
            stepId: 'step4',
            number: '4',
            content: (
              <div className="space-y-4">
                <p className="text-sm text-gray-700">
                  Connect your GitHub App to {BRAND.appName} through the GitHub Integration settings below.
                </p>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-sm text-blue-800">
                    After completing this step, scroll down to the GitHub Integration Settings section on this page.
                  </p>
                </div>
                <Button
                  onClick={() => markCompleted('step4')}
                  className="w-full"
                  disabled={steps[3].completed}
                >
                  {steps[3].completed ? (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Completed
                    </>
                  ) : (
                    <>
                      Mark as Complete
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            )
          },
          {
            step: steps[4],
            stepId: 'step5',
            number: '5',
            content: (
              <div className="space-y-4">
                <p className="text-sm text-gray-700">
                  Test your setup with a simple coding task.
                </p>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h4 className="font-medium mb-2">🧪 Test Task</h4>
                  <div className="space-y-2 text-sm">
                    <div><strong>Title:</strong> Create a Button component</div>
                    <div><strong>Description:</strong> Build a TypeScript React button with size and variant props</div>
                    <div><strong>Assign to:</strong> {BRAND.appName} Agent</div>
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-medium mb-2">✅ Expected Results</h4>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
                    <li>AI generates implementation plan</li>
                    <li>You comment &quot;approve&quot;</li>
                    <li>GitHub branch and PR created</li>
                    <li>Production-ready code committed</li>
                  </ol>
                </div>
                <Button
                  onClick={() => markCompleted('step5')}
                  className="w-full"
                  disabled={steps[4].completed}
                >
                  {steps[4].completed ? (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Completed
                    </>
                  ) : (
                    <>
                      Mark as Complete
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            )
          }
        ].map(({ step, stepId, number, content }) => (
          <Card key={stepId}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    step.completed ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'
                  }`}>
                    {step.completed ? <CheckCircle className="w-5 h-5" /> : number}
                  </div>
                  <div>
                    <h3 className="font-medium">{step.title}</h3>
                    <p className="text-sm text-gray-600">{step.description}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleStep(stepId)}
                >
                  {expandedStep === stepId ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </CardHeader>
            {expandedStep === stepId && (
              <CardContent className="pt-0">
                {content}
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {/* Success Message */}
      {steps.every(step => step.completed) && (
        <Card className="bg-green-50 border-green-200">
          <CardContent className="pt-6">
            <div className="text-center">
              <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-green-800 mb-2">
                🎉 GitHub Integration Complete!
              </h3>
              <p className="text-green-700 mb-4">
                Your {BRAND.appName} Agent is now ready to create branches, generate code, and manage pull requests automatically.
              </p>
              <Button
                onClick={() => window.open('/', '_blank')}
                className="bg-green-600 hover:bg-green-700"
              >
                Start Creating AI-Powered Tasks
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}