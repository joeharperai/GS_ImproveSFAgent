import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { executeAgentRun, runArchitectReview } from "./agent-engine";
import Anthropic from "@anthropic-ai/sdk";
import type { AgentStep } from "@shared/schema";

const client = new Anthropic();

// SSE connections registry for agent run streaming
const sseClients = new Map<number, Set<(step: AgentStep) => void>>();

export function registerRoutes(server: Server, app: Express) {
  // ====== CUSTOMER ROUTES ======
  app.get("/api/customers", (_req, res) => {
    const custs = storage.getCustomers();
    res.json(custs);
  });

  app.get("/api/customers/:id", (req, res) => {
    const cust = storage.getCustomer(parseInt(req.params.id));
    if (!cust) return res.status(404).json({ error: "Customer not found" });
    res.json(cust);
  });

  app.post("/api/customers", (req, res) => {
    const cust = storage.createCustomer({
      ...req.body,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json(cust);
  });

  app.patch("/api/customers/:id", (req, res) => {
    const cust = storage.updateCustomer(parseInt(req.params.id), req.body);
    if (!cust) return res.status(404).json({ error: "Customer not found" });
    res.json(cust);
  });

  app.delete("/api/customers/:id", (req, res) => {
    storage.deleteCustomer(parseInt(req.params.id));
    res.json({ success: true });
  });

  app.get("/api/customers/:id/orgs", (req, res) => {
    const orgs = storage.getOrgsByCustomer(parseInt(req.params.id));
    res.json(orgs);
  });

  // ====== ORG ROUTES ======
  app.get("/api/orgs", (_req, res) => {
    const orgs = storage.getOrgs();
    res.json(orgs);
  });

  app.post("/api/orgs", (req, res) => {
    const org = storage.createOrg(req.body);
    res.status(201).json(org);
  });

  app.patch("/api/orgs/:id", (req, res) => {
    const org = storage.updateOrg(parseInt(req.params.id), req.body);
    if (!org) return res.status(404).json({ error: "Org not found" });
    res.json(org);
  });

  app.delete("/api/orgs/:id", (req, res) => {
    storage.deleteOrg(parseInt(req.params.id));
    res.json({ success: true });
  });

  // Salesforce OAuth initiation
  app.post("/api/orgs/:id/connect", (req, res) => {
    const { clientId, clientSecret, instanceUrl } = req.body;
    const orgId = parseInt(req.params.id);
    const org = storage.getOrg(orgId);
    if (!org) return res.status(404).json({ error: "Org not found" });

    // Build callback URL — honor X-Forwarded headers from ngrok/proxies
    const proto = req.get("x-forwarded-proto") || req.protocol;
    const host = req.get("x-forwarded-host") || req.get("host");
    const redirectUri = `${proto}://${host}/api/oauth/callback`;

    const authUrl = `${instanceUrl}/services/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${orgId}`;

    // Persist clientId + clientSecret so the callback can use them for token exchange
    storage.updateOrg(orgId, {
      instanceUrl,
      clientId,
      clientSecret,
      status: "disconnected",
    });

    res.json({ authUrl, redirectUri });
  });

  // OAuth callback handler — exchanges auth code for access_token + refresh_token
  app.get("/api/oauth/callback", async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).send("Missing authorization code or state");
    }

    const orgId = parseInt(state as string);
    const org = storage.getOrg(orgId);
    if (!org) return res.status(404).send("Org not found");

    if (!org.clientId || !org.clientSecret) {
      return res.status(400).send("OAuth credentials not found — please initiate the connect flow again.");
    }

    // Build the same redirect URI that was used in the authorize request
    const proto = req.get("x-forwarded-proto") || req.protocol;
    const host = req.get("x-forwarded-host") || req.get("host");
    const redirectUri = `${proto}://${host}/api/oauth/callback`;

    try {
      // Exchange authorization code for tokens
      const tokenResponse = await fetch(`${org.instanceUrl}/services/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code as string,
          client_id: org.clientId,
          client_secret: org.clientSecret,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        const errBody = await tokenResponse.text();
        console.error("Salesforce token exchange failed:", errBody);
        return res.send(`
          <html><body style="font-family:system-ui;padding:2rem">
            <h2 style="color:#dc2626">Connection Failed</h2>
            <p>Salesforce returned an error during token exchange:</p>
            <pre style="background:#f3f4f6;padding:1rem;border-radius:8px;overflow-x:auto">${errBody}</pre>
            <p>Please close this window and try again.</p>
          </body></html>
        `);
      }

      const tokens = await tokenResponse.json() as {
        access_token: string;
        refresh_token?: string;
        instance_url: string;
        id: string;
      };

      // Persist tokens — the real instance_url from Salesforce may differ
      storage.updateOrg(orgId, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        instanceUrl: tokens.instance_url || org.instanceUrl,
        status: "connected",
        connectedAt: new Date().toISOString(),
      });

      res.send(`
        <html><body style="font-family:system-ui;padding:2rem;text-align:center">
          <h2 style="color:#16a34a">Connected Successfully</h2>
          <p>Your Salesforce org is now connected. You can close this window and return to the app.</p>
          <script>setTimeout(function(){ window.close(); }, 2000);</script>
        </body></html>
      `);
    } catch (error: any) {
      console.error("OAuth callback error:", error);
      res.status(500).send(`
        <html><body style="font-family:system-ui;padding:2rem">
          <h2 style="color:#dc2626">Connection Error</h2>
          <p>${error.message || "An unexpected error occurred."}</p>
          <p>Please close this window and try again.</p>
        </body></html>
      `);
    }
  });

  // Token refresh endpoint
  app.post("/api/orgs/:id/refresh-token", async (req, res) => {
    const org = storage.getOrg(parseInt(req.params.id));
    if (!org) return res.status(404).json({ error: "Org not found" });

    if (!org.refreshToken || !org.clientId || !org.clientSecret) {
      return res.status(400).json({ error: "Missing refresh token or OAuth credentials — reconnect the org" });
    }

    try {
      const tokenResponse = await fetch(`${org.instanceUrl}/services/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: org.refreshToken,
          client_id: org.clientId,
          client_secret: org.clientSecret,
        }),
      });

      if (!tokenResponse.ok) {
        const errBody = await tokenResponse.text();
        storage.updateOrg(org.id, { status: "error" });
        return res.status(401).json({ error: "Token refresh failed", details: errBody });
      }

      const tokens = await tokenResponse.json() as { access_token: string; instance_url?: string };
      storage.updateOrg(org.id, {
        accessToken: tokens.access_token,
        instanceUrl: tokens.instance_url || org.instanceUrl,
        status: "connected",
      });

      res.json({ success: true, message: "Token refreshed successfully" });
    } catch (error: any) {
      res.status(500).json({ error: "Token refresh error", details: error.message });
    }
  });

  app.post("/api/orgs/:id/test", async (req, res) => {
    const org = storage.getOrg(parseInt(req.params.id));
    if (!org) return res.status(404).json({ error: "Org not found" });

    if (org.accessToken && org.instanceUrl) {
      try {
        const response = await fetch(`${org.instanceUrl}/services/data/v60.0/`, {
          headers: { Authorization: `Bearer ${org.accessToken}` },
        });
        if (response.ok) {
          res.json({ success: true, message: "Connection verified" });
        } else {
          res.json({ success: false, message: "Authentication failed - please reconnect" });
        }
      } catch (e) {
        res.json({ success: false, message: "Could not reach Salesforce instance" });
      }
    } else {
      res.json({ success: false, message: "No credentials stored - please connect first" });
    }
  });

  // ====== REQUIREMENT ROUTES ======
  app.get("/api/requirements", (_req, res) => {
    const reqs = storage.getRequirements();
    res.json(reqs);
  });

  app.get("/api/requirements/:id", (req, res) => {
    const r = storage.getRequirement(parseInt(req.params.id));
    if (!r) return res.status(404).json({ error: "Requirement not found" });
    res.json(r);
  });

  app.post("/api/requirements", (req, res) => {
    const r = storage.createRequirement({
      ...req.body,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json(r);
  });

  app.patch("/api/requirements/:id", (req, res) => {
    const r = storage.updateRequirement(parseInt(req.params.id), req.body);
    if (!r) return res.status(404).json({ error: "Requirement not found" });
    res.json(r);
  });

  app.delete("/api/requirements/:id", (req, res) => {
    storage.deleteRequirement(parseInt(req.params.id));
    res.json({ success: true });
  });

  // ====== AI ANALYSIS (manual/standalone) ======
  app.post("/api/requirements/:id/analyze", async (req, res) => {
    const reqId = parseInt(req.params.id);
    const requirement = storage.getRequirement(reqId);
    if (!requirement) return res.status(404).json({ error: "Requirement not found" });

    storage.updateRequirement(reqId, { status: "analyzing" });

    try {
      const message = await client.messages.create({
        model: "claude_sonnet_4_6",
        max_tokens: 4096,
        messages: [{
          role: "user",
          content: `You are an expert Salesforce Technical Architect. Analyze this requirement and provide a detailed implementation plan.
You must follow the Salesforce Well-Architected Framework (Trusted, Easy, Adaptable pillars).

CRITICAL RULES:
- Bulkify all Apex/Flows — NO SOQL or DML inside loops
- No hardcoded IDs or org-specific values
- Follow FSC data model conventions where applicable
- Flag any governor limit risks (100 SOQL/sync, 150 DML, 10k DML records, 6MB heap)
- Use Flows over Process Builder/Workflow Rules (being retired)
- One trigger per object with handler pattern
- "with sharing" by default, CRUD/FLS enforcement
- Before-save Flows for same-record field updates
- API version 60.0

REQUIREMENT:
Title: ${requirement.title}
Description: ${requirement.description}
Category: ${requirement.category}
Priority: ${requirement.priority}

Respond with valid JSON only (no markdown, no code fences). Use this exact structure:
{
  "summary": "A 2-3 sentence summary of what needs to be built",
  "components": [
    {
      "type": "CustomObject | CustomField | Flow | ApexClass | ApexTrigger | LWC | ValidationRule | PermissionSet | Layout | Report | Dashboard | EmailTemplate | RecordType",
      "apiName": "The_API_Name__c",
      "label": "Human-readable label",
      "description": "What this component does",
      "order": 1
    }
  ],
  "dependencies": ["Description of each dependency between components"],
  "bestPractices": ["Specific Salesforce Well-Architected Framework best practices that apply"],
  "risks": [{ "risk": "Description of the risk", "mitigation": "How to mitigate it", "severity": "low | medium | high" }],
  "estimatedEffort": "e.g., 4-6 hours, 2-3 days, etc."
}`
        }]
      });

      const content = message.content[0];
      if (content.type !== "text") throw new Error("Unexpected response type");

      let parsed;
      try {
        parsed = JSON.parse(content.text);
      } catch {
        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        else throw new Error("Could not parse AI response as JSON");
      }

      const analysis = storage.createAnalysis({
        requirementId: reqId,
        summary: parsed.summary,
        componentsJson: JSON.stringify(parsed.components || []),
        dependenciesJson: JSON.stringify(parsed.dependencies || []),
        bestPracticesJson: JSON.stringify(parsed.bestPractices || []),
        risksJson: JSON.stringify(parsed.risks || []),
        estimatedEffort: parsed.estimatedEffort || "Unknown",
        createdAt: new Date().toISOString(),
      });

      storage.updateRequirement(reqId, { status: "analyzed" });
      res.json(analysis);
    } catch (error: any) {
      storage.updateRequirement(reqId, { status: "draft" });
      res.status(422).json({ error: "Analysis failed", details: error.message });
    }
  });

  app.get("/api/requirements/:id/analysis", (req, res) => {
    const analysis = storage.getAnalysisByRequirement(parseInt(req.params.id));
    if (!analysis) return res.status(404).json({ error: "No analysis found" });
    res.json(analysis);
  });

  // ====== METADATA GENERATION (manual/standalone) ======
  app.post("/api/requirements/:id/generate", async (req, res) => {
    const reqId = parseInt(req.params.id);
    const requirement = storage.getRequirement(reqId);
    if (!requirement) return res.status(404).json({ error: "Requirement not found" });

    const analysis = storage.getAnalysisByRequirement(reqId);
    if (!analysis) return res.status(400).json({ error: "Must analyze requirement first" });

    storage.updateRequirement(reqId, { status: "generating" });

    try {
      const components = JSON.parse(analysis.componentsJson);

      const message = await client.messages.create({
        model: "claude_sonnet_4_6",
        max_tokens: 8192,
        messages: [{
          role: "user",
          content: `You are an expert Salesforce developer. Generate the actual Salesforce metadata XML or Apex/LWC code for each component below.

REQUIREMENT: ${requirement.title}
DESCRIPTION: ${requirement.description}

COMPONENTS TO BUILD:
${JSON.stringify(components, null, 2)}

For each component, generate the complete, deployable metadata. Respond with valid JSON only (no markdown fences):
{
  "generatedComponents": [
    {
      "type": "The component type",
      "apiName": "The_API_Name",
      "label": "Human Label",
      "metadata": "The complete XML metadata or Apex/LWC code as a string"
    }
  ]
}

Follow Salesforce Metadata API v60.0 format.`
        }]
      });

      const content = message.content[0];
      if (content.type !== "text") throw new Error("Unexpected response type");

      let parsed;
      try {
        parsed = JSON.parse(content.text);
      } catch {
        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        else throw new Error("Could not parse AI response as JSON");
      }

      const generated = parsed.generatedComponents || [];
      const createdComponents = [];

      for (const comp of generated) {
        const created = storage.createComponent({
          requirementId: reqId,
          componentType: comp.type,
          apiName: comp.apiName,
          label: comp.label,
          metadataXml: comp.metadata,
          status: "pending",
          createdAt: new Date().toISOString(),
        });
        createdComponents.push(created);
      }

      storage.updateRequirement(reqId, { status: "ready" });
      res.json(createdComponents);
    } catch (error: any) {
      storage.updateRequirement(reqId, { status: "analyzed" });
      res.status(422).json({ error: "Generation failed", details: error.message });
    }
  });

  app.get("/api/requirements/:id/components", (req, res) => {
    const components = storage.getComponentsByRequirement(parseInt(req.params.id));
    res.json(components);
  });

  app.patch("/api/components/:id", (req, res) => {
    const comp = storage.updateComponent(parseInt(req.params.id), req.body);
    if (!comp) return res.status(404).json({ error: "Component not found" });
    res.json(comp);
  });

  // ====== LEGACY DEPLOYMENT (manual) ======
  app.post("/api/requirements/:id/deploy", async (req, res) => {
    const reqId = parseInt(req.params.id);
    const { orgId } = req.body;

    const requirement = storage.getRequirement(reqId);
    if (!requirement) return res.status(404).json({ error: "Requirement not found" });

    const org = storage.getOrg(orgId);
    if (!org) return res.status(404).json({ error: "Org not found" });

    const components = storage.getComponentsByRequirement(reqId);
    const approvedComponents = components.filter((c) => c.status === "approved");

    if (approvedComponents.length === 0) {
      return res.status(400).json({ error: "No approved components to deploy" });
    }

    const deployment = storage.createDeployment({
      requirementId: reqId,
      orgId,
      status: "in_progress",
      componentsJson: JSON.stringify(approvedComponents.map((c) => c.id)),
      logJson: JSON.stringify([
        { timestamp: new Date().toISOString(), message: "Deployment initiated", level: "info" },
      ]),
      startedAt: new Date().toISOString(),
    });

    storage.updateRequirement(reqId, { status: "deploying" });

    const logs: any[] = JSON.parse(deployment.logJson);

    for (const comp of approvedComponents) {
      logs.push({
        timestamp: new Date().toISOString(),
        message: `Deploying ${comp.componentType}: ${comp.label} (${comp.apiName})`,
        level: "info",
      });

      storage.updateComponent(comp.id, { status: "deployed" });
      logs.push({
        timestamp: new Date().toISOString(),
        message: `✓ ${comp.label} deployed successfully`,
        level: "success",
      });
    }

    logs.push({ timestamp: new Date().toISOString(), message: "Deployment complete", level: "info" });

    const updatedDeployment = storage.updateDeployment(deployment.id, {
      status: "success",
      logJson: JSON.stringify(logs),
      completedAt: new Date().toISOString(),
    });

    storage.updateRequirement(reqId, { status: "deployed" });
    res.json(updatedDeployment);
  });

  app.get("/api/deployments", (_req, res) => {
    const deps = storage.getDeployments();
    res.json(deps);
  });

  app.get("/api/requirements/:id/deployments", (req, res) => {
    const deps = storage.getDeploymentsByRequirement(parseInt(req.params.id));
    res.json(deps);
  });

  // ====== ARCHITECTURAL REVIEW (standalone) ======
  app.post("/api/requirements/:id/architect-review", async (req, res) => {
    const reqId = parseInt(req.params.id);
    const requirement = storage.getRequirement(reqId);
    if (!requirement) return res.status(404).json({ error: "Requirement not found" });

    try {
      const review = await runArchitectReview(requirement);
      res.json(review);
    } catch (error: any) {
      res.status(422).json({ error: "Architectural review failed", details: error.message });
    }
  });

  // ====== AGENT RUNS (agentic pattern) ======
  app.get("/api/agent-runs", (_req, res) => {
    const runs = storage.getAgentRuns();
    res.json(runs);
  });

  app.get("/api/agent-runs/:id", (req, res) => {
    const run = storage.getAgentRun(parseInt(req.params.id));
    if (!run) return res.status(404).json({ error: "Agent run not found" });
    res.json(run);
  });

  app.get("/api/requirements/:id/agent-runs", (req, res) => {
    const runs = storage.getAgentRunsByRequirement(parseInt(req.params.id));
    res.json(runs);
  });

  // Start an agent run — kicks off the full agentic loop
  app.post("/api/agent-runs", (req, res) => {
    const { requirementId, orgId } = req.body;

    const requirement = storage.getRequirement(requirementId);
    if (!requirement) return res.status(404).json({ error: "Requirement not found" });

    const run = storage.createAgentRun({
      requirementId,
      orgId: orgId || null,
      status: "pending",
      phase: "init",
      stepsJson: "[]",
      retryCount: 0,
      maxRetries: 3,
      startedAt: new Date().toISOString(),
    });

    // Start the agent execution in the background
    const emitters = new Set<(step: AgentStep) => void>();
    sseClients.set(run.id, emitters);

    executeAgentRun(run.id, requirementId, orgId || null, (step) => {
      const clients = sseClients.get(run.id);
      if (clients) {
        for (const emit of clients) {
          try { emit(step); } catch {}
        }
      }
    }).finally(() => {
      // Clean up SSE after a delay
      setTimeout(() => sseClients.delete(run.id), 30000);
    });

    res.status(201).json(run);
  });

  // SSE stream for agent run progress
  app.get("/api/agent-runs/:id/stream", (req, res) => {
    const runId = parseInt(req.params.id);
    const run = storage.getAgentRun(runId);
    if (!run) return res.status(404).json({ error: "Agent run not found" });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Send existing steps as initial state
    const existingSteps: AgentStep[] = JSON.parse(run.stepsJson);
    for (const step of existingSteps) {
      res.write(`data: ${JSON.stringify(step)}\n\n`);
    }

    // If already complete, close
    if (run.status === "success" || run.status === "failed" || run.status === "cancelled") {
      res.write(`data: ${JSON.stringify({ type: "done", status: run.status })}\n\n`);
      res.end();
      return;
    }

    // Register for live updates
    const emit = (step: AgentStep) => {
      try {
        res.write(`data: ${JSON.stringify(step)}\n\n`);
      } catch {}
    };

    let clients = sseClients.get(runId);
    if (!clients) {
      clients = new Set();
      sseClients.set(runId, clients);
    }
    clients.add(emit);

    // Keep-alive
    const keepAlive = setInterval(() => {
      try { res.write(": keepalive\n\n"); } catch {}
    }, 15000);

    req.on("close", () => {
      clearInterval(keepAlive);
      clients?.delete(emit);
    });
  });

  // ====== DASHBOARD STATS ======
  app.get("/api/stats", (_req, res) => {
    const reqs = storage.getRequirements();
    const orgs = storage.getOrgs();
    const deps = storage.getDeployments();
    const runs = storage.getAgentRuns();

    res.json({
      totalRequirements: reqs.length,
      byStatus: {
        draft: reqs.filter((r) => r.status === "draft").length,
        analyzing: reqs.filter((r) => r.status === "analyzing").length,
        analyzed: reqs.filter((r) => r.status === "analyzed").length,
        generating: reqs.filter((r) => r.status === "generating").length,
        ready: reqs.filter((r) => r.status === "ready").length,
        deploying: reqs.filter((r) => r.status === "deploying").length,
        deployed: reqs.filter((r) => r.status === "deployed").length,
        failed: reqs.filter((r) => r.status === "failed").length,
      },
      connectedOrgs: orgs.filter((o) => o.status === "connected").length,
      totalCustomers: storage.getCustomers().length,
      totalOrgs: orgs.length,
      totalDeployments: deps.length,
      successfulDeployments: deps.filter((d) => d.status === "success").length,
      totalAgentRuns: runs.length,
      activeAgentRuns: runs.filter((r) => r.status === "running").length,
      successfulAgentRuns: runs.filter((r) => r.status === "success").length,
    });
  });
}
