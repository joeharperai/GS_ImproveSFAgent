import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage";
import { undeployFromOrg } from "./metadata-deployer";
import type { MetadataComponent } from "@shared/schema";

const client = new Anthropic();

// Generate a context-aware change proposal
export async function generateChangeProposal(changeRequestId: number): Promise<void> {
  const cr = storage.getChangeRequest(changeRequestId);
  if (!cr) throw new Error("Change request not found");

  storage.updateChangeRequest(changeRequestId, { status: "analyzing", updatedAt: new Date().toISOString() });

  const org = storage.getOrg(cr.orgId);
  if (!org) throw new Error("Org not found");

  // Get the target component from inventory
  let originalCode = cr.originalCode || "";
  let componentContext = "";

  if (cr.targetComponentId) {
    const component = storage.getOrgInventoryItem(cr.targetComponentId);
    if (component) {
      originalCode = component.sourceCode || "";
      componentContext = `Component: [${component.category}] ${component.apiName}\nLabel: ${component.label}\nDescription: ${component.description || "N/A"}\n`;
      if (component.metadataJson) {
        componentContext += `Metadata: ${component.metadataJson}\n`;
      }
    }
  }

  // Save original for rollback
  storage.updateChangeRequest(changeRequestId, {
    originalCode,
    rollbackPackageJson: JSON.stringify({
      apiName: cr.targetApiName,
      type: cr.targetType,
      originalCode,
      timestamp: new Date().toISOString(),
    }),
  });

  // Impact analysis — find what references this component
  const allInventory = storage.getOrgInventory(cr.orgId);
  const referencedBy: string[] = [];
  const references: string[] = [];

  if (cr.targetApiName) {
    for (const item of allInventory) {
      if (item.id === cr.targetComponentId) continue;
      // Check if any other component's code references this one
      if (item.sourceCode && item.sourceCode.includes(cr.targetApiName)) {
        referencedBy.push(`${item.category}: ${item.apiName}`);
      }
      // Check if this component's code references other components
      if (originalCode && item.apiName && originalCode.includes(item.apiName)) {
        references.push(`${item.category}: ${item.apiName}`);
      }
    }
  }

  const impactAnalysis = {
    referencedBy,
    references,
    riskLevel: referencedBy.length > 5 ? "High" : referencedBy.length > 2 ? "Medium" : "Low",
    totalImpactedComponents: referencedBy.length,
  };

  storage.updateChangeRequest(changeRequestId, {
    impactAnalysisJson: JSON.stringify(impactAnalysis),
  });

  // Generate proposed changes using AI with full context
  try {
    const contextInventory = allInventory
      .filter(i => i.category === cr.targetType || references.some(r => r.includes(i.apiName)))
      .slice(0, 10)
      .map(i => `[${i.category}] ${i.apiName}: ${i.description || i.label}`)
      .join("\n");

    const prompt = `You are a Salesforce Technical Architect. A user wants to modify an existing component in their org.

${componentContext}

CURRENT CODE:
\`\`\`
${originalCode}
\`\`\`

REQUESTED CHANGE:
${cr.description}

RELATED COMPONENTS IN THIS ORG:
${contextInventory}

IMPACT: This component is referenced by ${referencedBy.length} other components: ${referencedBy.join(", ") || "none"}.

RULES:
- Make a TARGETED update — preserve existing logic, don't rewrite from scratch
- Bulkify all Apex (no SOQL/DML in loops)
- Use "with sharing" by default
- No hardcoded IDs
- Follow Salesforce Well-Architected Framework
- API version 60.0

Generate the COMPLETE updated code with the requested change applied. Return ONLY the updated code, no explanations or markdown fences.`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const content = message.content[0];
    if (content.type !== "text") throw new Error("Unexpected response type");

    const proposedCode = content.text.trim()
      .replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "");

    // Generate diff
    const diffHunks = generateDiff(originalCode, proposedCode);

    storage.updateChangeRequest(changeRequestId, {
      proposedCode,
      diffJson: JSON.stringify(diffHunks),
      status: "proposed",
      updatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    storage.updateChangeRequest(changeRequestId, {
      status: "draft",
      updatedAt: new Date().toISOString(),
    });
    throw error;
  }
}

// Simple line-by-line diff generator
function generateDiff(original: string, proposed: string): any[] {
  const origLines = original.split("\n");
  const propLines = proposed.split("\n");
  const hunks: any[] = [];

  const maxLen = Math.max(origLines.length, propLines.length);

  for (let i = 0; i < maxLen; i++) {
    const origLine = origLines[i];
    const propLine = propLines[i];

    if (origLine === undefined && propLine !== undefined) {
      hunks.push({ type: "add", content: propLine, lineNumber: i + 1 });
    } else if (propLine === undefined && origLine !== undefined) {
      hunks.push({ type: "remove", content: origLine, lineNumber: i + 1 });
    } else if (origLine !== propLine) {
      hunks.push({ type: "remove", content: origLine, lineNumber: i + 1 });
      hunks.push({ type: "add", content: propLine, lineNumber: i + 1 });
    } else {
      hunks.push({ type: "context", content: origLine, lineNumber: i + 1 });
    }
  }

  return hunks;
}

// Rollback a deployed change
export async function rollbackChange(changeRequestId: number): Promise<void> {
  const cr = storage.getChangeRequest(changeRequestId);
  if (!cr) throw new Error("Change request not found");

  // If the change was actually deployed and we have a connected org, attempt real rollback
  if ((cr.deployedToSandbox || cr.deployedToProduction) && cr.targetApiName && cr.targetType) {
    const orgId = cr.deployedToProduction ? cr.productionOrgId : cr.sandboxOrgId;
    const org = orgId ? storage.getOrg(orgId) : null;

    if (org && org.status === "connected" && org.accessToken) {
      // Build a minimal MetadataComponent for the destructive deploy
      const component: MetadataComponent = {
        id: 0,
        requirementId: 0,
        componentType: cr.targetType,
        apiName: cr.targetApiName,
        label: cr.targetApiName,
        metadataXml: cr.originalCode || "",
        status: "deployed",
        deploymentLog: null,
        createdAt: new Date().toISOString(),
      };

      // If we have original code, redeploy it (restore). Otherwise, use destructive deploy to remove.
      if (cr.originalCode) {
        // Restore the original code by deploying it back
        const { deployToOrg } = await import("./metadata-deployer");
        await deployToOrg(org, [component]);
      } else {
        // No original code = component was newly created, so remove it
        await undeployFromOrg(org, [component]);
      }
    }
  }

  storage.updateChangeRequest(changeRequestId, {
    status: "rolled_back",
    updatedAt: new Date().toISOString(),
  });
}
