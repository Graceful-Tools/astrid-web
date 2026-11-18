/**
 * The wire contract of an agent wake (AWTD-1556), in a module with no server
 * imports so the generated workflow recipes (lib/agent-skill/loop-recipes.ts,
 * rendered in the browser) listen for exactly what lib/agent-wake.ts sends.
 */

/** The repository_dispatch type a wake is sent as. */
export const WAKE_EVENT_TYPE = 'astrid-wake'
/** The mailbox of a wake for an unassigned Ready task: any loop may claim it. */
export const ANY_AGENT_MAILBOX = 'any'
