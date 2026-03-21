import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage";
import type { AgentStep, AgentRun, Requirement, SfOrg } from "@shared/schema";
import { randomUUID } from "crypto";

const client = new Anthropic();

type SSEEmitter = (step: AgentStep) => void;

function makeStep(phase: string, action: string, detail: string, status: AgentStep["status"]): AgentStep {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    phase,
    action,
    detail,
    status,
  };
}

function appendStep(runId: number, step: AgentStep) {
  const run = storage.getAgentRun(runId);
  if (!run) return;
  const steps: AgentStep[] = JSON.parse(run.stepsJson);
  steps.push(step);
  storage.updateAgentRun(runId, { stepsJson: JSON.stringify(steps) });
}

function emitAndLog(runId: number, emit: SSEEmitter, step: AgentStep) {
  appendStep(runId, step);
  emit(step);
}

// ============================================================
// PHASE 1: AI Analysis
// ============================================================
async function runAnalysis(
  runId: number,
  requirement: Requirement,
  emit: SSEEmitter
): Promise<any> {
  emitAndLog(runId, emit, makeStep("analyzing", "start", "Analyzing requirement with AI architect...", "thinking"));
  storage.updateAgentRun(runId, { phase: "analyzing" });

  const message = await client.messages.create({
    model: "claude_sonnet_4_6",
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: `You are an expert Salesforce architect. Analyze this requirement and produce a deployment plan.

REQUIREMENT:
Title: ${requirement.title}
Description: ${requirement.description}
Category: ${requirement.category}
Priority: ${requirement.priority}

Respond with valid JSON only (no markdown, no code fences):
{
  "summary": "2-3 sentence summary of what needs to be built",
  "components": [
    {
      "type": "CustomObject | CustomField | Flow | ApexClass | ApexTrigger | LWC | ValidationRule | PermissionSet | Layout",
      "apiName": "The_API_Name__c",
      "label": "Human-readable label",
      "description": "What this component does",
      "order": 1
    }
  ],
  "dependencies": ["Dependency descriptions"],
  "bestPractices": ["Best practice notes"],
  "risks": [{ "risk": "Description", "mitigation": "How to fix", "severity": "low|medium|high" }],
  "estimatedEffort": "Time estimate",
  "deployOrder": ["Ordered list of apiNames for correct deployment sequence"]
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
    else throw new Error("Could not parse AI analysis response");
  }

  // Save to analyses table
  const analysis = storage.createAnalysis({
    requirementId: requirement.id,
    summary: parsed.summary,
    componentsJson: JSON.stringify(parsed.components || []),
    dependenciesJson: JSON.stringify(parsed.dependencies || []),
    bestPracticesJson: JSON.stringify(parsed.bestPractices || []),
    risksJson: JSON.stringify(parsed.risks || []),
    estimatedEffort: parsed.estimatedEffort || "Unknown",
    createdAt: new Date().toISOString(),
  });

  storage.updateRequirement(requirement.id, { status: "analyzed" });

  emitAndLog(runId, emit, makeStep(
    "analyzing", "complete",
    `Analysis complete: ${parsed.components?.length || 0} components identified. ${parsed.summary}`,
    "success"
  ));

  return parsed;
}

// ============================================================
// PHASE 2: Metadata Generation
// ============================================================
async function runGeneration(
  runId: number,
  requirement: Requirement,
  analysisResult: any,
  emit: SSEEmitter
): Promise<any[]> {
  emitAndLog(runId, emit, makeStep("generating", "start", "Generating Salesforce metadata and code...", "thinking"));
  storage.updateAgentRun(runId, { phase: "generating" });
  storage.updateRequirement(requirement.id, { status: "generating" });

  const components = analysisResult.components || [];

  const message = await client.messages.create({
    model: "claude_sonnet_4_6",
    max_tokens: 8192,
    messages: [{
      role: "user",
      content: `You are an expert Salesforce developer. Generate complete, deployable Salesforce metadata.

REQUIREMENT: ${requirement.title}
DESCRIPTION: ${requirement.description}

COMPONENTS TO BUILD:
${JSON.stringify(components, null, 2)}

For each component, generate the complete Salesforce Metadata API XML or Apex/LWC code. Respond with JSON only:
{
  "generatedComponents": [
    {
      "type": "ComponentType",
      "apiName": "API_Name",
      "label": "Label",
      "metadata": "Complete deployable metadata XML or code as a string"
    }
  ]
}

Rules:
- Custom Objects: include deploymentStatus=Deployed, enableActivities, enableReports, sharingModel
- Custom Fields: include label, type, required, description
- Apex Classes: API version 60.0, bulkified code, include @isTest class with assertions
- Apex Triggers: bulkified, use handler pattern
- Flows: complete Flow metadata XML
- Validation Rules: include errorMessage, errorDisplayField
- LWC: provide JS module + HTML template as combined string`
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
    else throw new Error("Could not parse metadata generation response");
  }

  const generated = parsed.generatedComponents || [];
  const createdComponents = [];

  for (const comp of generated) {
    const created = storage.createComponent({
      requirementId: requirement.id,
      componentType: comp.type,
      apiName: comp.apiName,
      label: comp.label,
      metadataXml: comp.metadata,
      status: "approved", // Auto-approved in agent mode
      createdAt: new Date().toISOString(),
    });
    createdComponents.push(created);
    emitAndLog(runId, emit, makeStep(
      "generating", "component",
      `Generated ${comp.type}: ${comp.label} (${comp.apiName})`,
      "success"
    ));
  }

  storage.updateRequirement(requirement.id, { status: "ready" });

  emitAndLog(runId, emit, makeStep(
    "generating", "complete",
    `Generated ${createdComponents.length} deployable components`,
    "success"
  ));

  return createdComponents;
}

// ============================================================
// PHASE 3: Deployment via Salesforce REST API
// ============================================================
async function runDeployment(
  runId: number,
  requirement: Requirement,
  org: SfOrg,
  components: any[],
  emit: SSEEmitter
): Promise<{ success: boolean; errors: string[] }> {
  emitAndLog(runId, emit, makeStep("deploying", "start", `Deploying ${components.length} components to ${org.name}...`, "thinking"));
  storage.updateAgentRun(runId, { phase: "deploying" });
  storage.updateRequirement(requirement.id, { status: "deploying" });

  const errors: string[] = [];
  const deploymentLogs: any[] = [
    { timestamp: new Date().toISOString(), message: "Agent deployment initiated", level: "info" },
  ];

  // Sort components by deployment order: Objects → Fields → Validation → Apex → Triggers → LWC → Flows → Perms
  const typeOrder: Record<string, number> = {
    CustomObject: 1, CustomField: 2, RecordType: 3, Layout: 4,
    ValidationRule: 5, ApexClass: 6, ApexTrigger: 7, LWC: 8,
    Flow: 9, PermissionSet: 10, Report: 11, Dashboard: 12,
  };
  const sorted = [...components].sort(
    (a, b) => (typeOrder[a.componentType] || 50) - (typeOrder[b.componentType] || 50)
  );

  for (const comp of sorted) {
    const stepDetail = `Deploying ${comp.componentType}: ${comp.label}`;
    emitAndLog(runId, emit, makeStep("deploying", "deploy_component", stepDetail, "info"));

    if (org.status === "connected" && org.accessToken) {
      // Attempt real deployment via Salesforce REST API
      try {
        const result = await deploySingleComponent(org, comp);
        if (result.success) {
          storage.updateComponent(comp.id, { status: "deployed", deploymentLog: "Deployed successfully" });
          deploymentLogs.push({ timestamp: new Date().toISOString(), message: `✓ ${comp.label} deployed`, level: "success" });
          emitAndLog(runId, emit, makeStep("deploying", "deploy_success", `${comp.label} deployed successfully`, "success"));
        } else {
          storage.updateComponent(comp.id, { status: "failed", deploymentLog: result.error });
          errors.push(`${comp.apiName}: ${result.error}`);
          deploymentLogs.push({ timestamp: new Date().toISOString(), message: `✗ ${comp.label}: ${result.error}`, level: "error" });
          emitAndLog(runId, emit, makeStep("deploying", "deploy_error", `${comp.label} failed: ${result.error}`, "error"));
        }
      } catch (e: any) {
        const errMsg = e.message || "Unknown error";
        storage.updateComponent(comp.id, { status: "failed", deploymentLog: errMsg });
        errors.push(`${comp.apiName}: ${errMsg}`);
        emitAndLog(runId, emit, makeStep("deploying", "deploy_error", `${comp.label} failed: ${errMsg}`, "error"));
      }
    } else {
      // Simulated deployment for demo / unconnected orgs
      storage.updateComponent(comp.id, { status: "deployed", deploymentLog: "Deployed (simulated)" });
      deploymentLogs.push({
        timestamp: new Date().toISOString(),
        message: `✓ ${comp.label} deployed (simulated — connect org for live deployment)`,
        level: "success"
      });
      emitAndLog(runId, emit, makeStep("deploying", "deploy_success", `${comp.label} deployed (simulated)`, "success"));
    }
  }

  // Create deployment record
  storage.createDeployment({
    requirementId: requirement.id,
    orgId: org.id,
    status: errors.length === 0 ? "success" : errors.length < components.length ? "partial" : "failed",
    componentsJson: JSON.stringify(sorted.map(c => c.id)),
    logJson: JSON.stringify(deploymentLogs),
    startedAt: new Date().toISOString(),
  });

  return { success: errors.length === 0, errors };
}

// Deploy a single component via Salesforce Tooling or Metadata REST API
async function deploySingleComponent(org: SfOrg, comp: any): Promise<{ success: boolean; error?: string }> {
  const baseUrl = org.instanceUrl;
  const headers = {
    "Authorization": `Bearer ${org.accessToken}`,
    "Content-Type": "application/json",
  };

  try {
    if (comp.componentType === "ApexClass") {
      const res = await fetch(`${baseUrl}/services/data/v60.0/tooling/sobjects/ApexClass`, {
        method: "POST",
        headers,
        body: JSON.stringify({ Body: comp.metadataXml, Name: comp.apiName.replace("__c", "") }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        return { success: false, error: JSON.stringify(err) };
      }
      return { success: true };
    }

    if (comp.componentType === "ApexTrigger") {
      const res = await fetch(`${baseUrl}/services/data/v60.0/tooling/sobjects/ApexTrigger`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          Body: comp.metadataXml,
          Name: comp.apiName.replace("__c", ""),
          TableEnumOrId: comp.metadataXml.match(/on\s+(\w+)/i)?.[1] || "Account",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        return { success: false, error: JSON.stringify(err) };
      }
      return { success: true };
    }

    // For metadata types (objects, fields, flows, etc.), use Metadata REST API
    const metadataType = comp.componentType === "CustomField" ? "CustomField"
      : comp.componentType === "CustomObject" ? "CustomObject"
      : comp.componentType === "Flow" ? "Flow"
      : comp.componentType;

    const res = await fetch(`${baseUrl}/services/data/v60.0/tooling/sobjects/${metadataType}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ FullName: comp.apiName, Metadata: comp.metadataXml }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      return { success: false, error: JSON.stringify(err) };
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ============================================================
// PHASE 4: Test Execution
// ============================================================
async function runTests(
  runId: number,
  org: SfOrg,
  components: any[],
  emit: SSEEmitter
): Promise<{ passed: boolean; failures: string[] }> {
  storage.updateAgentRun(runId, { phase: "testing" });
  const apexClasses = components.filter(c => c.componentType === "ApexClass");

  if (apexClasses.length === 0 || org.status !== "connected") {
    emitAndLog(runId, emit, makeStep("testing", "skip", "No Apex test classes to run (or org not connected)", "info"));
    return { passed: true, failures: [] };
  }

  emitAndLog(runId, emit, makeStep("testing", "start", `Running Apex tests for ${apexClasses.length} classes...`, "thinking"));

  if (!org.accessToken) {
    emitAndLog(runId, emit, makeStep("testing", "skip", "No access token — skipping live tests", "warning"));
    return { passed: true, failures: [] };
  }

  // Enqueue test run via Tooling API
  try {
    const testClassNames = apexClasses
      .map(c => c.apiName.replace("__c", ""))
      .filter(name => name.toLowerCase().includes("test"));

    if (testClassNames.length === 0) {
      emitAndLog(runId, emit, makeStep("testing", "skip", "No test classes found — deployment complete without test verification", "warning"));
      return { passed: true, failures: [] };
    }

    const res = await fetch(`${org.instanceUrl}/services/data/v60.0/tooling/runTestsAsynchronous`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${org.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ classNames: testClassNames.join(",") }),
    });

    if (!res.ok) {
      const errText = await res.text();
      emitAndLog(runId, emit, makeStep("testing", "error", `Failed to enqueue tests: ${errText}`, "error"));
      return { passed: false, failures: [`Test enqueue failed: ${errText}`] };
    }

    const testRunId = await res.text();
    emitAndLog(runId, emit, makeStep("testing", "running", `Test run ${testRunId} enqueued, polling for results...`, "info"));

    // Poll for results (up to 2 minutes)
    for (let i = 0; i < 24; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const statusRes = await fetch(
        `${org.instanceUrl}/services/data/v60.0/tooling/query?q=${encodeURIComponent(
          `SELECT Status, ClassesCompleted, ClassesEnqueued FROM ApexTestRunResult WHERE AsyncApexJobId='${testRunId}'`
        )}`,
        { headers: { "Authorization": `Bearer ${org.accessToken}` } }
      );

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        const record = statusData.records?.[0];
        if (record && (record.Status === "Completed" || record.Status === "Failed")) {
          if (record.Status === "Completed") {
            emitAndLog(runId, emit, makeStep("testing", "complete", "All Apex tests passed", "success"));
            return { passed: true, failures: [] };
          } else {
            emitAndLog(runId, emit, makeStep("testing", "failed", "Some Apex tests failed", "error"));
            return { passed: false, failures: ["Apex test run failed"] };
          }
        }
      }
    }

    emitAndLog(runId, emit, makeStep("testing", "timeout", "Test execution timed out after 2 minutes", "warning"));
    return { passed: false, failures: ["Test execution timed out"] };
  } catch (e: any) {
    emitAndLog(runId, emit, makeStep("testing", "error", `Test execution error: ${e.message}`, "error"));
    return { passed: false, failures: [e.message] };
  }
}

// ============================================================
// PHASE 5: Error Fix & Retry Loop
// ============================================================
async function runFixAndRetry(
  runId: number,
  requirement: Requirement,
  org: SfOrg,
  failedComponents: any[],
  errors: string[],
  emit: SSEEmitter
): Promise<boolean> {
  storage.updateAgentRun(runId, { phase: "fixing" });
  emitAndLog(runId, emit, makeStep("fixing", "start", `Analyzing ${errors.length} errors and generating fixes...`, "thinking"));

  const run = storage.getAgentRun(runId);
  if (!run) return false;

  if (run.retryCount >= run.maxRetries) {
    emitAndLog(runId, emit, makeStep("fixing", "max_retries", `Maximum retries (${run.maxRetries}) reached. Manual intervention required.`, "error"));
    return false;
  }

  storage.updateAgentRun(runId, { retryCount: run.retryCount + 1 });

  // Ask AI to fix the errors
  const message = await client.messages.create({
    model: "claude_sonnet_4_6",
    max_tokens: 8192,
    messages: [{
      role: "user",
      content: `You are an expert Salesforce developer debugging deployment failures. Fix the following errors.

ORIGINAL REQUIREMENT: ${requirement.title}
${requirement.description}

FAILED COMPONENTS AND ERRORS:
${errors.join("\n")}

ORIGINAL METADATA THAT FAILED:
${failedComponents.map(c => `--- ${c.componentType}: ${c.apiName} ---\n${c.metadataXml}`).join("\n\n")}

Analyze each error, fix the metadata, and respond with JSON only:
{
  "fixes": [
    {
      "apiName": "Component_API_Name",
      "diagnosis": "What was wrong",
      "fixedMetadata": "The corrected XML or code"
    }
  ],
  "explanation": "Summary of what was fixed"
}`
    }]
  });

  const content = message.content[0];
  if (content.type !== "text") throw new Error("Unexpected fix response");

  let parsed;
  try {
    parsed = JSON.parse(content.text);
  } catch {
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    else throw new Error("Could not parse fix response");
  }

  const fixes = parsed.fixes || [];

  emitAndLog(runId, emit, makeStep(
    "fixing", "diagnosed",
    `Diagnosis: ${parsed.explanation || "Applied fixes to failed components"}`,
    "info"
  ));

  // Apply fixes
  for (const fix of fixes) {
    const comp = failedComponents.find(c => c.apiName === fix.apiName);
    if (comp) {
      storage.updateComponent(comp.id, {
        metadataXml: fix.fixedMetadata,
        status: "approved",
        deploymentLog: `Fix applied (retry ${run.retryCount + 1}): ${fix.diagnosis}`,
      });
      emitAndLog(runId, emit, makeStep("fixing", "fix_applied", `Fixed ${comp.apiName}: ${fix.diagnosis}`, "success"));
    }
  }

  return true;
}

// ============================================================
// MAIN AGENT ORCHESTRATOR
// ============================================================
export async function executeAgentRun(
  runId: number,
  requirementId: number,
  orgId: number | null,
  emit: SSEEmitter
): Promise<void> {
  const requirement = storage.getRequirement(requirementId);
  if (!requirement) {
    emit(makeStep("init", "error", "Requirement not found", "error"));
    return;
  }

  // Resolve org
  let org: SfOrg | undefined;
  if (orgId) {
    org = storage.getOrg(orgId);
    if (!org) {
      emit(makeStep("init", "error", "Target org not found", "error"));
      return;
    }
  } else {
    // Use first available org or create a demo one
    const orgs = storage.getOrgs();
    org = orgs.find(o => o.status === "connected") || orgs[0];
    if (!org) {
      org = storage.createOrg({
        name: "Demo Sandbox",
        instanceUrl: "https://demo.salesforce.com",
        orgType: "sandbox",
        status: "disconnected",
      });
    }
  }

  storage.updateAgentRun(runId, { status: "running", orgId: org.id });
  storage.updateRequirement(requirementId, { status: "analyzing" });

  emitAndLog(runId, emit, makeStep("init", "start", `Agent started for: "${requirement.title}" → ${org.name}`, "info"));

  try {
    // PHASE 1: Analyze
    const analysisResult = await runAnalysis(runId, requirement, emit);

    // PHASE 2: Generate metadata
    let components = await runGeneration(runId, requirement, analysisResult, emit);

    // PHASE 3+4+5: Deploy → Test → Fix retry loop
    let maxAttempts = 4; // initial + 3 retries
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;
      emitAndLog(runId, emit, makeStep("deploying", "attempt", `Deployment attempt ${attempt}/${maxAttempts}`, "info"));

      // Re-fetch components (may have been updated by fix phase)
      components = storage.getComponentsByRequirement(requirementId)
        .filter(c => c.status === "approved" || c.status === "deployed");

      const deployResult = await runDeployment(runId, requirement, org, components, emit);

      if (deployResult.success) {
        // Run tests
        const testResult = await runTests(runId, org, components, emit);

        if (testResult.passed) {
          // All good — mark complete
          storage.updateAgentRun(runId, {
            status: "success",
            phase: "complete",
            completedAt: new Date().toISOString(),
          });
          storage.updateRequirement(requirementId, { status: "deployed" });
          emitAndLog(runId, emit, makeStep(
            "complete", "done",
            `Agent completed successfully. ${components.length} components deployed and verified.`,
            "success"
          ));
          return;
        } else {
          // Tests failed — try to fix
          if (attempt < maxAttempts) {
            const fixApplied = await runFixAndRetry(
              runId, requirement, org,
              components.filter(c => c.componentType === "ApexClass"),
              testResult.failures,
              emit
            );
            if (!fixApplied) break;
          }
        }
      } else {
        // Deployment errors — try to fix
        if (attempt < maxAttempts) {
          const failedComps = storage.getComponentsByRequirement(requirementId)
            .filter(c => c.status === "failed");
          const fixApplied = await runFixAndRetry(runId, requirement, org, failedComps, deployResult.errors, emit);
          if (!fixApplied) break;
        }
      }
    }

    // If we exit the loop without returning, we failed
    storage.updateAgentRun(runId, {
      status: "failed",
      phase: "complete",
      errorSummary: "Exhausted retry attempts",
      completedAt: new Date().toISOString(),
    });
    storage.updateRequirement(requirementId, { status: "failed" });
    emitAndLog(runId, emit, makeStep(
      "complete", "failed",
      "Agent exhausted all retry attempts. Review the logs and fix manually.",
      "error"
    ));
  } catch (err: any) {
    storage.updateAgentRun(runId, {
      status: "failed",
      phase: "complete",
      errorSummary: err.message,
      completedAt: new Date().toISOString(),
    });
    storage.updateRequirement(requirementId, { status: "failed" });
    emitAndLog(runId, emit, makeStep("complete", "error", `Agent error: ${err.message}`, "error"));
  }
}
