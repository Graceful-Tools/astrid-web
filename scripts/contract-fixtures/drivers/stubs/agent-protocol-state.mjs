export const state = {
  mcpSettings: null,
  queue: { tasks: [], attention: [], notReadyCount: 0 },
  claim: {
    accessDenied: false,
    forceConflict: false,
    agentAvailable: true,
    task: { statusRole: 'ready', completed: false, dueDateTime: null, comments: [] },
  },
}
