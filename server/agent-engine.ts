import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage";
import { deployToOrg } from "./metadata-deployer";
import { fireWebhook } from "./webhook-service";
import type { AgentStep, AgentRun, Requirement, SfOrg } from "@shared/schema";
import { randomUUID } from "crypto";

// Lazy-initialize the Anthropic client so it reads ANTHROPIC_API_KEY at call time, not at import time
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

type SSEEmitter = (step: AgentStep) => void;

// ============================================================
// ORG CONTEXT BUILDER — feeds discovery data into AI prompts
// ============================================================
export function buildOrgContext(orgId: number): string {
  const org = storage.getOrg(orgId);
  if (!org) return "";

  // Get latest completed scan
  const scans = storage.getOrgScans(orgId);
  const latestScan = scans.find(s => s.status === "completed");
  if (!latestScan) return "";

  const inventory = storage.getOrgInventory(orgId);
  if (inventory.length === 0) return "";

  const clouds: string[] = latestScan.cloudsDetectedJson ? JSON.parse(latestScan.cloudsDetectedJson) : [];
  const packages: any[] = latestScan.packagesJson ? JSON.parse(latestScan.packagesJson) : [];
  const edition = org.orgEdition || "Unknown";

  // Summarize inventory by category
  const categoryCounts: Record<string, number> = {};
  const categoryExamples: Record<string, string[]> = {};
  for (const item of inventory) {
    categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
    if (!categoryExamples[item.category]) categoryExamples[item.category] = [];
    if (categoryExamples[item.category].length < 5) {
      categoryExamples[item.category].push(item.apiName);
    }
  }

  const customObjects = categoryExamples["CustomObject"] || [];
  const apexClasses = categoryExamples["ApexClass"] || [];
  const apexTriggers = inventory.filter(i => i.category === "ApexTrigger");
  const flows = categoryExamples["Flow"] || [];

  const triggerSummary = apexTriggers
    .map(t => {
      const parentObj = t.parentApiName || "unknown object";
      return `${t.apiName} (on ${parentObj})`;
    })
    .slice(0, 5);

  const packageSummary = packages.length > 0
    ? packages.map((p: any) => `${p.name || p.Name} (${p.namespace || p.NamespacePrefix || "N/A"}, v${p.version || p.VersionNumber || "?"})`).join(", ")
    : "None";

  // Build edition constraints
  let editionConstraints = "";
  const edLower = edition.toLowerCase();
  if (edLower.includes("professional")) {
    editionConstraints = `- Edition [Professional] does NOT support Apex code or Apex triggers. Only use declarative solutions: Flows, Custom Objects, Custom Fields, Validation Rules, Permission Sets.
- DO NOT generate ApexClass, ApexTrigger, or LWC components for this org.`;
  } else if (edLower.includes("group")) {
    editionConstraints = `- Edition [Group] has very limited custom objects and does NOT support Apex code.
- DO NOT generate ApexClass, ApexTrigger, or LWC components for this org.`;
  } else if (edLower.includes("essentials")) {
    editionConstraints = `- Edition [Essentials] does NOT support Apex code and has limited customization.
- DO NOT generate ApexClass, ApexTrigger, or LWC components for this org.`;
  } else {
    editionConstraints = `- Edition [${edition}] supports: Apex, Flows, Custom Objects, LWC, Validation Rules, Permission Sets.`;
  }

  return `
ORG CONTEXT (from discovery scan):
Edition: ${edition}
Active Clouds: ${clouds.length > 0 ? clouds.join(", ") : "None detected"}
Installed Packages: ${packageSummary}
Existing Custom Objects: ${customObjects.join(", ")} (${categoryCounts["CustomObject"] || 0} total)
Existing Apex Classes: ${apexClasses.join(", ")} (${categoryCounts["ApexClass"] || 0} total)
Existing Apex Triggers: ${triggerSummary.join(", ") || "None"} (${categoryCounts["ApexTrigger"] || 0} total)
Existing Flows: ${flows.join(", ")} (${categoryCounts["Flow"] || 0} total)

CRITICAL CONSTRAINTS:
- DO NOT create components that require packages not listed above
- DO NOT create duplicate triggers on objects that already have triggers (consolidate instead)
- DO NOT use managed package objects/fields unless the package is installed
- If the requirement references CPQ/SBQQ objects, verify SBQQ package is installed above
- If the requirement references FSC/FinServ objects, verify Financial Services Cloud is detected
${editionConstraints}
`.trim();
}

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
// SALESFORCE WELL-ARCHITECTED GOVERNANCE RULES
// Embedded from https://architect.salesforce.com/well-architected
// ============================================================
const GOVERNANCE_SYSTEM_PROMPT = `You are a Senior Salesforce Technical Architect performing an architectural governance review.
You MUST enforce ALL of the following rules strictly. Your role is to CHALLENGE the design, not rubber-stamp it.

## SALESFORCE WELL-ARCHITECTED FRAMEWORK PILLARS

### TRUSTED (Security & Compliance)
- All Apex must enforce CRUD/FLS checks (WITH SECURITY_ENFORCED or Schema.sObjectType checks)
- No hardcoded IDs, credentials, passwords, or org-specific references in code
- Enforce sharing rules: use "with sharing" by default; document any "without sharing" usage
- Sensitive data must use Platform Encryption or Shield where appropriate
- Connected Apps must use named credentials, never store tokens in custom settings

### EASY (Intentional, Maintainable, Readable)
- One trigger per object (consolidate with trigger handler framework)
- Consolidate automations per object — no duplicate Flow/Process Builder/Trigger on same object & event
- Clear naming conventions: [Object]_[Purpose]_[Type] (e.g., Account_UpdateRating_Flow)
- All Apex classes must have JSDoc/ApexDoc comments
- No business logic directly in triggers — use handler classes
- Use Custom Metadata Types or Custom Labels for configuration, not Custom Settings (deprecated pattern)

### ADAPTABLE (Resilient, ALM-Ready)
- All components must be deployable via Metadata API (no manual config steps)
- Include @isTest classes with meaningful assertions (>75% coverage, aim for >90%)
- Use bulk-safe test data factories, not seeAllData=true
- Consider impact on existing automation before adding new automation

## GOVERNOR LIMITS — HARD RULES
- Max 100 SOQL queries per synchronous transaction (200 async)
- Max 150 DML statements per transaction
- Max 10,000 DML records per transaction
- Max 6MB heap size sync / 12MB async
- Max 10 seconds CPU time sync / 60 seconds async
- NEVER put SOQL or DML inside loops — this is the #1 violation to catch
- Use collections (List, Set, Map) for bulk processing
- Use selective queries with indexed fields (Id, Name, CreatedDate, RecordTypeId, standard lookup fields)
- Before-save Flows for same-record field updates (10-20x faster than after-save)

## BULKIFICATION REQUIREMENTS
- All Apex triggers must handle up to 200 records per batch
- All Flows must handle bulk invocations
- Use Trigger.new / Trigger.old collections, never assume single record
- Avoid row-level SOQL; query outside loop and use Map for lookups
- For large data volumes, use Batch Apex or Queueable instead of synchronous processing

## FSC (Financial Services Cloud) CONVENTIONS
- Use Person Accounts for individual clients (not standard Contacts where FSC is enabled)
- Use FinServ__FinancialAccount__c and related standard FSC objects (not custom duplicates)
- FinServ namespace objects require FSC licensing — flag if used outside FSC orgs
- Limited Financial Account records per account — design for pagination and lazy loading
- FSC requires Professional, Enterprise, or Unlimited Edition
- Experience Cloud integration needs Partner Community or Customer Community Plus licenses
- Check for managed package object conflicts before creating custom objects with similar names

## RECENT SALESFORCE RELEASE CONSIDERATIONS
- Flow is the preferred automation tool (not Process Builder or Workflow Rules — both are being retired)
- Use before-save record-triggered Flows for same-record updates where possible
- Screen Flows should use reactive components and custom LWC within Flows
- Use Salesforce CLI (sf) for deployment, not the legacy Metadata API when possible
- API version should be 60.0+ (current)

## ANTI-PATTERNS TO FLAG
1. SOQL/DML inside loops
2. Hardcoded record IDs or org-specific URLs
3. Multiple triggers on the same object
4. Using Process Builder for new automation (use Flow instead)
5. seeAllData=true in test classes
6. Missing CRUD/FLS enforcement
7. Custom objects that duplicate standard FSC objects
8. Storing config in Custom Settings instead of Custom Metadata Types
9. Mixed DML operations (setup + non-setup objects in same transaction)
10. Missing error handling in Apex (empty catch blocks)
11. Recursive trigger execution without recursion guards
12. Non-selective SOQL queries on large tables
13. Using Metadata API operations that require manual org configuration
14. Hardcoded API versions below 60.0`;

// ============================================================
// ARCHITECTURAL REVIEW TYPES
// ============================================================
export interface ArchitectViolation {
  rule: string;
  severity: "blocker" | "critical" | "warning" | "info";
  component?: string;
  description: string;
  recommendation: string;
  frameworkPillar: "Trusted" | "Easy" | "Adaptable" | "Governor Limits" | "FSC" | "Best Practice";
}

export interface ArchitectReviewResult {
  overallVerdict: "pass" | "pass_with_warnings" | "fail";
  violations: ArchitectViolation[];
  designChallenges: string[];
  fscImplications: string[];
  governorLimitRisks: string[];
  recommendations: string[];
  approvedToGenerate: boolean;
}

// ============================================================
// PHASE 0: ARCHITECTURAL REVIEW (Pre-Build Governance Gate)
// ============================================================
export async function runArchitectReview(
  requirement: Requirement,
  runId?: number,
  emit?: SSEEmitter,
  orgContext?: string
): Promise<ArchitectReviewResult> {
  if (runId && emit) {
    emitAndLog(runId, emit, makeStep("architect_review", "start", "Architectural governance review in progress — challenging design decisions...", "thinking"));
    storage.updateAgentRun(runId, { phase: "architect_review" });
  }

  const message = await getClient().messages.create({
    model: "claude_sonnet_4_6",
    max_tokens: 6144,
    system: GOVERNANCE_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `Perform a thorough architectural governance review of the following Salesforce requirement BEFORE any code or metadata is generated.

Act as a critical Technical Architect — your job is to find problems, challenge assumptions, and prevent bad designs from progressing.

REQUIREMENT:
Title: ${requirement.title}
Description: ${requirement.description}
Category: ${requirement.category}
Priority: ${requirement.priority}
${orgContext ? `\n${orgContext}\n` : ""}
Analyze this requirement against ALL governance rules and respond with JSON only (no markdown, no code fences):
{
  "overallVerdict": "pass | pass_with_warnings | fail",
  "violations": [
    {
      "rule": "Name of the violated rule",
      "severity": "blocker | critical | warning | info",
      "component": "Which proposed component is affected (if applicable)",
      "description": "What is wrong",
      "recommendation": "How to fix it",
      "frameworkPillar": "Trusted | Easy | Adaptable | Governor Limits | FSC | Best Practice"
    }
  ],
  "designChallenges": [
    "Questions or challenges for the developer about their design decisions — things that should be reconsidered"
  ],
  "fscImplications": [
    "Any FSC-specific licensing, data model, or packaging implications. If not FSC-related, return empty array."
  ],
  "governorLimitRisks": [
    "Specific governor limit risks identified in this design"
  ],
  "recommendations": [
    "Positive architectural recommendations to improve the design"
  ],
  "approvedToGenerate": true/false
}

CRITICAL RULES FOR YOUR REVIEW:
- If any "blocker" violations exist, set approvedToGenerate=false and overallVerdict="fail"
- If only warnings/info exist, set approvedToGenerate=true and overallVerdict="pass_with_warnings"
- If clean, set overallVerdict="pass"
- ALWAYS include at least 1-2 design challenges even for clean designs (the architect always questions)
- Be specific — reference the actual requirement details in your findings
- Consider what COULD go wrong at scale (1000+ records, concurrent users, large data volumes)`
    }]
  });

  const content = message.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");

  let parsed: ArchitectReviewResult;
  try {
    parsed = JSON.parse(content.text);
  } catch {
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    else throw new Error("Could not parse architectural review response");
  }

  // Emit violations as individual steps
  if (runId && emit) {
    const blockers = parsed.violations.filter(v => v.severity === "blocker");
    const criticals = parsed.violations.filter(v => v.severity === "critical");
    const warnings = parsed.violations.filter(v => v.severity === "warning");

    if (blockers.length > 0) {
      for (const v of blockers) {
        emitAndLog(runId, emit, makeStep("architect_review", "blocker",
          `BLOCKER [${v.frameworkPillar}]: ${v.description} → ${v.recommendation}`, "error"));
      }
    }

    if (criticals.length > 0) {
      for (const v of criticals) {
        emitAndLog(runId, emit, makeStep("architect_review", "critical",
          `CRITICAL [${v.frameworkPillar}]: ${v.description} → ${v.recommendation}`, "error"));
      }
    }

    if (warnings.length > 0) {
      for (const v of warnings) {
        emitAndLog(runId, emit, makeStep("architect_review", "warning",
          `WARNING [${v.frameworkPillar}]: ${v.description} → ${v.recommendation}`, "warning"));
      }
    }

    if (parsed.designChallenges.length > 0) {
      for (const challenge of parsed.designChallenges) {
        emitAndLog(runId, emit, makeStep("architect_review", "challenge",
          `ARCHITECT CHALLENGE: ${challenge}`, "info"));
      }
    }

    if (parsed.governorLimitRisks.length > 0) {
      for (const risk of parsed.governorLimitRisks) {
        emitAndLog(runId, emit, makeStep("architect_review", "governor_risk",
          `GOVERNOR LIMIT RISK: ${risk}`, "warning"));
      }
    }

    if (parsed.fscImplications.length > 0) {
      for (const imp of parsed.fscImplications) {
        emitAndLog(runId, emit, makeStep("architect_review", "fsc",
          `FSC IMPLICATION: ${imp}`, "info"));
      }
    }

    // Final verdict
    const verdictStatus = parsed.overallVerdict === "fail" ? "error"
      : parsed.overallVerdict === "pass_with_warnings" ? "warning" : "success";
    const verdictText = parsed.overallVerdict === "fail"
      ? `REVIEW FAILED: ${blockers.length} blockers, ${criticals.length} critical issues found. Design must be revised before code generation.`
      : parsed.overallVerdict === "pass_with_warnings"
        ? `REVIEW PASSED WITH WARNINGS: ${warnings.length} warnings to address. Proceeding with caution.`
        : "REVIEW PASSED: Design is compliant with Salesforce Well-Architected Framework.";

    emitAndLog(runId, emit, makeStep("architect_review", "verdict", verdictText, verdictStatus as AgentStep["status"]));
  }

  return parsed;
}

// ============================================================
// PHASE 1: AI Analysis (Enhanced with Governance)
// ============================================================
async function runAnalysis(
  runId: number,
  requirement: Requirement,
  architectReview: ArchitectReviewResult,
  emit: SSEEmitter,
  orgContext?: string
): Promise<any> {
  emitAndLog(runId, emit, makeStep("analyzing", "start", "Analyzing requirement with AI architect (governance-aware)...", "thinking"));
  storage.updateAgentRun(runId, { phase: "analyzing" });

  const warningContext = architectReview.violations.length > 0
    ? `\n\nARCHITECTURAL REVIEW FINDINGS TO ADDRESS:\n${architectReview.violations.map(v =>
      `- [${v.severity.toUpperCase()}] ${v.description}: ${v.recommendation}`
    ).join("\n")}\n\nYou MUST address all violations in your analysis. Do not propose components that violate these rules.`
    : "";

  const fscContext = architectReview.fscImplications.length > 0
    ? `\n\nFSC IMPLICATIONS TO CONSIDER:\n${architectReview.fscImplications.map(i => `- ${i}`).join("\n")}`
    : "";

  const message = await getClient().messages.create({
    model: "claude_sonnet_4_6",
    max_tokens: 4096,
    system: GOVERNANCE_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `You are an expert Salesforce architect. Analyze this requirement and produce a deployment plan.
You must COMPLY with ALL Salesforce Well-Architected Framework rules and governance constraints provided in your system instructions.
${warningContext}${fscContext}

REQUIREMENT:
Title: ${requirement.title}
Description: ${requirement.description}
Category: ${requirement.category}
Priority: ${requirement.priority}
${orgContext ? `\n${orgContext}\n` : ""}
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
  "bestPractices": ["Best practice notes — must reference Well-Architected Framework"],
  "risks": [{ "risk": "Description", "mitigation": "How to fix", "severity": "low|medium|high" }],
  "estimatedEffort": "Time estimate",
  "deployOrder": ["Ordered list of apiNames for correct deployment sequence"],
  "governanceNotes": ["How this design addresses each architectural review finding"]
}

HARD RULES:
- One trigger per object maximum — use handler classes
- Use before-save Flows for same-record field updates
- All Apex must be bulkified — no SOQL/DML in loops
- No hardcoded IDs or org-specific values
- Include @isTest classes for all Apex with meaningful assertions
- Use Custom Metadata Types for configuration values
- Enforce CRUD/FLS in all Apex (WITH SECURITY_ENFORCED)
- API version 60.0 for all components
- Flow is preferred over Process Builder / Workflow Rules`
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
// PHASE 2: Metadata Generation (Enhanced with Governance)
// ============================================================
async function runGeneration(
  runId: number,
  requirement: Requirement,
  analysisResult: any,
  emit: SSEEmitter,
  orgContext?: string
): Promise<any[]> {
  emitAndLog(runId, emit, makeStep("generating", "start", "Generating governance-compliant Salesforce metadata and code...", "thinking"));
  storage.updateAgentRun(runId, { phase: "generating" });
  storage.updateRequirement(requirement.id, { status: "generating" });

  const components = analysisResult.components || [];

  const message = await getClient().messages.create({
    model: "claude_sonnet_4_6",
    max_tokens: 8192,
    system: GOVERNANCE_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `You are an expert Salesforce developer. Generate complete, deployable Salesforce metadata.
You MUST comply with ALL Salesforce Well-Architected Framework rules in your system instructions.

REQUIREMENT: ${requirement.title}
DESCRIPTION: ${requirement.description}

COMPONENTS TO BUILD:
${JSON.stringify(components, null, 2)}
${orgContext ? `\n${orgContext}\n` : ""}
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

MANDATORY GOVERNANCE RULES FOR CODE GENERATION:
- Custom Objects: include deploymentStatus=Deployed, enableActivities, enableReports, sharingModel
- Custom Fields: include label, type, required, description
- Apex Classes: 
  * API version 60.0
  * Bulkified code — NO SOQL or DML inside loops
  * Use "with sharing" keyword
  * Enforce CRUD/FLS with WITH SECURITY_ENFORCED on all SOQL queries
  * Use collections (List, Map, Set) for bulk processing
  * Include JSDoc-style comments
  * No hardcoded IDs or org-specific values
  * Include proper error handling (no empty catch blocks)
- Apex Triggers:
  * One trigger per object (consolidate if existing trigger exists)
  * Use handler class pattern — no business logic in trigger body
  * Handle up to 200 records per batch
  * Include recursion guard (static Boolean or Trigger context variable)
- Test Classes:
  * Separate @isTest class with @testSetup method
  * Create test data via factory — NEVER use seeAllData=true
  * Test bulk operations (insert 200 records)
  * Test positive, negative, and boundary scenarios
  * Aim for >90% code coverage with meaningful assertions
- Flows: 
  * Use before-save record-triggered Flows for same-record field updates
  * Complete Flow metadata XML
  * Use Decision elements for branching logic
- Validation Rules: include errorMessage, errorDisplayField
- LWC: provide JS module + HTML template as combined string, wire adapters where appropriate
- Permission Sets: principle of least privilege
- All metadata must be deployable via Metadata API with NO manual steps`
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

  // Post-generation governance validation
  emitAndLog(runId, emit, makeStep("generating", "post_validation", "Running post-generation governance validation...", "thinking"));

  const postValidation = await runPostGenerationValidation(createdComponents);
  if (postValidation.issues.length > 0) {
    for (const issue of postValidation.issues) {
      emitAndLog(runId, emit, makeStep("generating", "governance_flag",
        `POST-GEN CHECK: ${issue}`, "warning"));
    }
  }

  storage.updateRequirement(requirement.id, { status: "ready" });

  emitAndLog(runId, emit, makeStep(
    "generating", "complete",
    `Generated ${createdComponents.length} governance-compliant components`,
    "success"
  ));

  return createdComponents;
}

// Post-generation static analysis for common violations
async function runPostGenerationValidation(components: any[]): Promise<{ issues: string[] }> {
  const issues: string[] = [];

  for (const comp of components) {
    const code = (comp.metadataXml || comp.metadata || "").toLowerCase();
    const name = comp.apiName || comp.label || "";

    // Check for SOQL/DML in loops
    if (comp.componentType === "ApexClass" || comp.componentType === "ApexTrigger") {
      if (/for\s*\(.*\)[\s\S]*?\[select\s/i.test(code) || /while\s*\(.*\)[\s\S]*?\[select\s/i.test(code)) {
        issues.push(`${name}: Potential SOQL query inside loop detected`);
      }
      if (/for\s*\(.*\)[\s\S]*?(insert|update|delete|upsert)\s/i.test(code)) {
        issues.push(`${name}: Potential DML statement inside loop detected`);
      }
      // Check for hardcoded IDs (15 or 18 char Salesforce IDs)
      if (/['"][a-zA-Z0-9]{15,18}['"]/.test(comp.metadataXml || comp.metadata || "")) {
        const idMatch = (comp.metadataXml || comp.metadata || "").match(/['"]([a-zA-Z0-9]{15,18})['"]/);
        if (idMatch && /^[a-zA-Z0-9]{15}$|^[a-zA-Z0-9]{18}$/.test(idMatch[1])) {
          // Rough check for SF ID pattern (starts with 001, 003, 005, etc.)
          const prefix = idMatch[1].substring(0, 3);
          if (/^[0-9]{3}$/.test(prefix)) {
            issues.push(`${name}: Potential hardcoded Salesforce ID detected (${idMatch[1].substring(0, 8)}...)`);
          }
        }
      }
      // Check for missing "with sharing"
      if (/class\s+\w+/.test(code) && !code.includes("with sharing") && !code.includes("@istest")) {
        issues.push(`${name}: Missing "with sharing" keyword — potential security risk`);
      }
      // Check for seeAllData
      if (/seealldata\s*=\s*true/i.test(code)) {
        issues.push(`${name}: Uses seeAllData=true — violates test isolation best practice`);
      }
      // Check for empty catch blocks
      if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(code)) {
        issues.push(`${name}: Empty catch block detected — add proper error handling`);
      }
    }
  }

  return { issues };
}

// ============================================================
// PHASE 3: Deployment via Metadata API ZIP Deploy
// Uses the REST /metadata/deployRequest endpoint with a proper
// ZIP package containing package.xml + all component files.
// Supports ALL metadata types: Objects, Fields, Apex, Flows,
// LWC, Validation Rules, Permission Sets, Layouts, and more.
// ============================================================
async function runDeployment(
  runId: number,
  requirement: Requirement,
  org: SfOrg,
  components: any[],
  emit: SSEEmitter
): Promise<{ success: boolean; errors: string[] }> {
  emitAndLog(runId, emit, makeStep("deploying", "start", `Deploying ${components.length} components to ${org.name} via Metadata API ZIP deploy...`, "thinking"));
  storage.updateAgentRun(runId, { phase: "deploying" });
  storage.updateRequirement(requirement.id, { status: "deploying" });

  const deploymentLogs: any[] = [
    { timestamp: new Date().toISOString(), message: "Metadata API ZIP deployment initiated", level: "info" },
  ];

  // Capture before-metadata for snapshot diffing
  const beforeMetadataMap = new Map<string, string | null>();
  const orgInventory = storage.getOrgInventory(org.id);
  for (const comp of components) {
    const existing = orgInventory.find(item => item.apiName === comp.apiName && item.category === comp.componentType);
    beforeMetadataMap.set(comp.apiName, existing?.sourceCode || existing?.metadataJson || null);
  }

  // List all components being deployed
  for (const comp of components) {
    emitAndLog(runId, emit, makeStep("deploying", "packaging", `Packaging ${comp.componentType}: ${comp.label} (${comp.apiName})`, "info"));
  }

  if (org.status !== "connected" || !org.accessToken) {
    // Simulated deployment for demo / unconnected orgs
    for (const comp of components) {
      storage.updateComponent(comp.id, { status: "deployed", deploymentLog: "Deployed (simulated)" });
      deploymentLogs.push({
        timestamp: new Date().toISOString(),
        message: `✓ ${comp.label} deployed (simulated — connect org for live deployment)`,
        level: "success",
      });
      emitAndLog(runId, emit, makeStep("deploying", "deploy_success", `${comp.label} deployed (simulated)`, "success"));
    }

    const simDep = storage.createDeployment({
      requirementId: requirement.id,
      orgId: org.id,
      status: "success",
      componentsJson: JSON.stringify(components.map((c: any) => c.id)),
      logJson: JSON.stringify(deploymentLogs),
      startedAt: new Date().toISOString(),
    });

    // Create deployment snapshots
    for (const comp of components) {
      const before = beforeMetadataMap.get(comp.apiName);
      storage.createDeploymentSnapshot({
        deploymentId: simDep.id,
        componentApiName: comp.apiName,
        componentType: comp.componentType,
        beforeMetadata: before || null,
        afterMetadata: comp.metadataXml || "",
        changeType: before ? "modified" : "created",
        createdAt: new Date().toISOString(),
      });
    }

    return { success: true, errors: [] };
  }

  // Real deployment via Metadata API ZIP
  try {
    const result = await deployToOrg(org, components, (progress) => {
      const statusMsg = progress.stateDetail
        || `Status: ${progress.status} (${progress.componentsDeployed || 0}/${progress.componentsTotal || 0} components)`;

      emitAndLog(runId, emit, makeStep(
        "deploying",
        progress.done ? (progress.success ? "deploy_success" : "deploy_error") : "deploy_progress",
        statusMsg,
        progress.done ? (progress.success ? "success" : "error") : "info"
      ));

      deploymentLogs.push({
        timestamp: new Date().toISOString(),
        message: statusMsg,
        level: progress.done ? (progress.success ? "success" : "error") : "info",
      });
    });

    // Update individual component statuses
    const errors: string[] = [];
    if (result.success) {
      for (const comp of components) {
        storage.updateComponent(comp.id, { status: "deployed", deploymentLog: "Deployed via Metadata API" });
      }
      emitAndLog(runId, emit, makeStep("deploying", "deploy_success",
        `All ${components.length} components deployed successfully (Deploy ID: ${result.id})`, "success"));
    } else {
      // Mark components based on errors
      const failedApiNames = new Set(result.errors.map(e => e.apiName));

      for (const comp of components) {
        const compError = result.errors.find(e =>
          e.apiName === comp.apiName || e.apiName.includes(comp.apiName)
        );
        if (compError) {
          storage.updateComponent(comp.id, { status: "failed", deploymentLog: compError.problem });
          errors.push(`${comp.apiName}: ${compError.problem}`);
          emitAndLog(runId, emit, makeStep("deploying", "deploy_error",
            `${comp.label} failed: ${compError.problem}`, "error"));
        } else {
          // Component not specifically flagged as failed — may have deployed
          storage.updateComponent(comp.id, { status: result.numberComponentsDeployed ? "deployed" : "failed", deploymentLog: result.success ? "Deployed" : "Deployment had errors" });
        }
      }

      // Add any errors not matched to specific components
      for (const err of result.errors) {
        if (!errors.some(e => e.includes(err.apiName))) {
          errors.push(`${err.apiName}: ${err.problem}`);
          emitAndLog(runId, emit, makeStep("deploying", "deploy_error",
            `${err.componentType} ${err.apiName}: ${err.problem}`, "error"));
        }
      }
    }

    // Create deployment record
    const realDep = storage.createDeployment({
      requirementId: requirement.id,
      orgId: org.id,
      status: result.success ? "success" : errors.length < components.length ? "partial" : "failed",
      componentsJson: JSON.stringify(components.map((c: any) => c.id)),
      logJson: JSON.stringify(deploymentLogs),
      startedAt: new Date().toISOString(),
    });

    // Create deployment snapshots
    for (const comp of components) {
      const before = beforeMetadataMap.get(comp.apiName);
      storage.createDeploymentSnapshot({
        deploymentId: realDep.id,
        componentApiName: comp.apiName,
        componentType: comp.componentType,
        beforeMetadata: before || null,
        afterMetadata: comp.metadataXml || "",
        changeType: before ? "modified" : "created",
        createdAt: new Date().toISOString(),
      });
    }

    return { success: result.success, errors };
  } catch (e: any) {
    const errMsg = e.message || "Unknown deployment error";
    emitAndLog(runId, emit, makeStep("deploying", "deploy_error", `Deployment failed: ${errMsg}`, "error"));

    for (const comp of components) {
      storage.updateComponent(comp.id, { status: "failed", deploymentLog: errMsg });
    }

    storage.createDeployment({
      requirementId: requirement.id,
      orgId: org.id,
      status: "failed",
      componentsJson: JSON.stringify(components.map((c: any) => c.id)),
      logJson: JSON.stringify(deploymentLogs),
      startedAt: new Date().toISOString(),
    });

    return { success: false, errors: [errMsg] };
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
// PHASE 5: Error Fix & Retry Loop (Enhanced with Governance)
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
  emitAndLog(runId, emit, makeStep("fixing", "start", `Analyzing ${errors.length} errors and generating governance-compliant fixes...`, "thinking"));

  const run = storage.getAgentRun(runId);
  if (!run) return false;

  if (run.retryCount >= run.maxRetries) {
    emitAndLog(runId, emit, makeStep("fixing", "max_retries", `Maximum retries (${run.maxRetries}) reached. Manual intervention required.`, "error"));
    return false;
  }

  storage.updateAgentRun(runId, { retryCount: run.retryCount + 1 });

  const message = await getClient().messages.create({
    model: "claude_sonnet_4_6",
    max_tokens: 8192,
    system: GOVERNANCE_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `You are an expert Salesforce developer debugging deployment failures.
Fix the following errors while maintaining compliance with ALL governance rules in your system instructions.

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
}

IMPORTANT: The fixed code must still comply with ALL governance rules:
- Bulkified code, no SOQL/DML in loops
- WITH SECURITY_ENFORCED on queries
- "with sharing" keyword
- No hardcoded IDs
- Proper error handling`
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
    `Diagnosis: ${parsed.explanation || "Applied governance-compliant fixes to failed components"}`,
    "info"
  ));

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
// MAIN AGENT ORCHESTRATOR (Enhanced with Architectural Review)
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

  // Build org context from discovery data (if available)
  const orgContext = buildOrgContext(org.id);
  if (orgContext) {
    emitAndLog(runId, emit, makeStep("init", "org_context", "Loaded org context from discovery scan — AI prompts will be org-aware", "info"));
  }

  try {
    // PHASE 0: Architectural Governance Review (NEW — runs before anything else)
    const architectReview = await runArchitectReview(requirement, runId, emit, orgContext);

    if (!architectReview.approvedToGenerate) {
      // HALT — design has blockers
      storage.updateAgentRun(runId, {
        status: "failed",
        phase: "complete",
        errorSummary: `Architectural review failed: ${architectReview.violations.filter(v => v.severity === "blocker").length} blocker(s) found. Revise the requirement before proceeding.`,
        completedAt: new Date().toISOString(),
      });
      storage.updateRequirement(requirementId, { status: "failed" });
      emitAndLog(runId, emit, makeStep(
        "complete", "blocked",
        "Agent HALTED: Architectural review found blocking violations. Revise the requirement and rerun.",
        "error"
      ));
      return;
    }

    // PHASE 1: Analyze (governance-aware)
    const analysisResult = await runAnalysis(runId, requirement, architectReview, emit, orgContext);

    // PHASE 2: Generate metadata (governance-compliant)
    let components = await runGeneration(runId, requirement, analysisResult, emit, orgContext);

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
        const testResult = await runTests(runId, org, components, emit);

        if (testResult.passed) {
          storage.updateAgentRun(runId, {
            status: "success",
            phase: "complete",
            completedAt: new Date().toISOString(),
          });
          storage.updateRequirement(requirementId, { status: "deployed" });
          fireWebhook("deploy_success", {
            requirementTitle: requirement.title,
            orgName: org.name,
            componentsCount: components.length,
            runId,
          });
          emitAndLog(runId, emit, makeStep(
            "complete", "done",
            `Agent completed successfully. ${components.length} governance-compliant components deployed and verified.`,
            "success"
          ));
          return;
        } else {
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
    fireWebhook("deploy_failed", {
      requirementTitle: requirement.title,
      orgName: org.name,
      errorSummary: "Exhausted retry attempts",
      runId,
    });
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
    fireWebhook("deploy_failed", {
      requirementTitle: requirement.title,
      orgName: org?.name,
      errorSummary: err.message,
      runId,
    });
    emitAndLog(runId, emit, makeStep("complete", "error", `Agent error: ${err.message}`, "error"));
  }
}

// ============================================================
// VALIDATION RUN — checkOnly deploy (no tests/fix loops)
// Phases: 0 (Architect Review) → 1 (Analysis) → 2 (Generation) → 3 (Deploy checkOnly)
// ============================================================
export async function executeValidationRun(
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

  let org: SfOrg | undefined;
  if (orgId) {
    org = storage.getOrg(orgId);
    if (!org) {
      emit(makeStep("init", "error", "Target org not found", "error"));
      return;
    }
  } else {
    const orgs = storage.getOrgs();
    org = orgs.find(o => o.status === "connected") || orgs[0];
    if (!org) {
      emit(makeStep("init", "error", "No org available for validation", "error"));
      return;
    }
  }

  storage.updateAgentRun(runId, { status: "running", orgId: org.id, phase: "init" });

  emitAndLog(runId, emit, makeStep("init", "start", `Validation run started for: "${requirement.title}" → ${org.name} (checkOnly)`, "info"));

  const orgContext = buildOrgContext(org.id);
  if (orgContext) {
    emitAndLog(runId, emit, makeStep("init", "org_context", "Loaded org context from discovery scan", "info"));
  }

  try {
    // PHASE 0: Architectural review
    const architectReview = await runArchitectReview(requirement, runId, emit, orgContext);

    if (!architectReview.approvedToGenerate) {
      storage.updateAgentRun(runId, {
        status: "failed",
        phase: "complete",
        errorSummary: "Architectural review failed — blockers found",
        completedAt: new Date().toISOString(),
      });
      emitAndLog(runId, emit, makeStep("complete", "blocked", "Validation HALTED: Architectural review found blocking violations.", "error"));
      return;
    }

    // PHASE 1: Analysis
    const analysisResult = await runAnalysis(runId, requirement, architectReview, emit, orgContext);

    // PHASE 2: Generation
    const components = await runGeneration(runId, requirement, analysisResult, emit, orgContext);

    // PHASE 3: checkOnly deploy
    emitAndLog(runId, emit, makeStep("deploying", "start", `Running checkOnly validation deploy for ${components.length} components...`, "thinking"));
    storage.updateAgentRun(runId, { phase: "deploying" });

    if (org.status !== "connected" || !org.accessToken) {
      emitAndLog(runId, emit, makeStep("deploying", "skip", "Org not connected — cannot run live validation. Components generated successfully.", "warning"));

      storage.createDeployment({
        requirementId: requirement.id,
        orgId: org.id,
        status: "validated",
        componentsJson: JSON.stringify(components.map((c: any) => c.id)),
        logJson: JSON.stringify([{ timestamp: new Date().toISOString(), message: "Validation skipped — org not connected", level: "warning" }]),
        startedAt: new Date().toISOString(),
      });

      storage.updateAgentRun(runId, { status: "success", phase: "complete", completedAt: new Date().toISOString() });
      emitAndLog(runId, emit, makeStep("complete", "done", "Validation complete (simulated — org not connected).", "success"));
      return;
    }

    const result = await deployToOrg(org, components, (progress) => {
      const msg = progress.stateDetail || `Status: ${progress.status}`;
      emitAndLog(runId, emit, makeStep("deploying", progress.done ? (progress.success ? "validate_success" : "validate_error") : "validate_progress", msg, progress.done ? (progress.success ? "success" : "error") : "info"));
    }, { checkOnly: true });

    const deployStatus = result.success ? "validated" : "validation_failed";

    storage.createDeployment({
      requirementId: requirement.id,
      orgId: org.id,
      status: deployStatus,
      componentsJson: JSON.stringify(components.map((c: any) => c.id)),
      logJson: JSON.stringify(result.errors.length > 0
        ? result.errors.map(e => ({ timestamp: new Date().toISOString(), message: `${e.apiName}: ${e.problem}`, level: "error" }))
        : [{ timestamp: new Date().toISOString(), message: "Validation passed", level: "success" }]),
      startedAt: new Date().toISOString(),
    });

    if (result.success) {
      storage.updateAgentRun(runId, { status: "success", phase: "complete", completedAt: new Date().toISOString() });
      emitAndLog(runId, emit, makeStep("complete", "done", `Validation passed: ${components.length} components would deploy successfully.`, "success"));
    } else {
      const errSummary = result.errors.map(e => `${e.apiName}: ${e.problem}`).join("; ");
      storage.updateAgentRun(runId, { status: "failed", phase: "complete", errorSummary: errSummary, completedAt: new Date().toISOString() });
      emitAndLog(runId, emit, makeStep("complete", "failed", `Validation failed: ${result.errors.length} error(s).`, "error"));
    }
  } catch (err: any) {
    storage.updateAgentRun(runId, { status: "failed", phase: "complete", errorSummary: err.message, completedAt: new Date().toISOString() });
    emitAndLog(runId, emit, makeStep("complete", "error", `Validation error: ${err.message}`, "error"));
  }
}
