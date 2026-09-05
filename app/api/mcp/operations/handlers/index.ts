/**
 * MCP Operations Handlers - Barrel Export
 *
 * This module exports all MCP operation handlers from their respective modules.
 */

// Shared utilities
export {
  maskToken,
  redactArgsForLogging,
  getListMemberIdsByListId,
  getTokenAccessLevel,
  validateMCPToken,
  resolveMCPActor,
  determinePermissions,
  type ListForPermissions
} from './shared'

// Task operations
export {
  getListTasks,
  getUserTasks,
  createTask,
  updateTask,
  deleteTask,
  getTaskDetails,
  addTaskAttachment
} from './task-operations'

// List operations
export {
  getSharedLists,
  getPublicLists,
  copyPublicList,
  createList,
  updateList,
  deleteList
} from './list-operations'

// Member operations
export {
  getListMembers,
  addListMember,
  updateListMember,
  removeListMember
} from './member-operations'

// Comment operations
export {
  addComment,
  getTaskComments,
  deleteComment
} from './comment-operations'

// GitHub operations
export {
  getGitHubUserForRepository,
  getRepositoryFile,
  listRepositoryFiles,
  createBranch,
  commitChanges,
  createPullRequest,
  mergePullRequest,
  addPullRequestComment,
  getPullRequestComments,
  getRepositoryInfo
} from './github-operations'

// Deployment operations
export {
  deployToStaging,
  getDeploymentStatus,
  getDeploymentLogs,
  getDeploymentErrors,
  listDeployments
} from './deployment-operations'

// User operations
export {
  getUserSettings,
  updateUserSettings
} from './user-operations'
