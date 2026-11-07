import { loadEnv, buildAgentCard, startAgentServer } from "@charkha/a2a";
import { AssistantAskInput } from "@charkha/core";
import { answer } from "./answer.ts";

/* ------------------------------------------------------------------ *
 * OWNER: core
 *
 * Saathi - the agent a human talks to.
 *
 * The other four agents speak only to each other. This one takes a sentence
 * from a farmer or a municipal clerk, works out what they meant, plans which
 * of the EXISTING skills answer it, and calls them over A2A exactly as any
 * other agent would - same bearer token, same task lifecycle, same refusals.
 *
 * It owns no business logic and must never grow any. If answering something
 * requires new behaviour, that behaviour belongs in the agent that owns the
 * domain, and this one calls it. The moment this file starts deciding what a
 * credit is worth, we have two implementations of the carbon maths and one of
 * them is untested.
 *
 * NOT WIRED IN YET, on purpose. It is absent from AGENTS, from compose, from
 * the gateway and from health, so nothing that currently works can notice it.
 * Integration happens once the whole thing is proven, in one deliberate PR.
 * ------------------------------------------------------------------ */

loadEnv();

const PORT = Number(process.env["ASSISTANT_PORT"] ?? 4005);
const BASE_URL = process.env["ASSISTANT_URL"] ?? `http://localhost:${PORT}`;

const card = buildAgentCard({
  name: "Charkha Saathi",
  description:
    "Answers questions about the waste-to-carbon chain in English, Hindi, Punjabi and Gujarati, and performs actions on request by calling the producer, matchmaker, verifier and registry agents.",
  url: `${BASE_URL}/a2a`,
  skills: [
    {
      id: "answer",
      name: "Answer a question",
      description:
        "Resolve a natural-language request, plan which agents answer it, call them, and report the hops. Actions are proposed and require confirmation before they are performed.",
      tags: ["assistant", "multilingual", "orchestration"],
    },
  ],
});

await startAgentServer({
  card,
  port: PORT,
  skills: { answer: { input: AssistantAskInput, run: answer } },
});
