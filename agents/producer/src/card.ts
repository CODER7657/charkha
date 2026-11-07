/**
 * OWNER: Harsh
 *
 * Agent identity, and nothing else. Deliberately free of `process.env`:
 * `loadEnv()` runs in the entrypoint's module BODY, and every import is
 * evaluated before that body runs - so anything reading env at import time
 * reads it before .env has been loaded. That is the exact bug #9 fixed; a
 * constants-only module cannot bring it back.
 *
 * The card itself is built in index.ts, after loadEnv(), like every other
 * agent.
 */
export const AGENT_NAME = "Charkha Producer";
export const AGENT_VERSION = "0.1.0";

/**
 * What goes in the ledger's `agentCardId` column. It names the exact card
 * that made a decision, so an auditor reading decision_log can fetch the card
 * at /.well-known/agent-card.json and see which skills it claimed.
 */
export const AGENT_CARD_ID = `${AGENT_NAME}@${AGENT_VERSION}`;
