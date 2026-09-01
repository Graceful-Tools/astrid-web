import { z } from 'zod'

const COMMENT_CONTENT_ERROR = 'content is required and must be a string'

export const routeIdParamsSchema = z.object({
  id: z.string().min(1, 'id is required'),
})

export const v1CommentUpdateRequestSchema = z.object({
  content: z
    .string({
      required_error: COMMENT_CONTENT_ERROR,
      invalid_type_error: COMMENT_CONTENT_ERROR,
    })
    .trim()
    .min(1, COMMENT_CONTENT_ERROR),
})

export type V1CommentUpdateRequest = z.infer<typeof v1CommentUpdateRequestSchema>
