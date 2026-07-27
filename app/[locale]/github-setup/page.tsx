/**
 * GitHub Integration Setup Guide Page
 * Accessible at /github-setup for all users
 */

import { BRAND } from '@/lib/brand/config'
import { Metadata } from 'next'
import { scrollShellClassName } from "@/components/scroll-shell"

export const metadata: Metadata = {
  title: `GitHub Integration Setup - ${BRAND.appName}`,
  description: 'Connect your GitHub repositories to enable AI-powered code generation workflows',
}

export default function GitHubSetupPage() {
  return (
    <div className={`${scrollShellClassName} bg-gray-50 py-8`}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            🔗 GitHub Integration Setup
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Connect your GitHub repositories to enable AI-powered code generation,
            automatic PR creation, and seamless development workflows.
          </p>
        </div>

        {/* Quick Status Check */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
          <h2 className="text-lg font-semibold text-blue-900 mb-2">
            📊 Current Setup Status
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex items-center">
              <span className="w-4 h-4 bg-green-500 rounded-full mr-2"></span>
              <span>AI Service Configured (OpenAI)</span>
            </div>
            <div className="flex items-center">
              <span className="w-4 h-4 bg-green-500 rounded-full mr-2"></span>
              <span>{BRAND.appName} Agent Available</span>
            </div>
            <div className="flex items-center">
              <span className="w-4 h-4 bg-yellow-500 rounded-full mr-2"></span>
              <span>GitHub Integration - <strong>Needs Setup</strong></span>
            </div>
          </div>
        </div>

        {/* Overview */}
        <div className="bg-white rounded-lg shadow-sm border p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">🎯 What You&apos;ll Get</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-medium text-green-700 mb-2">✅ Automatic Code Generation</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• AI creates feature branches</li>
                <li>• Generates production-ready code</li>
                <li>• Commits with descriptive messages</li>
                <li>• Opens pull requests automatically</li>
              </ul>
            </div>
            <div>
              <h3 className="font-medium text-blue-700 mb-2">🔄 Seamless Workflow</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Comment &quot;approve&quot; to start coding</li>
                <li>• Comment &quot;merge&quot; to deploy changes</li>
                <li>• Real-time progress updates</li>
                <li>• Integration with existing CI/CD</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Setup Steps */}
        <div className="space-y-8">

          {/* Step 1 */}
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <div className="flex items-center mb-4">
              <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold mr-3">
                1
              </div>
              <h2 className="text-xl font-semibold">Create GitHub App</h2>
            </div>

            <div className="ml-11 space-y-4">
              <p className="text-gray-600">
                First, we&apos;ll create a GitHub App to enable secure communication between {BRAND.appName} and your repositories.
              </p>

              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-medium mb-2">📍 Navigation Steps:</h3>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
                  <li>Go to <strong>GitHub.com</strong> → Your profile → <strong>Settings</strong></li>
                  <li>Scroll down to <strong>Developer settings</strong></li>
                  <li>Click <strong>GitHub Apps</strong></li>
                  <li>Click <strong>New GitHub App</strong></li>
                </ol>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h3 className="font-medium mb-2">⚙️ App Configuration:</h3>
                <div className="space-y-3 text-sm">
                  <div>
                    <strong>GitHub App name:</strong>
                    <code className="ml-2 bg-gray-100 px-2 py-1 rounded">
                      astrid-code-assistant-{'{your-username}'}
                    </code>
                  </div>
                  <div>
                    <strong>Homepage URL:</strong>
                    <code className="ml-2 bg-gray-100 px-2 py-1 rounded">
                      http://localhost:3000
                    </code>
                  </div>
                  <div>
                    <strong>Webhook URL:</strong>
                    <code className="ml-2 bg-gray-100 px-2 py-1 rounded">
                      http://localhost:3000/api/github/webhook
                    </code>
                  </div>
                  <div>
                    <strong>Webhook secret:</strong>
                    <span className="ml-2 text-gray-600">Generate a secure random string (save this!)</span>
                  </div>
                </div>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-medium mb-2">🔐 Repository Permissions:</h3>
                <div className="grid md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <strong>Required permissions:</strong>
                    <ul className="mt-1 space-y-1">
                      <li>• <strong>Contents:</strong> Read & Write</li>
                      <li>• <strong>Issues:</strong> Read & Write</li>
                      <li>• <strong>Metadata:</strong> Read</li>
                    </ul>
                  </div>
                  <div>
                    <ul className="mt-1 space-y-1">
                      <li>• <strong>Pull requests:</strong> Read & Write</li>
                      <li>• <strong>Checks:</strong> Read & Write</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h3 className="font-medium mb-2">📡 Subscribe to Events:</h3>
                <div className="grid md:grid-cols-2 gap-2 text-sm">
                  <div>
                    <label className="flex items-center">
                      <input type="checkbox" checked disabled className="mr-2" />
                      Issue comments
                    </label>
                    <label className="flex items-center">
                      <input type="checkbox" checked disabled className="mr-2" />
                      Pull requests
                    </label>
                    <label className="flex items-center">
                      <input type="checkbox" checked disabled className="mr-2" />
                      Check runs
                    </label>
                  </div>
                  <div>
                    <label className="flex items-center">
                      <input type="checkbox" checked disabled className="mr-2" />
                      Check suites
                    </label>
                    <label className="flex items-center">
                      <input type="checkbox" checked disabled className="mr-2" />
                      Push
                    </label>
                  </div>
                </div>
              </div>

              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <h3 className="font-medium mb-2">⚠️ Important:</h3>
                <ul className="text-sm space-y-1">
                  <li>• Select <strong>&quot;Only on this account&quot;</strong> for installation</li>
                  <li>• After creating, <strong>generate and download the private key</strong></li>
                  <li>• <strong>Save the App ID</strong> (you&apos;ll need it later)</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Step 2 */}
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <div className="flex items-center mb-4">
              <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold mr-3">
                2
              </div>
              <h2 className="text-xl font-semibold">Configure Environment Variables</h2>
            </div>

            <div className="ml-11 space-y-4">
              <p className="text-gray-600">
                Set up the connection credentials so {BRAND.appName} can communicate with your GitHub App.
              </p>

              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-medium mb-2">📁 File Setup:</h3>
                <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
                  <li>Move your downloaded <code>.pem</code> file to your project root</li>
                  <li>Rename it to: <code>github-app-private-key.pem</code></li>
                  <li>Run the key formatting script (see below)</li>
                  <li>Add the variables to your <code>.env.local</code> file</li>
                </ol>
              </div>

              <div className="bg-black rounded-lg p-4">
                <h3 className="font-medium mb-2 text-white">💻 Terminal Commands:</h3>
                <pre className="text-green-400 text-sm overflow-x-auto">
{`# 1. Move the private key file
cp ~/Downloads/astrid-code-assistant-*.private-key.pem ./github-app-private-key.pem

# 2. Format the key properly
node scripts/setup-private-key.js

# 3. The script will output the formatted key - copy it!`}
                </pre>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h3 className="font-medium mb-2">📝 Add to .env.local:</h3>
                <pre className="text-sm bg-gray-100 p-3 rounded overflow-x-auto">
{`# GitHub App Configuration
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
[paste the formatted key from the script output here]
-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your_webhook_secret_here`}
                </pre>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  <strong>💡 Pro Tip:</strong> After adding these variables, restart your development server
                  (<code>npm run dev</code>) for the changes to take effect.
                </p>
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <div className="flex items-center mb-4">
              <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold mr-3">
                3
              </div>
              <h2 className="text-xl font-semibold">Install GitHub App on Repository</h2>
            </div>

            <div className="ml-11 space-y-4">
              <p className="text-gray-600">
                Grant your GitHub App access to the repositories you want to use with {BRAND.appName}.
              </p>

              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-medium mb-2">📍 Installation Steps:</h3>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
                  <li>Go back to your <strong>GitHub App settings</strong></li>
                  <li>Click <strong>&quot;Install App&quot;</strong> in the left sidebar</li>
                  <li>Choose your <strong>account or organization</strong></li>
                  <li>Select <strong>&quot;Selected repositories&quot;</strong></li>
                  <li>Choose the repositories you want to enable for AI coding</li>
                  <li>Click <strong>&quot;Install&quot;</strong></li>
                </ol>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-medium mb-2">🔍 Find Your Installation ID:</h3>
                <p className="text-sm text-gray-700">
                  After installation, note the <strong>Installation ID</strong> from the URL:
                </p>
                <code className="block mt-2 text-xs bg-gray-100 p-2 rounded">
                  https://github.com/settings/installations/12345678
                </code>
                <p className="text-xs text-gray-600 mt-1">
                  In this example, your Installation ID is <strong>12345678</strong>
                </p>
              </div>
            </div>
          </div>

          {/* Step 4 */}
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <div className="flex items-center mb-4">
              <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold mr-3">
                4
              </div>
              <h2 className="text-xl font-semibold">Connect in {BRAND.appName} Settings</h2>
            </div>

            <div className="ml-11 space-y-4">
              <p className="text-gray-600">
                Finally, connect your GitHub App to {BRAND.appName} through the user settings.
              </p>

              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-medium mb-2">🔗 Connection Steps:</h3>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
                  <li>Go to <strong>User Settings</strong> → <strong>GitHub Integration</strong></li>
                  <li>Click <strong>&quot;Connect GitHub App&quot;</strong></li>
                  <li>Fill in your GitHub App details (see form below)</li>
                  <li>Select the repositories you want to enable</li>
                  <li>Save the configuration</li>
                </ol>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h3 className="font-medium mb-2">📋 Required Information:</h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <strong>App ID:</strong> <span className="text-gray-600">From Step 1 (e.g., 123456)</span>
                  </div>
                  <div>
                    <strong>Installation ID:</strong> <span className="text-gray-600">From Step 3 (e.g., 12345678)</span>
                  </div>
                  <div>
                    <strong>Private Key:</strong> <span className="text-gray-600">Formatted key from Step 2</span>
                  </div>
                  <div>
                    <strong>Webhook Secret:</strong> <span className="text-gray-600">Generated in Step 1</span>
                  </div>
                </div>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm text-green-800">
                  <strong>✅ Success!</strong> If all information is correct, you&apos;ll see your repositories
                  listed and can select which ones to enable for AI coding workflows.
                </p>
              </div>
            </div>
          </div>

          {/* Step 5 */}
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <div className="flex items-center mb-4">
              <div className="w-8 h-8 bg-green-100 text-green-600 rounded-full flex items-center justify-center font-semibold mr-3">
                5
              </div>
              <h2 className="text-xl font-semibold">Test Your Setup</h2>
            </div>

            <div className="ml-11 space-y-4">
              <p className="text-gray-600">
                Verify everything works with a simple test workflow.
              </p>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-medium mb-2">🧪 Test Task:</h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <strong>Title:</strong> Create a Button component
                  </div>
                  <div>
                    <strong>Description:</strong> Build a TypeScript React button component with props for size, variant, and onClick handler. Include proper TypeScript types.
                  </div>
                  <div>
                    <strong>Assignee:</strong> {BRAND.appName} Agent
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="font-medium mb-2">📝 Expected Workflow:</h3>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
                  <li>AI generates an implementation plan (appears as comment)</li>
                  <li>You reply with <code>&quot;approve&quot;</code></li>
                  <li>AI creates a new branch: <code>astrid-code-assistant/[timestamp]-create-button</code></li>
                  <li>AI generates and commits the component code</li>
                  <li>AI opens a pull request with detailed description</li>
                  <li>You can review the code and optionally comment <code>&quot;merge&quot;</code></li>
                </ol>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-medium mb-2">✅ Success Criteria:</h3>
                <ul className="list-disc list-inside space-y-1 text-sm text-green-800">
                  <li>Implementation plan is generated automatically</li>
                  <li>&quot;approve&quot; comment triggers code generation</li>
                  <li>GitHub branch and PR are created</li>
                  <li>Generated code is production-ready</li>
                  <li>All GitHub operations complete successfully</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Troubleshooting */}
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 mt-8">
          <h2 className="text-xl font-semibold text-red-800 mb-4">🛠 Troubleshooting</h2>
          <div className="space-y-4 text-sm">
            <div>
              <strong className="text-red-700">❌ &quot;No implementation plan generated&quot;</strong>
              <ul className="mt-1 ml-4 space-y-1 text-red-600">
                <li>• Check that AI API key is configured in User Settings</li>
                <li>• Verify task is assigned to &quot;{BRAND.appName} Agent&quot;</li>
                <li>• Look for JavaScript errors in browser console</li>
              </ul>
            </div>
            <div>
              <strong className="text-red-700">❌ &quot;GitHub operations fail&quot;</strong>
              <ul className="mt-1 ml-4 space-y-1 text-red-600">
                <li>• Verify all environment variables are set correctly</li>
                <li>• Check GitHub App has proper permissions</li>
                <li>• Ensure webhook URL is accessible</li>
                <li>• Restart development server after env changes</li>
              </ul>
            </div>
            <div>
              <strong className="text-red-700">❌ &quot;Approval comments don&apos;t work&quot;</strong>
              <ul className="mt-1 ml-4 space-y-1 text-red-600">
                <li>• Only task creators can approve plans</li>
                <li>• Use exact keywords: &quot;approve&quot;, &quot;approved&quot;, &quot;lgtm&quot;, etc.</li>
                <li>• Check workflow is in &quot;AWAITING_APPROVAL&quot; state</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Next Steps */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-8 text-center">
          <h2 className="text-xl font-semibold text-blue-800 mb-4">🎉 What&apos;s Next?</h2>
          <p className="text-blue-700 mb-4">
            Once your GitHub integration is working, you can leverage AI-powered development for:
          </p>
          <div className="grid md:grid-cols-3 gap-4 text-sm">
            <div className="bg-white rounded p-3">
              <strong>🏗 Full Features</strong>
              <p className="mt-1 text-gray-600">Complex implementations with multiple components and logic</p>
            </div>
            <div className="bg-white rounded p-3">
              <strong>🧪 API Integration</strong>
              <p className="mt-1 text-gray-600">Database models, API endpoints, and data handling</p>
            </div>
            <div className="bg-white rounded p-3">
              <strong>🎨 UI Components</strong>
              <p className="mt-1 text-gray-600">Reusable components with styling and interactions</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-8 pt-8 border-t border-gray-200">
          <p className="text-gray-500 text-sm">
            Need help? Check the browser console for errors or review the GitHub App configuration.
          </p>
        </div>
      </div>
    </div>
  )
}