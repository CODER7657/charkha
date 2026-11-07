import type { AgentCard, AgentSkill } from "@a2a-js/sdk";

export type SkillSpec = {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
};

/**
 * Build a v1.0 Agent Card. The SDK's AgentCard is protobuf-shaped, so several
 * fields that look optional are required arrays - this helper fills them.
 *
 * Onboarding a new producer/processor is a new card, not new code. That is the
 * multi-tenancy story; keep it true.
 */
export const buildAgentCard = (args: {
  name: string;
  description: string;
  url: string;
  version?: string;
  skills: SkillSpec[];
}): AgentCard => ({
  name: args.name,
  description: args.description,
  version: args.version ?? "0.1.0",
  supportedInterfaces: [
    { url: args.url, protocolBinding: "JSONRPC", protocolVersion: "1.0", tenant: "" },
  ],
  provider: { organization: "Charkha", url: "https://github.com" } as AgentCard["provider"],
  capabilities: { streaming: true, pushNotifications: false, extensions: [] },
  securitySchemes: {
    bearer: {
      scheme: { $case: "httpAuthSecurityScheme", value: { scheme: "bearer", bearerFormat: "JWT", description: "agent-to-agent JWT" } },
    } as never,
  },
  securityRequirements: [{ schemes: { bearer: { list: [] } } } as never],
  defaultInputModes: ["application/json"],
  defaultOutputModes: ["application/json"],
  skills: args.skills.map<AgentSkill>((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    tags: s.tags ?? [],
    examples: s.examples ?? [],
    inputModes: ["application/json"],
    outputModes: ["application/json"],
    securityRequirements: [],
  })),
  signatures: [],
});
