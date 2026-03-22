import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { executeAgentRun, executeValidationRun, runArchitectReview } from "./agent-engine";
import { executeOrgDiscovery } from "./discovery-engine";
import { executeHealthAssessment } from "./health-engine";
import { generateChangeProposal, rollbackChange } from "./change-engine";
import { generateSalt, hashPassword, verifyPassword, createUserSession, requireAuth } from "./auth";
import { deployToOrg, undeployFromOrg } from "./metadata-deployer";
import { enqueueDeployment, processQueue, getQueueStatus } from "./deploy-queue";
import { getApiUsage } from "./rate-limiter";
import { startScheduler } from "./scheduler";
import { compareOrgs } from "./org-comparator";
import { COMPLIANCE_TEMPLATES } from "./compliance-templates";
import { createBulkJob, uploadBulkData, closeBulkJob, pollBulkJobStatus, getBulkJobResults, executeBulkQuery } from "./bulk-api";
import { fireWebhook, sendTestWebhook } from "./webhook-service";
import Anthropic from "@anthropic-ai/sdk";
import type { AgentStep } from "@shared/schema";

// Lazy-initialize so ANTHROPIC_API_KEY is read at call time
let _routeClient: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_routeClient) {
    _routeClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _routeClient;
}

// SSE connections registry for agent run streaming
const sseClients = new Map<number, Set<(step: AgentStep) => void>>();

export function registerRoutes(server: Server, app: Express) {
  // ====== HEALTH CHECK (for Railway / cloud platforms) ======
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", app: "GS_ImproveSFAgent", version: "1.0.0", timestamp: new Date().toISOString() });
  });

  // ====== AUTH ROUTES (public — no auth required) ======

  // Check if any users exist (first-time setup detection)
  app.get("/api/auth/setup-required", (_req, res) => {
    const count = storage.getUserCount();
    res.json({ setupRequired: count === 0 });
  });

  // Sign up
  app.post("/api/auth/signup", (req, res) => {
    const { email, password, displayName } = req.body;
    if (!email || !password || !displayName) {
      return res.status(400).json({ error: "Email, password, and display name are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const existing = storage.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "A user with this email already exists" });
    }

    // First user becomes admin
    const isFirstUser = storage.getUserCount() === 0;
    const salt = generateSalt();
    const passwordHash = hashPassword(password, salt);

    const user = storage.createUser({
      email,
      passwordHash,
      salt,
      displayName,
      role: isFirstUser ? "admin" : "user",
      createdAt: new Date().toISOString(),
    });

    const session = createUserSession(user.id);

    res.status(201).json({
      user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
      token: session.token,
      expiresAt: session.expiresAt,
    });
  });

  // Log in
  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = storage.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (!verifyPassword(password, user.salt, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const session = createUserSession(user.id);

    res.json({
      user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
      token: session.token,
      expiresAt: session.expiresAt,
    });
  });

  // Log out
  app.post("/api/auth/logout", (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      storage.deleteSession(authHeader.slice(7));
    }
    res.json({ success: true });
  });

  // Get current user
  app.get("/api/auth/me", (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const token = authHeader.slice(7);
    const session = storage.getSessionByToken(token);
    if (!session || new Date(session.expiresAt) < new Date()) {
      if (session) storage.deleteSession(token);
      return res.status(401).json({ error: "Session expired" });
    }

    const user = storage.getUser(session.userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    res.json({
      user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
    });
  });

  // ====== OAuth callback MUST stay public (no auth) ======
  // (moved above requireAuth middleware)

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

  // ====== REQUIRE AUTH for all remaining /api routes ======
  app.use("/api", requireAuth);

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

  // ====== ORG DISCOVERY ROUTES ======

  // SSE connections for discovery scans
  const scanSseClients = new Map<number, Set<(progress: any) => void>>();

  // Start a discovery scan
  app.post("/api/orgs/:id/discover", (req, res) => {
    const orgId = parseInt(req.params.id);
    const org = storage.getOrg(orgId);
    if (!org) return res.status(404).json({ error: "Org not found" });
    if (!org.accessToken) return res.status(400).json({ error: "Org not connected" });

    const scan = storage.createOrgScan({
      orgId,
      status: "pending",
      totalComponents: 0,
      describedComponents: 0,
      cloudsDetectedJson: "[]",
      packagesJson: "[]",
      startedAt: new Date().toISOString(),
    });

    // Start discovery in background
    const emitters = new Set<(progress: any) => void>();
    scanSseClients.set(scan.id, emitters);

    executeOrgDiscovery(scan.id, orgId, (progress) => {
      const clients = scanSseClients.get(scan.id);
      if (clients) {
        for (const emit of clients) {
          try { emit(progress); } catch {}
        }
      }
    }).finally(() => {
      setTimeout(() => scanSseClients.delete(scan.id), 30000);
    });

    res.status(201).json(scan);
  });

  // List scans for an org
  app.get("/api/orgs/:id/scans", (req, res) => {
    const scans = storage.getOrgScans(parseInt(req.params.id));
    res.json(scans);
  });

  // Get scan status
  app.get("/api/scans/:id", (req, res) => {
    const scan = storage.getOrgScan(parseInt(req.params.id));
    if (!scan) return res.status(404).json({ error: "Scan not found" });
    res.json(scan);
  });

  // SSE stream for scan progress
  app.get("/api/scans/:id/stream", (req, res) => {
    const scanId = parseInt(req.params.id);
    const scan = storage.getOrgScan(scanId);
    if (!scan) return res.status(404).json({ error: "Scan not found" });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    if (scan.status === "completed" || scan.status === "failed") {
      res.write(`data: ${JSON.stringify({ phase: "done", message: scan.status, totalComponents: scan.totalComponents, describedComponents: scan.describedComponents })}\n\n`);
      res.end();
      return;
    }

    const emit = (progress: any) => {
      try { res.write(`data: ${JSON.stringify(progress)}\n\n`); } catch {}
    };

    let clients = scanSseClients.get(scanId);
    if (!clients) {
      clients = new Set();
      scanSseClients.set(scanId, clients);
    }
    clients.add(emit);

    const keepAlive = setInterval(() => {
      try { res.write(": keepalive\n\n"); } catch {}
    }, 15000);

    req.on("close", () => {
      clearInterval(keepAlive);
      clients?.delete(emit);
    });
  });

  // Get inventory for an org (with optional filters)
  app.get("/api/orgs/:id/inventory", (req, res) => {
    const orgId = parseInt(req.params.id);
    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;

    let items;
    if (search) {
      items = storage.searchOrgInventory(orgId, search);
    } else if (category) {
      items = storage.getOrgInventoryByCategory(orgId, category);
    } else {
      items = storage.getOrgInventory(orgId);
    }
    res.json(items);
  });

  // Get inventory summary (category counts)
  app.get("/api/orgs/:id/inventory/summary", (req, res) => {
    const orgId = parseInt(req.params.id);
    const items = storage.getOrgInventory(orgId);
    const summary: Record<string, number> = {};
    for (const item of items) {
      summary[item.category] = (summary[item.category] || 0) + 1;
    }
    res.json(summary);
  });

  // Get single inventory item
  app.get("/api/inventory/:id", (req, res) => {
    const item = storage.getOrgInventoryItem(parseInt(req.params.id));
    if (!item) return res.status(404).json({ error: "Inventory item not found" });
    res.json(item);
  });

  // Generate AI description for a single item
  app.post("/api/inventory/:id/describe", async (req, res) => {
    const item = storage.getOrgInventoryItem(parseInt(req.params.id));
    if (!item) return res.status(404).json({ error: "Inventory item not found" });

    try {
      let prompt = `You are a Salesforce Technical Architect. Describe this component in 1-2 sentences. Be specific about business logic.\n\n[${item.category}] ${item.apiName} (Label: ${item.label})`;
      if (item.sourceCode) prompt += `\nCode:\n${item.sourceCode.substring(0, 3000)}`;
      if (item.metadataJson) prompt += `\nMetadata: ${item.metadataJson.substring(0, 1000)}`;

      const message = await getClient().messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 512,
        messages: [{ role: "user", content: prompt + "\n\nRespond with just the description text, no JSON wrapper." }],
      });

      const content = message.content[0];
      if (content.type === "text") {
        const updated = storage.updateOrgInventoryItem(item.id, { description: content.text.trim(), status: "described" });
        res.json(updated);
      } else {
        res.status(422).json({ error: "Unexpected response" });
      }
    } catch (error: any) {
      res.status(422).json({ error: "AI description failed", details: error.message });
    }
  });

  // ====== HEALTH ASSESSMENT ROUTES ======

  // SSE connections for health assessments
  const healthSseClients = new Map<number, Set<(progress: any) => void>>();

  // Start health assessment
  app.post("/api/orgs/:id/assess", (req, res) => {
    const orgId = parseInt(req.params.id);
    const org = storage.getOrg(orgId);
    if (!org) return res.status(404).json({ error: "Org not found" });

    // Need inventory to assess
    const inventory = storage.getOrgInventory(orgId);
    if (inventory.length === 0) {
      return res.status(400).json({ error: "No inventory found — run a discovery scan first" });
    }

    const assessment = storage.createHealthAssessment({
      orgId,
      overallGrade: "N/A",
      overallScore: 0,
      securityScore: 0,
      performanceScore: 0,
      maintainabilityScore: 0,
      scalabilityScore: 0,
      totalFindings: 0,
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
      complexityScore: "Low",
      status: "pending",
      startedAt: new Date().toISOString(),
    });

    // Start assessment in background
    const emitters = new Set<(progress: any) => void>();
    healthSseClients.set(assessment.id, emitters);

    executeHealthAssessment(assessment.id, orgId, (progress) => {
      const clients = healthSseClients.get(assessment.id);
      if (clients) {
        for (const emit of clients) {
          try { emit(progress); } catch {}
        }
      }
    }).finally(() => {
      setTimeout(() => healthSseClients.delete(assessment.id), 30000);
    });

    res.status(201).json(assessment);
  });

  // SSE stream for health assessment progress
  app.get("/api/assessments/:id/stream", (req, res) => {
    const assessmentId = parseInt(req.params.id);
    const assessment = storage.getHealthAssessment(assessmentId);
    if (!assessment) return res.status(404).json({ error: "Assessment not found" });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    if (assessment.status === "completed" || assessment.status === "failed") {
      res.write(`data: ${JSON.stringify({ phase: "done", status: assessment.status })}\n\n`);
      res.end();
      return;
    }

    const emit = (progress: any) => {
      try { res.write(`data: ${JSON.stringify(progress)}\n\n`); } catch {}
    };

    let clients = healthSseClients.get(assessmentId);
    if (!clients) {
      clients = new Set();
      healthSseClients.set(assessmentId, clients);
    }
    clients.add(emit);

    const keepAlive = setInterval(() => {
      try { res.write(": keepalive\n\n"); } catch {}
    }, 15000);

    req.on("close", () => {
      clearInterval(keepAlive);
      clients?.delete(emit);
    });
  });

  // List assessments for an org
  app.get("/api/orgs/:id/assessments", (req, res) => {
    const assessments = storage.getHealthAssessments(parseInt(req.params.id));
    res.json(assessments);
  });

  // Get assessment detail
  app.get("/api/assessments/:id", (req, res) => {
    const assessment = storage.getHealthAssessment(parseInt(req.params.id));
    if (!assessment) return res.status(404).json({ error: "Assessment not found" });
    res.json(assessment);
  });

  // Get findings for an assessment
  app.get("/api/assessments/:id/findings", (req, res) => {
    const assessmentId = parseInt(req.params.id);
    const category = req.query.category as string | undefined;

    let findings;
    if (category) {
      findings = storage.getHealthFindingsByCategory(assessmentId, category);
    } else {
      findings = storage.getHealthFindings(assessmentId);
    }
    res.json(findings);
  });

  // ====== CHANGE REQUEST ROUTES ======

  // List change requests for an org
  app.get("/api/orgs/:id/changes", (req, res) => {
    res.json(storage.getChangeRequests(parseInt(req.params.id)));
  });

  // List all change requests
  app.get("/api/changes", (_req, res) => {
    res.json(storage.getAllChangeRequests());
  });

  // Get single change request
  app.get("/api/changes/:id", (req, res) => {
    const cr = storage.getChangeRequest(parseInt(req.params.id));
    if (!cr) return res.status(404).json({ error: "Change request not found" });
    res.json(cr);
  });

  // Create change request
  app.post("/api/changes", (req, res) => {
    const cr = storage.createChangeRequest({
      ...req.body,
      status: "draft",
      deployedToSandbox: 0,
      deployedToProduction: 0,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json(cr);
  });

  // Generate AI proposal for a change request
  app.post("/api/changes/:id/propose", async (req, res) => {
    const id = parseInt(req.params.id);
    try {
      await generateChangeProposal(id);
      const updated = storage.getChangeRequest(id);
      res.json(updated);
    } catch (error: any) {
      res.status(422).json({ error: "Proposal generation failed", details: error.message });
    }
  });

  // Approve a change request
  app.post("/api/changes/:id/approve", (req, res) => {
    const cr = storage.updateChangeRequest(parseInt(req.params.id), {
      status: "approved",
      updatedAt: new Date().toISOString(),
    });
    if (!cr) return res.status(404).json({ error: "Change request not found" });
    res.json(cr);
  });

  // Reject a change request
  app.post("/api/changes/:id/reject", (req, res) => {
    const cr = storage.updateChangeRequest(parseInt(req.params.id), {
      status: "rejected",
      updatedAt: new Date().toISOString(),
    });
    if (!cr) return res.status(404).json({ error: "Change request not found" });
    res.json(cr);
  });

  // Deploy to sandbox
  app.post("/api/changes/:id/deploy-sandbox", (req, res) => {
    const cr = storage.updateChangeRequest(parseInt(req.params.id), {
      status: "deploying",
      deployedToSandbox: 1,
      updatedAt: new Date().toISOString(),
    });
    if (!cr) return res.status(404).json({ error: "Change request not found" });
    // In real implementation, this would use Metadata API to deploy
    setTimeout(() => {
      storage.updateChangeRequest(cr.id, {
        status: "deployed",
        updatedAt: new Date().toISOString(),
      });
    }, 2000);
    res.json(cr);
  });

  // Promote to production
  app.post("/api/changes/:id/promote", (req, res) => {
    const cr = storage.getChangeRequest(parseInt(req.params.id));
    if (!cr) return res.status(404).json({ error: "Change request not found" });
    if (!cr.deployedToSandbox) {
      return res.status(400).json({ error: "Must deploy to sandbox first" });
    }
    const updated = storage.updateChangeRequest(cr.id, {
      deployedToProduction: 1,
      updatedAt: new Date().toISOString(),
    });
    res.json(updated);
  });

  // Rollback
  app.post("/api/changes/:id/rollback", async (req, res) => {
    try {
      await rollbackChange(parseInt(req.params.id));
      const cr = storage.getChangeRequest(parseInt(req.params.id));
      res.json(cr);
    } catch (error: any) {
      res.status(422).json({ error: error.message });
    }
  });

  // Update change request
  app.patch("/api/changes/:id", (req, res) => {
    const cr = storage.updateChangeRequest(parseInt(req.params.id), {
      ...req.body,
      updatedAt: new Date().toISOString(),
    });
    if (!cr) return res.status(404).json({ error: "Change request not found" });
    res.json(cr);
  });

  // Delete change request
  app.delete("/api/changes/:id", (req, res) => {
    storage.deleteChangeRequest(parseInt(req.params.id));
    res.json({ success: true });
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
      const message = await getClient().messages.create({
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

      const message = await getClient().messages.create({
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

  // ====== VALIDATE (checkOnly deploy) ======
  app.post("/api/requirements/:id/validate", (req, res) => {
    const reqId = parseInt(req.params.id);
    const { orgId } = req.body;

    const requirement = storage.getRequirement(reqId);
    if (!requirement) return res.status(404).json({ error: "Requirement not found" });

    const run = storage.createAgentRun({
      requirementId: reqId,
      orgId: orgId || null,
      status: "pending",
      phase: "init",
      stepsJson: "[]",
      retryCount: 0,
      maxRetries: 0,
      startedAt: new Date().toISOString(),
    });

    // Register SSE emitters for this run
    const emitters = new Set<(step: any) => void>();
    sseClients.set(run.id, emitters);

    executeValidationRun(run.id, reqId, orgId || null, (step) => {
      const clients = sseClients.get(run.id);
      if (clients) {
        for (const emit of clients) {
          try { emit(step); } catch {}
        }
      }
    }).finally(() => {
      setTimeout(() => sseClients.delete(run.id), 30000);
    });

    res.status(201).json(run);
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

  // ====== DEPLOYMENT ROLLBACK (destructive changes) ======
  app.post("/api/deployments/:id/rollback", async (req, res) => {
    const deployment = storage.getDeployment(parseInt(req.params.id));
    if (!deployment) return res.status(404).json({ error: "Deployment not found" });

    const org = storage.getOrg(deployment.orgId);
    if (!org || !org.accessToken) {
      return res.status(400).json({ error: "Org not connected — cannot perform rollback" });
    }

    const componentIds: number[] = JSON.parse(deployment.componentsJson);
    const components = componentIds
      .map(id => storage.getComponent(id))
      .filter(Boolean) as any[];

    if (components.length === 0) {
      return res.status(400).json({ error: "No components found for this deployment" });
    }

    try {
      const result = await undeployFromOrg(org, components);
      if (result.success) {
        storage.updateDeployment(deployment.id, {
          status: "rolled_back",
          completedAt: new Date().toISOString(),
        });
      }
      res.json(result);
    } catch (error: any) {
      res.status(422).json({ error: "Rollback failed", details: error.message });
    }
  });

  // ====== DEPLOYMENT SNAPSHOTS (diff comparison) ======
  app.get("/api/deployments/:id/snapshots", (req, res) => {
    const snapshots = storage.getDeploymentSnapshots(parseInt(req.params.id));
    res.json(snapshots);
  });

  app.get("/api/deployments/:id/diff", (req, res) => {
    const snapshots = storage.getDeploymentSnapshots(parseInt(req.params.id));
    const diffs = snapshots.map(s => ({
      id: s.id,
      componentApiName: s.componentApiName,
      componentType: s.componentType,
      changeType: s.changeType,
      before: s.beforeMetadata,
      after: s.afterMetadata,
    }));
    res.json(diffs);
  });

  // ====== SANDBOX-TO-SANDBOX PROMOTION ======
  app.post("/api/deployments/:id/promote", async (req, res) => {
    const { targetOrgId } = req.body;
    if (!targetOrgId) return res.status(400).json({ error: "targetOrgId is required" });

    const deployment = storage.getDeployment(parseInt(req.params.id));
    if (!deployment) return res.status(404).json({ error: "Deployment not found" });

    const targetOrg = storage.getOrg(targetOrgId);
    if (!targetOrg || !targetOrg.accessToken) {
      return res.status(400).json({ error: "Target org not connected" });
    }

    const sourceOrg = storage.getOrg(deployment.orgId);

    const componentIds: number[] = JSON.parse(deployment.componentsJson);
    const components = componentIds
      .map(id => storage.getComponent(id))
      .filter(Boolean) as any[];

    if (components.length === 0) {
      return res.status(400).json({ error: "No components found for this deployment" });
    }

    const promotion = storage.createPromotion({
      sourceDeploymentId: deployment.id,
      sourceOrgId: deployment.orgId,
      targetOrgId,
      status: "promoting",
      componentsJson: JSON.stringify(componentIds),
      logJson: JSON.stringify([{ timestamp: new Date().toISOString(), message: `Promoting ${components.length} components from ${sourceOrg?.name || "source"} to ${targetOrg.name}` }]),
      createdAt: new Date().toISOString(),
    });

    try {
      const result = await deployToOrg(targetOrg, components);
      const logs = JSON.parse(promotion.logJson);
      logs.push({ timestamp: new Date().toISOString(), message: result.success ? "Promotion successful" : `Promotion failed: ${result.errors.map(e => e.problem).join(", ")}` });

      storage.updatePromotion(promotion.id, {
        status: result.success ? "success" : "failed",
        logJson: JSON.stringify(logs),
        completedAt: new Date().toISOString(),
      });

      res.json({ promotion: storage.getPromotion(promotion.id), deployResult: result });
    } catch (error: any) {
      storage.updatePromotion(promotion.id, {
        status: "failed",
        logJson: JSON.stringify([{ timestamp: new Date().toISOString(), message: `Error: ${error.message}` }]),
        completedAt: new Date().toISOString(),
      });
      res.status(422).json({ error: "Promotion failed", details: error.message });
    }
  });

  app.get("/api/deployments/:id/promotions", (req, res) => {
    res.json(storage.getPromotionsByDeployment(parseInt(req.params.id)));
  });

  // ====== DEPLOYMENT QUEUE ======
  app.get("/api/orgs/:id/deploy-queue", (req, res) => {
    res.json(getQueueStatus(parseInt(req.params.id)));
  });

  app.post("/api/orgs/:id/deploy-queue", (req, res) => {
    const orgId = parseInt(req.params.id);
    const { requirementId, componentIds, checkOnly, priority } = req.body;
    if (!componentIds || !Array.isArray(componentIds) || componentIds.length === 0) {
      return res.status(400).json({ error: "componentIds array is required" });
    }

    const item = enqueueDeployment(orgId, requirementId || null, componentIds, { checkOnly, priority });
    res.status(201).json(item);
  });

  app.delete("/api/deploy-queue/:id", (req, res) => {
    const item = storage.getDeployQueueItem(parseInt(req.params.id));
    if (!item) return res.status(404).json({ error: "Queue item not found" });
    if (item.status === "running") {
      return res.status(400).json({ error: "Cannot cancel a running deployment" });
    }
    storage.deleteDeployQueueItem(item.id);
    res.json({ success: true });
  });

  // ====== API RATE LIMIT USAGE ======
  app.get("/api/orgs/:id/api-usage", (req, res) => {
    const usage = getApiUsage(parseInt(req.params.id));
    res.json(usage);
  });

  // ====== NICE P1: SCHEDULED DEPLOYS ======
  startScheduler();

  app.post("/api/scheduled-deploys", (req, res) => {
    const { requirementId, orgId, scheduledFor } = req.body;
    if (!requirementId || !orgId || !scheduledFor) {
      return res.status(400).json({ error: "requirementId, orgId, and scheduledFor are required" });
    }
    const sd = storage.createScheduledDeploy({
      requirementId,
      orgId,
      scheduledFor,
      status: "scheduled",
      createdBy: (req as any).user?.id || null,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json(sd);
  });

  app.get("/api/scheduled-deploys", (_req, res) => {
    res.json(storage.getAllScheduledDeploys());
  });

  app.get("/api/orgs/:id/scheduled-deploys", (req, res) => {
    res.json(storage.getScheduledDeploys(parseInt(req.params.id)));
  });

  app.delete("/api/scheduled-deploys/:id", (req, res) => {
    const sd = storage.getScheduledDeploy(parseInt(req.params.id));
    if (!sd) return res.status(404).json({ error: "Scheduled deploy not found" });
    if (sd.status === "deploying") {
      return res.status(400).json({ error: "Cannot cancel a deploy that is currently running" });
    }
    storage.updateScheduledDeploy(sd.id, { status: "cancelled" } as any);
    res.json({ success: true });
  });

  // ====== NICE P2: MULTI-ORG COMPARISON ======
  app.post("/api/orgs/compare", (req, res) => {
    const { sourceOrgId, targetOrgId } = req.body;
    if (!sourceOrgId || !targetOrgId) {
      return res.status(400).json({ error: "sourceOrgId and targetOrgId are required" });
    }
    if (sourceOrgId === targetOrgId) {
      return res.status(400).json({ error: "Cannot compare an org to itself" });
    }
    const result = compareOrgs(sourceOrgId, targetOrgId);
    res.json(result);
  });

  // ====== NICE P3: COMPLIANCE TEMPLATES ======
  app.get("/api/templates", (_req, res) => {
    res.json(COMPLIANCE_TEMPLATES);
  });

  app.get("/api/templates/:id", (req, res) => {
    const template = COMPLIANCE_TEMPLATES.find(t => t.id === req.params.id);
    if (!template) return res.status(404).json({ error: "Template not found" });
    res.json(template);
  });

  app.post("/api/templates/:id/apply", (req, res) => {
    const template = COMPLIANCE_TEMPLATES.find(t => t.id === req.params.id);
    if (!template) return res.status(404).json({ error: "Template not found" });

    const { orgId } = req.body;
    const requirement = storage.createRequirement({
      title: template.name,
      description: template.requirementText,
      category: template.category,
      priority: template.complexity === "complex" ? "high" : template.complexity === "moderate" ? "medium" : "low",
      status: "draft",
      orgId: orgId || null,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ requirement, template });
  });

  // ====== NICE P4: BULK API OPERATIONS ======
  app.post("/api/orgs/:id/bulk-jobs", async (req, res) => {
    const orgId = parseInt(req.params.id);
    const org = storage.getOrg(orgId);
    if (!org) return res.status(404).json({ error: "Org not found" });
    if (!org.accessToken) return res.status(400).json({ error: "Org not connected" });

    const { object, operation, externalIdField, csvData, query } = req.body;
    if (!object && operation !== "query") {
      return res.status(400).json({ error: "object is required for non-query operations" });
    }
    if (!operation) {
      return res.status(400).json({ error: "operation is required" });
    }

    try {
      const sfJobId = await createBulkJob(org, { object, operation, externalIdField, query });

      // For non-query jobs, upload CSV data then close
      if (operation !== "query" && csvData) {
        await uploadBulkData(org, sfJobId, csvData);
        await closeBulkJob(org, sfJobId);
      }

      const job = storage.createBulkJob({
        orgId,
        sfJobId,
        object: object || "",
        operation,
        status: "processing",
        recordsProcessed: 0,
        recordsFailed: 0,
        createdAt: new Date().toISOString(),
      });

      // Poll in background
      pollBulkJobStatus(org, sfJobId, operation === "query").then(async (result) => {
        const updates: any = {
          status: result.state === "JobComplete" ? "completed" : "failed",
          recordsProcessed: result.numberRecordsProcessed,
          recordsFailed: result.numberRecordsFailed,
          completedAt: new Date().toISOString(),
        };

        if (result.state === "JobComplete") {
          const { successfulResults, failedResults } = await getBulkJobResults(org, sfJobId, operation === "query");
          updates.resultsCsv = successfulResults;
          updates.errorsCsv = failedResults;
        }

        storage.updateBulkJob(job.id, updates);
      }).catch(() => {
        storage.updateBulkJob(job.id, { status: "failed", completedAt: new Date().toISOString() });
      });

      res.status(201).json(job);
    } catch (error: any) {
      res.status(422).json({ error: "Bulk job creation failed", details: error.message });
    }
  });

  app.get("/api/orgs/:id/bulk-jobs", (req, res) => {
    res.json(storage.getBulkJobs(parseInt(req.params.id)));
  });

  app.get("/api/bulk-jobs/:id", (req, res) => {
    const job = storage.getBulkJob(parseInt(req.params.id));
    if (!job) return res.status(404).json({ error: "Bulk job not found" });
    res.json(job);
  });

  app.get("/api/bulk-jobs/:id/results", (req, res) => {
    const job = storage.getBulkJob(parseInt(req.params.id));
    if (!job) return res.status(404).json({ error: "Bulk job not found" });
    res.json({
      resultsCsv: job.resultsCsv || "",
      errorsCsv: job.errorsCsv || "",
      recordsProcessed: job.recordsProcessed,
      recordsFailed: job.recordsFailed,
    });
  });

  // ====== NICE P5: WEBHOOK NOTIFICATIONS ======
  app.get("/api/webhooks", (_req, res) => {
    res.json(storage.getWebhooks());
  });

  app.post("/api/webhooks", (req, res) => {
    const { name, url, type, events } = req.body;
    if (!name || !url) {
      return res.status(400).json({ error: "name and url are required" });
    }
    const webhook = storage.createWebhook({
      name,
      url,
      type: type || "generic",
      events: JSON.stringify(events || []),
      active: 1,
      createdBy: (req as any).user?.id || null,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json(webhook);
  });

  app.patch("/api/webhooks/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const existing = storage.getWebhook(id);
    if (!existing) return res.status(404).json({ error: "Webhook not found" });

    const updates: any = { ...req.body };
    if (updates.events && Array.isArray(updates.events)) {
      updates.events = JSON.stringify(updates.events);
    }
    const updated = storage.updateWebhook(id, updates);
    res.json(updated);
  });

  app.delete("/api/webhooks/:id", (req, res) => {
    const existing = storage.getWebhook(parseInt(req.params.id));
    if (!existing) return res.status(404).json({ error: "Webhook not found" });
    storage.deleteWebhook(parseInt(req.params.id));
    res.json({ success: true });
  });

  app.post("/api/webhooks/:id/test", async (req, res) => {
    const success = await sendTestWebhook(parseInt(req.params.id));
    res.json({ success });
  });

  // ====== DASHBOARD STATS ======
  app.get("/api/stats", (_req, res) => {
    const reqs = storage.getRequirements();
    const orgs = storage.getOrgs();
    const deps = storage.getDeployments();
    const runs = storage.getAgentRuns();
    const allInventory = orgs.reduce((sum, o) => sum + storage.getOrgInventory(o.id).length, 0);
    const allAssessments = orgs.reduce((sum, o) => sum + storage.getHealthAssessments(o.id).length, 0);

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
      totalInventoryItems: allInventory,
      totalAssessments: allAssessments,
      totalChangeRequests: storage.getAllChangeRequests().length,
    });
  });
}
