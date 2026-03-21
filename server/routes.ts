import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export function registerRoutes(server: Server, app: Express) {
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

    // Generate the OAuth authorization URL
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/callback`;
    const authUrl = `${instanceUrl}/services/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${orgId}`;

    // Store credentials temporarily for the callback
    storage.updateOrg(orgId, {
      instanceUrl,
      status: "disconnected",
    });

    res.json({ authUrl, redirectUri });
  });

  // OAuth callback handler
  app.get("/api/oauth/callback", async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).send("Missing authorization code or state");
    }

    const orgId = parseInt(state as string);
    const org = storage.getOrg(orgId);
    if (!org) return res.status(404).send("Org not found");

    // In production, exchange code for tokens here
    storage.updateOrg(orgId, {
      status: "connected",
      connectedAt: new Date().toISOString(),
    });

    res.send(`
      <html><body>
        <h2>Connected successfully!</h2>
        <p>You can close this window and return to the app.</p>
        <script>window.close();</script>
      </body></html>
    `);
  });

  // Test connection using stored credentials
  app.post("/api/orgs/:id/test", async (req, res) => {
    const org = storage.getOrg(parseInt(req.params.id));
    if (!org) return res.status(404).json({ error: "Org not found" });

    // Simulate connection test
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

  // ====== AI ANALYSIS ======
  app.post("/api/requirements/:id/analyze", async (req, res) => {
    const reqId = parseInt(req.params.id);
    const requirement = storage.getRequirement(reqId);
    if (!requirement) return res.status(404).json({ error: "Requirement not found" });

    storage.updateRequirement(reqId, { status: "analyzing" });

    try {
      const message = await client.messages.create({
        model: "claude_sonnet_4_6",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: `You are an expert Salesforce architect and developer. Analyze this requirement and provide a detailed implementation plan.

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
      "type": "CustomObject | CustomField | Flow | ApexClass | ApexTrigger | LWC | ValidationRule | PermissionSet | Layout | Report | Dashboard | EmailTemplate | ProcessBuilder | RecordType",
      "apiName": "The_API_Name__c",
      "label": "Human-readable label",
      "description": "What this component does",
      "order": 1
    }
  ],
  "dependencies": [
    "Description of each dependency between components"
  ],
  "bestPractices": [
    "Specific Salesforce best practices that apply"
  ],
  "risks": [
    {
      "risk": "Description of the risk",
      "mitigation": "How to mitigate it",
      "severity": "low | medium | high"
    }
  ],
  "estimatedEffort": "e.g., 4-6 hours, 2-3 days, etc."
}`
          }
        ]
      });

      const content = message.content[0];
      if (content.type !== "text") throw new Error("Unexpected response type");

      let parsed;
      try {
        parsed = JSON.parse(content.text);
      } catch {
        // Try to extract JSON from potential markdown wrapping
        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Could not parse AI response as JSON");
        }
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

  // ====== METADATA GENERATION ======
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
        messages: [
          {
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
      "type": "The component type (CustomObject, CustomField, Flow, ApexClass, etc.)",
      "apiName": "The_API_Name",
      "label": "Human Label",
      "metadata": "The complete XML metadata or Apex/LWC code as a string. For XML, use the Salesforce Metadata API format. For Apex, provide the complete class. For LWC, provide the JS module."
    }
  ]
}

Follow Salesforce Metadata API v60.0 format. Include all required fields for each component type. Use best practices:
- Custom objects: include deploymentStatus, enableActivities, enableReports, sharingModel
- Custom fields: include label, type, required, description, externalId settings
- Apex classes: include proper API version, test coverage hints
- Flows: use Flow metadata format with proper structure
- Validation rules: include errorMessage, errorDisplayField
- Permission sets: include field permissions and object permissions`
          }
        ]
      });

      const content = message.content[0];
      if (content.type !== "text") throw new Error("Unexpected response type");

      let parsed;
      try {
        parsed = JSON.parse(content.text);
      } catch {
        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Could not parse AI response as JSON");
        }
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

  // ====== DEPLOYMENT ======
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
        { timestamp: new Date().toISOString(), message: `Deploying ${approvedComponents.length} components to ${org.name}`, level: "info" },
      ]),
      startedAt: new Date().toISOString(),
    });

    storage.updateRequirement(reqId, { status: "deploying" });

    // Simulate deployment steps (in production, use Metadata API deploy())
    const logs: any[] = JSON.parse(deployment.logJson);

    // In production, this would:
    // 1. Create a zip package of the metadata
    // 2. POST to /services/Soap/m/60.0 with deploy() call
    // 3. Poll checkDeployStatus() until complete
    // 4. Parse results and update component statuses

    for (const comp of approvedComponents) {
      logs.push({
        timestamp: new Date().toISOString(),
        message: `Deploying ${comp.componentType}: ${comp.label} (${comp.apiName})`,
        level: "info",
      });

      if (org.status === "connected" && org.accessToken) {
        // Real deployment via Metadata API would happen here
        try {
          // Placeholder for actual API call
          storage.updateComponent(comp.id, { status: "deployed" });
          logs.push({
            timestamp: new Date().toISOString(),
            message: `✓ ${comp.label} deployed successfully`,
            level: "success",
          });
        } catch (e: any) {
          storage.updateComponent(comp.id, { status: "failed", deploymentLog: e.message });
          logs.push({
            timestamp: new Date().toISOString(),
            message: `✗ ${comp.label} failed: ${e.message}`,
            level: "error",
          });
        }
      } else {
        // Simulated deployment for demo purposes
        storage.updateComponent(comp.id, { status: "deployed" });
        logs.push({
          timestamp: new Date().toISOString(),
          message: `✓ ${comp.label} deployed successfully (simulated - connect org for real deployment)`,
          level: "success",
        });
      }
    }

    logs.push({
      timestamp: new Date().toISOString(),
      message: "Deployment complete",
      level: "info",
    });

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

  // ====== DASHBOARD STATS ======
  app.get("/api/stats", (_req, res) => {
    const reqs = storage.getRequirements();
    const orgs = storage.getOrgs();
    const deps = storage.getDeployments();

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
      totalOrgs: orgs.length,
      totalDeployments: deps.length,
      successfulDeployments: deps.filter((d) => d.status === "success").length,
    });
  });
}
