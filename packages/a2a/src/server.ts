import express from "express";
import type { AgentCard, Message, Part, Task } from "@a2a-js/sdk";
import { Role, TaskState } from "@a2a-js/sdk";
import {
  AgentEvent,
  DefaultRequestHandler,
  InMemoryTaskStore,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import { agentCardHandler, jsonRpcHandler } from "@a2a-js/sdk/server/express";
import { newId } from "@charkha/core";
import type { z } from "zod";
import { verifyAgentToken } from "./auth.ts";
import { tokenBucket } from "./ratelimit.ts";

/* ------------------------------------------------------------------ *
 * You do not need to read the A2A spec to write an agent here.
 *
 * Write a plain async function:
 *     async (input, ctx) => output
 *
 * This wrapper handles: task lifecycle (submitted -> working -> completed
 * / failed), Part encoding, event bus ordering, JWT auth and rate limits.
 * Throw inside your handler and the task correctly ends `failed`.
 * ------------------------------------------------------------------ */

export type SkillContext = {
  taskId: string;
  contextId: string;
  /** Push an intermediate progress line. Shows up live in the UI. */
  progress: (text: string) => void;
};

export type SkillHandler<I extends z.ZodTypeAny, O> = {
  input: I;
  run: (input: z.infer<I>, ctx: SkillContext) => Promise<O>;
};

/**
 * Registry entry. A `Record` of differently-typed handlers cannot use the
 * generic directly - a handler taking a concrete input is not assignable to
 * one taking the widest input. `never` in the parameter position is the
 * standard way out: every concrete handler fits, and authors still get full
 * typing at the registration site via SkillHandler.
 */
export type AnySkill = {
  input: z.ZodTypeAny;
  run: (input: never, ctx: SkillContext) => Promise<unknown>;
};

export type SkillMap = Record<string, AnySkill>;

const textPart = (value: string): Part => ({ content: { $case: "text", value }, metadata: undefined, filename: "" }) as Part;
const dataPart = (value: unknown): Part => ({ content: { $case: "data", value }, metadata: undefined, filename: "" }) as Part;

const readInvocation = (msg: Message): { skill: string; input: unknown } => {
  for (const p of msg.parts) {
    const c = p.content;
    if (c?.$case === "data" && c.value && typeof c.value === "object") {
      const v = c.value as Record<string, unknown>;
      if (typeof v["skill"] === "string") return { skill: v["skill"], input: v["input"] ?? {} };
    }
    if (c?.$case === "text") {
      try {
        const v = JSON.parse(c.value) as Record<string, unknown>;
        if (typeof v["skill"] === "string") return { skill: v["skill"], input: v["input"] ?? {} };
      } catch { /* not json, ignore */ }
    }
  }
  throw new Error("no invocation found: send a data part { skill, input }");
};

const agentMessage = (taskId: string, contextId: string, parts: Part[]): Message => ({
  messageId: newId("msg"),
  contextId,
  taskId,
  role: Role.ROLE_AGENT,
  parts,
  metadata: undefined,
  extensions: [],
  referenceTaskIds: [],
});

class SkillExecutor implements AgentExecutor {
  private readonly canceled = new Set<string>();
  constructor(private readonly skills: SkillMap) {}

  async execute(rc: RequestContext, bus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId } = rc;
    const now = () => new Date().toISOString();

    // First event MUST be a task or message - the server enforces this.
    const task: Task = {
      id: taskId,
      contextId,
      status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: now() },
      artifacts: [],
      history: [],
      metadata: undefined,
    } as Task;
    bus.publish(AgentEvent.task(task));

    const status = (state: TaskState, parts: Part[], final: boolean) =>
      bus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: { state, message: agentMessage(taskId, contextId, parts), timestamp: now() },
          final,
        } as never),
      );

    try {
      const { skill, input } = readInvocation(rc.userMessage);
      const handler = this.skills[skill];
      if (!handler) throw new Error(`unknown skill "${skill}" - available: ${Object.keys(this.skills).join(", ")}`);

      status(TaskState.TASK_STATE_WORKING, [textPart(`running ${skill}`)], false);

      // Validate at the boundary. Never trust an inbound payload.
      const parsed = handler.input.safeParse(input);
      if (!parsed.success) throw new Error(`invalid input for "${skill}": ${parsed.error.message}`);

      const ctx: SkillContext = {
        taskId,
        contextId,
        progress: (text) => {
          if (!this.canceled.has(taskId)) status(TaskState.TASK_STATE_WORKING, [textPart(text)], false);
        },
      };

      const output = await handler.run(parsed.data as never, ctx);
      if (this.canceled.has(taskId)) return;

      status(TaskState.TASK_STATE_COMPLETED, [dataPart(output)], true);
      bus.finished();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      status(TaskState.TASK_STATE_FAILED, [textPart(message)], true);
      bus.finished();
    }
  }

  async cancelTask(taskId: string, bus: ExecutionEventBus): Promise<void> {
    this.canceled.add(taskId);
    bus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId: "",
        status: { state: TaskState.TASK_STATE_CANCELED, message: undefined, timestamp: new Date().toISOString() },
        final: true,
      } as never),
    );
    bus.finished();
  }
}

export type AgentServerOptions = {
  card: AgentCard;
  skills: SkillMap;
  port: number;
  /** Extra plain REST routes (health, debug views). Optional. */
  routes?: (app: express.Express) => void;
};

export const startAgentServer = async (opts: AgentServerOptions): Promise<void> => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const limit = tokenBucket({ capacity: 60, refillPerSec: 2 });
  app.use((req, res, next) => {
    if (req.path === "/health") return next();
    if (!limit(req.ip ?? "anon")) return void res.status(429).json({ error: "rate limited" });
    next();
  });

  app.get("/health", (_req, res) => void res.json({ ok: true, agent: opts.card.name }));

  const handler = new DefaultRequestHandler(opts.card, new InMemoryTaskStore(), new SkillExecutor(opts.skills));

  // Agent Card is public on purpose - that is how discovery works.
  // Mount with app.use, not app.get: the SDK handler matches on its own path
  // once mounted, and the request handler already satisfies the provider
  // contract via getAgentCard().
  app.use("/.well-known/agent-card.json", agentCardHandler({ agentCardProvider: handler }));

  app.post(
    "/a2a",
    jsonRpcHandler({
      requestHandler: handler,
      userBuilder: (req) => {
        const claims = verifyAgentToken(req.headers.authorization);
        return claims
          ? ({ isAuthenticated: true, username: claims.sub } as never)
          : ({ isAuthenticated: false, username: "anonymous" } as never);
      },
    }),
  );

  opts.routes?.(app);

  await new Promise<void>((resolve) => {
    app.listen(opts.port, () => {
      console.log(`[${opts.card.name}] a2a on :${opts.port}  card /.well-known/agent-card.json`);
      resolve();
    });
  });
};
