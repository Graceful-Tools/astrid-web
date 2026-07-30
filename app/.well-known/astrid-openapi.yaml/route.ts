import { BRAND } from '@/lib/brand/config'
import { capabilityGate } from '@/lib/brand/capabilities'
import { getBaseUrl } from '@/lib/base-url'

export async function GET() {
  const blocked = capabilityGate('integrationChatGptActions')
  if (blocked) return blocked

  const baseUrl = getBaseUrl()
  const yaml = `openapi: 3.1.0
info:
  title: ${BRAND.appName} Tasks API (ChatGPT Integration)
  version: "1.0.0"
  description: |
    ${BRAND.appName}'s OAuth-protected API for reading tasks, creating new work, and updating
    status directly from ChatGPT Actions. Use these endpoints to keep ${BRAND.appName} lists
    in sync while you collaborate with the assistant.
servers:
  - url: ${baseUrl}
security:
  - OAuth2: [tasks:read, tasks:write, lists:read, comments:write]
tags:
  - name: Tasks
    description: Manage ${BRAND.appName} tasks
  - name: Lists
    description: Discover available lists
paths:
  /api/v1/tasks:
    get:
      operationId: listTasks
      tags: [Tasks]
      summary: List tasks
      description: Retrieve tasks the authenticated user can access.
      parameters:
        - name: listId
          in: query
          schema:
            type: string
            format: uuid
          description: Filter tasks by list ID.
        - name: completed
          in: query
          schema:
            type: boolean
          description: Filter by completion status.
        - name: limit
          in: query
          schema:
            type: integer
            default: 100
            minimum: 1
            maximum: 1000
          description: Maximum number of items to return.
        - name: offset
          in: query
          schema:
            type: integer
            default: 0
            minimum: 0
          description: Result offset for pagination.
        - name: includeComments
          in: query
          schema:
            type: boolean
          description: Include the most recent comments for each task.
      responses:
        '200':
          description: Collection of tasks
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TaskCollectionResponse'
    post:
      operationId: createTask
      tags: [Tasks]
      summary: Create a task
      description: Create a new task in ${BRAND.appName}. Provide at least a title.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/TaskInput'
      responses:
        '201':
          description: Task created successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TaskResponse'
  /api/v1/tasks/{taskId}:
    get:
      operationId: getTask
      tags: [Tasks]
      summary: Get task details
      parameters:
        - name: taskId
          in: path
          required: true
          schema:
            type: string
            format: uuid
          description: ${BRAND.appName} task identifier.
      responses:
        '200':
          description: Task detail
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TaskResponse'
    put:
      operationId: updateTask
      tags: [Tasks]
      summary: Update a task
      description: Update task attributes, including marking a task complete.
      parameters:
        - name: taskId
          in: path
          required: true
          schema:
            type: string
            format: uuid
          description: ${BRAND.appName} task identifier.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/TaskUpdate'
      responses:
        '200':
          description: Updated task
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TaskResponse'
  /api/v1/lists:
    get:
      operationId: listLists
      tags: [Lists]
      summary: List available task lists
      description: Returns lists that the authenticated user owns or can access.
      responses:
        '200':
          description: Collection of lists
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ListCollectionResponse'
components:
  securitySchemes:
    OAuth2:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: ${baseUrl}/oauth/authorize
          tokenUrl: ${baseUrl}/api/v1/oauth/token
          scopes:
            tasks:read: Read tasks
            tasks:write: Create and update tasks
            lists:read: Read lists
            comments:write: Add comments to tasks
  schemas:
    UserSummary:
      type: object
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
          nullable: true
        email:
          type: string
          format: email
          nullable: true
    TaskListSummary:
      type: object
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
        color:
          type: string
          description: Hex color used in the UI.
    Task:
      type: object
      properties:
        id:
          type: string
          format: uuid
        title:
          type: string
        description:
          type: string
          nullable: true
        priority:
          type: integer
          minimum: 0
          maximum: 3
          default: 0
        completed:
          type: boolean
        when:
          type: string
          format: date
          nullable: true
          description: All-day date for the task.
        dueDateTime:
          type: string
          format: date-time
          nullable: true
        isPrivate:
          type: boolean
        lists:
          type: array
          items:
            $ref: '#/components/schemas/TaskListSummary'
        assignee:
          $ref: '#/components/schemas/UserSummary'
          nullable: true
        creator:
          $ref: '#/components/schemas/UserSummary'
          nullable: true
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
    TaskInput:
      type: object
      required: [title]
      properties:
        title:
          type: string
        description:
          type: string
        listIds:
          type: array
          items:
            type: string
            format: uuid
          description: Lists to associate with the task.
        priority:
          type: integer
          minimum: 0
          maximum: 3
          default: 0
        assigneeId:
          type: string
          format: uuid
        dueDateTime:
          type: string
          format: date-time
        when:
          type: string
          format: date
        isPrivate:
          type: boolean
          description: Defaults to true (private task).
    TaskUpdate:
      type: object
      properties:
        title:
          type: string
        description:
          type: string
        completed:
          type: boolean
          description: Set true to mark the task as done.
        priority:
          type: integer
          minimum: 0
          maximum: 3
        assigneeId:
          type: string
          format: uuid
        dueDateTime:
          type: string
          format: date-time
        when:
          type: string
          format: date
        listIds:
          type: array
          items:
            type: string
            format: uuid
        isPrivate:
          type: boolean
    TaskResponse:
      type: object
      properties:
        task:
          $ref: '#/components/schemas/Task'
        meta:
          type: object
          properties:
            apiVersion:
              type: string
            authSource:
              type: string
    TaskCollectionResponse:
      type: object
      properties:
        tasks:
          type: array
          items:
            $ref: '#/components/schemas/Task'
        meta:
          type: object
          properties:
            total:
              type: integer
            limit:
              type: integer
            offset:
              type: integer
            apiVersion:
              type: string
            authSource:
              type: string
    TaskList:
      type: object
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
        description:
          type: string
          nullable: true
        color:
          type: string
        privacy:
          type: string
          enum: [PRIVATE, SHARED, PUBLIC]
        taskCount:
          type: integer
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
    ListCollectionResponse:
      type: object
      properties:
        lists:
          type: array
          items:
            $ref: '#/components/schemas/TaskList'
        meta:
          type: object
          properties:
            total:
              type: integer
            apiVersion:
              type: string
            authSource:
              type: string
`

  return new Response(yaml, {
    headers: {
      'Content-Type': 'text/yaml; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=600',
    },
  })
}
