"use client"

import { BRAND } from '@/lib/brand/config'
import { Link } from "@/lib/i18n/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Heart,
  Bot,
  Code,
  GitBranch,
  Globe,
  MessageSquare,
  CheckCircle,
  ExternalLink,
  Github,
  Zap,
  Shield,
  Users,
  ArrowRight,
  Star,
  Play
} from "lucide-react"
import { scrollShellClassName } from "@/components/scroll-shell"

export default function AstridCodingPage() {
  const handleGetStarted = () => {
    window.open('https://github.com/apps/astrid-code-assistant/installations/new', '_blank')
  }

  const handleSignUp = () => {
    window.location.href = '/auth/signin'
  }

  return (
    <div className={`${scrollShellClassName} bg-gradient-to-br from-blue-50 via-white to-purple-50`}>
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Heart className="w-8 h-8 text-red-500 fill-red-500" />
              <span className="text-2xl font-bold text-gray-900">astrid</span>
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                Coding Agent
              </Badge>
            </div>
            <div className="flex items-center space-x-3">
              <Button variant="outline" onClick={handleSignUp}>
                Sign Up
              </Button>
              <Button onClick={handleGetStarted}>
                Get Started
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Hero Section */}
      <div className="max-w-6xl mx-auto px-4 py-16">
        <div className="text-center max-w-4xl mx-auto mb-16">
          <div className="flex items-center justify-center space-x-3 mb-6">
            <Bot className="w-16 h-16 text-blue-500" />
            <div className="text-left">
              <h1 className="text-5xl font-bold text-gray-900 mb-2">
                {BRAND.appName} Agent
              </h1>
              <p className="text-xl text-gray-600">
                AI-powered coding assistant that writes code, creates PRs, and deploys automatically
              </p>
            </div>
          </div>

          <div className="flex items-center justify-center space-x-4 mb-8">
            <div className="flex items-center space-x-2 text-sm text-gray-600">
              <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
              <span>Production-ready code</span>
            </div>
            <div className="flex items-center space-x-2 text-sm text-gray-600">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span>GitHub integration</span>
            </div>
            <div className="flex items-center space-x-2 text-sm text-gray-600">
              <Zap className="w-4 h-4 text-blue-500" />
              <span>Auto deployment</span>
            </div>
          </div>

          <div className="flex items-center justify-center space-x-4">
            <Button size="lg" onClick={handleGetStarted} className="bg-blue-600 hover:bg-blue-700">
              <Play className="w-5 h-5 mr-2" />
              Install GitHub App
            </Button>
            <Button size="lg" variant="outline" onClick={handleSignUp}>
              <ArrowRight className="w-5 h-5 mr-2" />
              Try {BRAND.appName} Free
            </Button>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          <Card className="bg-white/60 backdrop-blur-sm border-gray-200 hover:shadow-lg transition-shadow">
            <CardContent className="p-6 text-center">
              <Code className="w-12 h-12 text-blue-500 mx-auto mb-4" />
              <h3 className="font-semibold text-gray-900 mb-2">Code Generation</h3>
              <p className="text-sm text-gray-600">
                AI generates production-ready code from natural language descriptions
              </p>
            </CardContent>
          </Card>

          <Card className="bg-white/60 backdrop-blur-sm border-gray-200 hover:shadow-lg transition-shadow">
            <CardContent className="p-6 text-center">
              <GitBranch className="w-12 h-12 text-green-500 mx-auto mb-4" />
              <h3 className="font-semibold text-gray-900 mb-2">GitHub PRs</h3>
              <p className="text-sm text-gray-600">
                Automatically creates GitHub pull requests with proper branching
              </p>
            </CardContent>
          </Card>

          <Card className="bg-white/60 backdrop-blur-sm border-gray-200 hover:shadow-lg transition-shadow">
            <CardContent className="p-6 text-center">
              <Globe className="w-12 h-12 text-purple-500 mx-auto mb-4" />
              <h3 className="font-semibold text-gray-900 mb-2">Live Previews</h3>
              <p className="text-sm text-gray-600">
                Instant staging deployments via Vercel integration
              </p>
            </CardContent>
          </Card>

          <Card className="bg-white/60 backdrop-blur-sm border-gray-200 hover:shadow-lg transition-shadow">
            <CardContent className="p-6 text-center">
              <MessageSquare className="w-12 h-12 text-orange-500 mx-auto mb-4" />
              <h3 className="font-semibold text-gray-900 mb-2">Comment Actions</h3>
              <p className="text-sm text-gray-600">
                Control with simple comments: &quot;approve&quot;, &quot;merge&quot;, &quot;change X&quot;
              </p>
            </CardContent>
          </Card>
        </div>

        {/* How It Works */}
        <Card className="mb-16 bg-white/60 backdrop-blur-sm border-gray-200">
          <CardHeader>
            <CardTitle className="text-2xl text-center text-gray-900">How It Works</CardTitle>
            <CardDescription className="text-center text-gray-600">
              Complete workflow from task to production deployment
            </CardDescription>
          </CardHeader>
          <CardContent className="p-8">
            <div className="space-y-6">
              {[
                { step: 1, title: "Assign Task", desc: `Create a task and assign it to \"${BRAND.appName} Agent\"` },
                { step: 2, title: "AI Planning", desc: "Agent analyzes requirements and creates implementation plan" },
                { step: 3, title: "Review & Approve", desc: "Comment \"approve\" to start code generation" },
                { step: 4, title: "Code Generation", desc: "Agent writes code, creates GitHub branch and PR" },
                { step: 5, title: "Live Preview", desc: "Get instant staging deployment if Vercel is connected" },
                { step: 6, title: "Deploy", desc: "Comment \"merge\" to deploy or \"change X\" for modifications" }
              ].map((item, index) => (
                <div key={index} className="flex items-start space-x-4">
                  <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center text-sm font-medium">
                    {item.step}
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900">{item.title}</div>
                    <div className="text-gray-600">{item.desc}</div>
                  </div>
                  {index < 5 && (
                    <div className="hidden md:block w-px h-12 bg-gray-200 mt-4"></div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* GitHub App Benefits */}
        <Card className="mb-16 bg-gradient-to-r from-gray-50 to-blue-50 border-gray-200">
          <CardHeader>
            <div className="flex items-center justify-center space-x-3 mb-4">
              <Github className="w-8 h-8" />
              <CardTitle className="text-2xl text-gray-900">Official GitHub App</CardTitle>
            </div>
            <CardDescription className="text-center text-gray-600">
              Secure, maintained, and trusted by developers worldwide
            </CardDescription>
          </CardHeader>
          <CardContent className="p-8">
            <div className="grid md:grid-cols-3 gap-6">
              <div className="text-center">
                <Zap className="w-12 h-12 text-blue-500 mx-auto mb-4" />
                <h3 className="font-semibold text-gray-900 mb-2">Quick Setup</h3>
                <p className="text-sm text-gray-600">
                  No GitHub App creation needed - just install and connect in minutes
                </p>
              </div>
              <div className="text-center">
                <Shield className="w-12 h-12 text-green-500 mx-auto mb-4" />
                <h3 className="font-semibold text-gray-900 mb-2">Secure & Trusted</h3>
                <p className="text-sm text-gray-600">
                  Official app maintained by the {BRAND.appName} team with proper security practices
                </p>
              </div>
              <div className="text-center">
                <Users className="w-12 h-12 text-purple-500 mx-auto mb-4" />
                <h3 className="font-semibold text-gray-900 mb-2">Shared & Maintained</h3>
                <p className="text-sm text-gray-600">
                  Used by all {BRAND.appName} users - no individual app management required
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Interactive Actions */}
        <Card className="mb-16 bg-white/60 backdrop-blur-sm border-orange-200">
          <CardHeader>
            <CardTitle className="text-2xl text-center text-gray-900">Simple Comment Controls</CardTitle>
            <CardDescription className="text-center text-gray-600">
              Control the agent with natural language comments
            </CardDescription>
          </CardHeader>
          <CardContent className="p-8">
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg border border-green-200">
                <span className="font-semibold text-green-800">&quot;approve&quot;</span>
                <span className="text-sm text-green-700">Approves AI plan and starts implementation</span>
              </div>
              <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg border border-blue-200">
                <span className="font-semibold text-blue-800">&quot;merge&quot; or &quot;ship it&quot;</span>
                <span className="text-sm text-blue-700">Merges PR to production</span>
              </div>
              <div className="flex items-center justify-between p-4 bg-orange-50 rounded-lg border border-orange-200">
                <span className="font-semibold text-orange-800">&quot;change [feedback]&quot;</span>
                <span className="text-sm text-orange-700">Requests modifications with specific feedback</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CTA Section */}
        <Card className="bg-gradient-to-r from-blue-600 to-purple-600 text-white border-0">
          <CardContent className="p-12 text-center">
            <h2 className="text-3xl font-bold mb-4">Ready to Transform Your Development?</h2>
            <p className="text-xl mb-8 text-blue-100">
              Join thousands of developers using AI to ship faster than ever
            </p>
            <div className="flex items-center justify-center space-x-4">
              <Button size="lg" variant="secondary" onClick={handleGetStarted}>
                <Github className="w-5 h-5 mr-2" />
                Install GitHub App
              </Button>
              <Button size="lg" variant="outline" onClick={handleSignUp} className="bg-transparent text-white border-white hover:bg-white hover:text-blue-600">
                <ArrowRight className="w-5 h-5 mr-2" />
                Start Free Trial
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Footer */}
      <div className="bg-gray-900 text-white py-12">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Heart className="w-6 h-6 text-red-500 fill-red-500" />
              <span className="text-xl font-semibold">astrid</span>
              <span className="text-gray-400">Coding Agent</span>
            </div>
            <div className="flex items-center space-x-6">
              <a href="https://github.com/apps/astrid-code-assistant" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                <Github className="w-5 h-5" />
              </a>
              <Link href="/auth/signin" className="text-gray-400 hover:text-white transition-colors">
                Sign In
              </Link>
              <Link href="/auth/signin" className="text-gray-400 hover:text-white transition-colors">
                Sign Up
              </Link>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-gray-800 text-center text-gray-400">
            <p>&copy; 2024 {BRAND.appName}. All rights reserved. Powered by AI to accelerate your development workflow.</p>
          </div>
        </div>
      </div>
    </div>
  )
}