"use client"

import { BRAND } from '@/lib/brand/config'
import React, { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Copy,
  CheckCircle2,
  Info,
  Zap,
  Bot,
  Key,
  Settings,
  Play,
  BookOpen
} from "lucide-react"
import { toast } from "sonner"

interface TutorialStep {
  title: string
  description: string
  action?: string
  code?: string
  external?: boolean
  link?: string
}

const CLAUDE_STEPS: TutorialStep[] = [
  {
    title: "Get Your Claude API Key",
    description: "Visit the Anthropic Console to obtain your API key",
    action: "Go to Anthropic Console → API Keys → Create Key",
    external: true,
    link: "https://console.anthropic.com/"
  },
  {
    title: `Add API Key to ${BRAND.appName}`,
    description: "Navigate to Settings → AI Service API Keys → Claude tab",
    action: "Paste your API key starting with 'sk-ant-' and click Save"
  },
  {
    title: "Configure List Permissions",
    description: "Set which lists Claude can access",
    action: "Settings → AI Agent Access → Manage List Permissions → Enable lists for Claude"
  },
  {
    title: "Test the Integration",
    description: "Create a task and assign it to 'Claude AI Assistant'",
    action: "Create a task → Set assignee to 'Claude AI Assistant' → Save"
  },
  {
    title: "Monitor AI Activity",
    description: "Claude will automatically receive task notifications and can update progress",
    action: "Watch for real-time updates in the task comments and status changes"
  }
]

const OPENAI_STEPS: TutorialStep[] = [
  {
    title: "Get Your OpenAI API Key",
    description: "Visit the OpenAI Platform to obtain your API key",
    action: "Go to OpenAI Platform → API Keys → Create new secret key",
    external: true,
    link: "https://platform.openai.com/api-keys"
  },
  {
    title: `Add API Key to ${BRAND.appName}`,
    description: "Navigate to Settings → AI Service API Keys → OpenAI tab",
    action: "Paste your API key starting with 'sk-' and click Save"
  },
  {
    title: "Create OpenAI Assistant",
    description: `Set up an Assistant with ${BRAND.appName} integration functions`,
    action: "Create Assistant with the function tools provided in the integration guide",
    code: `// OpenAI Assistant Function Tools for ${BRAND.appName}
[
  {
    "type": "function",
    "function": {
      "name": "astrid_get_task_details",
      "description": "Get detailed information about an assigned task",
      "parameters": {
        "type": "object",
        "properties": {
          "accessToken": { "type": "string", "description": "MCP access token" },
          "taskId": { "type": "string", "description": "Task ID" }
        },
        "required": ["accessToken", "taskId"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "astrid_update_task",
      "description": "Update task status or add progress",
      "parameters": {
        "type": "object",
        "properties": {
          "accessToken": { "type": "string" },
          "taskId": { "type": "string" },
          "completed": { "type": "boolean" },
          "progress": { "type": "string" }
        },
        "required": ["accessToken", "taskId"]
      }
    }
  }
]`
  },
  {
    title: "Configure List Permissions",
    description: "Set which lists the OpenAI Assistant can access",
    action: "Settings → AI Agent Access → Manage List Permissions → Enable lists for OpenAI"
  },
  {
    title: "Test the Integration",
    description: "Create a task and assign it to 'OpenAI Assistant'",
    action: "Create a task → Set assignee to 'OpenAI Assistant' → Save"
  }
]

const GEMINI_STEPS: TutorialStep[] = [
  {
    title: "Get Your Gemini API Key",
    description: "Visit Google AI Studio to obtain your API key",
    action: "Go to Google AI Studio → Get API Key → Create API Key",
    external: true,
    link: "https://aistudio.google.com/app/apikey"
  },
  {
    title: `Add API Key to ${BRAND.appName}`,
    description: "Navigate to Settings → AI Service API Keys → Gemini tab",
    action: "Paste your API key starting with 'AIza' and click Save"
  },
  {
    title: "Configure Gemini Function Calling",
    description: `Set up Gemini with ${BRAND.appName} integration functions`,
    action: "Use the provided function declarations in your Gemini application",
    code: `// Gemini Function Declarations for ${BRAND.appName}
const functionDeclarations = [
  {
    name: "astrid_get_task_details",
    description: "Get detailed information about an assigned task",
    parameters: {
      type: "OBJECT",
      properties: {
        accessToken: { type: "STRING", description: "MCP access token" },
        taskId: { type: "STRING", description: "Task ID" }
      },
      required: ["accessToken", "taskId"]
    }
  },
  {
    name: "astrid_update_task",
    description: "Update task status or properties",
    parameters: {
      type: "OBJECT",
      properties: {
        accessToken: { type: "STRING" },
        taskId: { type: "STRING" },
        completed: { type: "BOOLEAN" },
        progress: { type: "STRING" }
      },
      required: ["accessToken", "taskId"]
    }
  }
]`
  },
  {
    title: "Configure List Permissions",
    description: "Set which lists Gemini can access",
    action: "Settings → AI Agent Access → Manage List Permissions → Enable lists for Gemini"
  },
  {
    title: "Test the Integration",
    description: "Create a task and assign it to 'Google Gemini Assistant'",
    action: "Create a task → Set assignee to 'Google Gemini Assistant' → Save"
  }
]

export function AIAgentTutorial() {
  const [activeStep, setActiveStep] = useState<{ [key: string]: number }>({})
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedCode(id)
      toast.success("Copied to clipboard!")
      setTimeout(() => setCopiedCode(null), 2000)
    } catch (error) {
      toast.error("Failed to copy to clipboard")
    }
  }

  const StepList = ({ steps, serviceId }: { steps: TutorialStep[], serviceId: string }) => (
    <div className="space-y-4">
      {steps.map((step, index) => (
        <Card key={index} className="relative">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium">
                {index + 1}
              </div>
              <div className="flex-1">
                <CardTitle className="text-base flex items-center gap-2">
                  {step.title}
                  {step.external && <ExternalLink className="h-4 w-4 text-muted-foreground" />}
                </CardTitle>
                <CardDescription>{step.description}</CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            {step.action && (
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <Play className="h-4 w-4 text-green-600" />
                  <span className="font-medium text-sm">Action:</span>
                </div>
                <p className="text-sm text-muted-foreground bg-muted p-3 rounded-md">
                  {step.action}
                </p>
              </div>
            )}

            {step.code && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Settings className="h-4 w-4 text-blue-600" />
                    <span className="font-medium text-sm">Configuration:</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(step.code!, `${serviceId}-${index}`)}
                    className="h-8"
                  >
                    {copiedCode === `${serviceId}-${index}` ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <pre className="bg-slate-900 text-slate-100 p-4 rounded-md text-xs overflow-x-auto">
                  <code>{step.code}</code>
                </pre>
              </div>
            )}

            {step.external && step.link && (
              <div className="mt-3">
                <Button variant="outline" size="sm" asChild>
                  <a href={step.link} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open {step.title.split(' ')[1]} Console
                  </a>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="flex items-center gap-2">
          <BookOpen className="h-4 w-4" />
          AI Agent Setup Tutorial
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Set Up AI Agents to Help with Your Tasks
          </DialogTitle>
          <DialogDescription>
            Follow these step-by-step guides to integrate Claude, OpenAI, or Gemini with your {BRAND.appName} workspace.
            Once configured, you can assign tasks directly to AI agents and they&apos;ll help you complete them.
          </DialogDescription>
        </DialogHeader>

        <Alert className="mb-6">
          <Info className="h-4 w-4" />
          <AlertDescription>
            <strong>How it works:</strong> AI agents receive task assignments via webhooks,
            can read task details, add progress comments, and mark tasks as complete using
            {BRAND.appName}&apos;s MCP (Model Context Protocol) API.
          </AlertDescription>
        </Alert>

        <Tabs defaultValue="claude" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="claude" className="flex items-center gap-2">
              Claude
              <Badge variant="outline" className="text-xs">Recommended</Badge>
            </TabsTrigger>
            <TabsTrigger value="openai" className="flex items-center gap-2">
              OpenAI
            </TabsTrigger>
            <TabsTrigger value="gemini" className="flex items-center gap-2">
              💎 Gemini
            </TabsTrigger>
          </TabsList>

          <TabsContent value="claude" className="mt-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-4">
                <div>
                  <h3 className="text-lg font-semibold">Claude Integration</h3>
                  <p className="text-sm text-muted-foreground">
                    Claude excels at understanding complex tasks, providing detailed analysis,
                    and maintaining context across long conversations.
                  </p>
                </div>
              </div>
              <StepList steps={CLAUDE_STEPS} serviceId="claude" />
            </div>
          </TabsContent>

          <TabsContent value="openai" className="mt-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-4">
                <div>
                  <h3 className="text-lg font-semibold">OpenAI Assistant Integration</h3>
                  <p className="text-sm text-muted-foreground">
                    Leverage GPT-4&apos;s capabilities with OpenAI Assistants API and function calling
                    to automate task management workflows.
                  </p>
                </div>
              </div>
              <StepList steps={OPENAI_STEPS} serviceId="openai" />
            </div>
          </TabsContent>

          <TabsContent value="gemini" className="mt-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-lg flex items-center justify-center text-white font-bold">
                  💎
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Google Gemini Integration</h3>
                  <p className="text-sm text-muted-foreground">
                    Gemini&apos;s multimodal capabilities make it excellent for tasks involving
                    both text and data analysis.
                  </p>
                </div>
              </div>
              <StepList steps={GEMINI_STEPS} serviceId="gemini" />
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-6 p-4 bg-muted rounded-lg">
          <h4 className="font-medium mb-2 flex items-center gap-2">
            <Zap className="h-4 w-4" />
            What happens after setup?
          </h4>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• Create tasks and assign them to your AI agent</li>
            <li>• AI agents automatically receive notifications via webhooks</li>
            <li>• Watch as AI agents add progress comments and updates</li>
            <li>• Tasks are marked complete when the AI finishes the work</li>
            <li>• All activity is tracked with full audit history</li>
          </ul>
        </div>

        <Alert className="mt-4">
          <Key className="h-4 w-4" />
          <AlertDescription>
            <strong>Security:</strong> Your API keys are encrypted and stored securely.
            AI agents only have access to lists you explicitly enable in the permissions settings.
          </AlertDescription>
        </Alert>
      </DialogContent>
    </Dialog>
  )
}