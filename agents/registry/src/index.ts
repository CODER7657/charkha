import { loadEnv, buildAgentCard, startAgentServer } from "@charkha/a2a";
import { IssueCreditInput, LookupCreditInput, RetireCreditInput } from "@charkha/core";
import { issueCredit } from "./skills/issueCredit.ts";
import { retireCredit } from "./skills/retireCredit.ts";
import { lookupCredit } from "./skills/lookupCredit.ts";
import { getIssuer } from "./did.ts";
import { dbStore } from "./store.ts";
import { STATUS_LIST_ID, signStatusListCredential } from "./statusList.ts";

loadEnv();

const PORT = Number(process.env["REGISTRY_PORT"] ?? 4004);

const card = buildAgentCard({
  name: "Charkha Registry",
  description: "Computes net sequestered tonnes, issues the result as a W3C Verifiable Credential, and retires credits against a status list.",
  url: `${process.env["REGISTRY_URL"] ?? `http://localhost:${PORT}`}/a2a`,
  skills: [
    { id: "issueCredit", name: "Issue credit", description: "Compute net tCO2e for a verified batch and issue a Verifiable Credential.", tags: ["credential", "carbon"] },
    { id: "retireCredit", name: "Retire credit", description: "Retire an issued credit so it can never be double-sold.", tags: ["credential"] },
    { id: "lookupCredit", name: "Look up credit", description: "Read one credit by id: its status, its tonnage and the credential that backs it.", tags: ["credential", "read"] },
  ],
});

await startAgentServer({
  card,
  port: PORT,
  skills: {
    issueCredit: { input: IssueCreditInput, run: issueCredit },
    retireCredit: { input: RetireCreditInput, run: retireCredit },
    /* The only skill here that changes nothing, which is why it can be
       dispatched without a confirmation. */
    lookupCredit: { input: LookupCreditInput, run: lookupCredit },
  },
  /* Public, unauthenticated on purpose: a credential holder must be able to
     check whether a credit is still live without an account with us. */
  routes: (app) => {
    app.get("/did", (_req, res) => {
      try {
        res.json({ did: getIssuer().did });
      } catch (err) {
        res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    app.get(`/status/${STATUS_LIST_ID}`, (_req, res) => {
      void (async () => {
        try {
          const credits = await dbStore().listCredits();
          const jwt = await signStatusListCredential(credits, getIssuer());
          res.type("application/jwt").send(jwt);
        } catch (err) {
          res.status(503).json({ error: err instanceof Error ? err.message : String(err) });
        }
      })();
    });
  },
});
