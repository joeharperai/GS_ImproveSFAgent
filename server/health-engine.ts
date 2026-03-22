import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage";
import { fireWebhook } from "./webhook-service";
import type { OrgInventoryItem } from "@shared/schema";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) { _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }); }
  return _client;
}

interface HealthRuleFinding {
  componentApiName?: string;
  componentType?: string;
  description: string;
  recommendation: string;
  codeSnippet?: string;
}

interface HealthRule {
  id: string;
  category: "security" | "performance" | "maintainability" | "scalability";
  severity: "critical" | "warning" | "info";
  title: string;
  check: (inventory: OrgInventoryItem[], allItems: OrgInventoryItem[]) => HealthRuleFinding[];
}

// ========== RULES ==========

const rules: HealthRule[] = [
  // ====== SECURITY ======
  {
    id: "SEC-001",
    category: "security",
    severity: "critical",
    title: "Profiles with excessive permissions",
    check: (inv) => {
      const profiles = inv.filter(i => i.category === "Profile");
      return profiles
        .filter(p => p.apiName !== "System_Administrator" && p.apiName !== "Admin")
        .filter(p => {
          const meta = p.metadataJson ? JSON.parse(p.metadataJson) : {};
          return meta.modifyAllData || meta.viewAllData;
        })
        .map(p => ({
          componentApiName: p.apiName,
          componentType: "Profile",
          description: `Profile "${p.label}" may have excessive permissions (Modify All Data / View All Data).`,
          recommendation: "Review and restrict permissions. Only System Administrator should have Modify All Data.",
        }));
    },
  },
  {
    id: "SEC-002",
    category: "security",
    severity: "info",
    title: "Custom fields without explicit FLS review",
    check: (inv) => {
      const fields = inv.filter(i => i.category === "CustomField");
      if (fields.length > 50) {
        return [{
          description: `${fields.length} custom fields found. Ensure Field-Level Security is properly configured for all sensitive fields.`,
          recommendation: "Audit FLS settings on all custom fields, especially those containing PII or financial data.",
        }];
      }
      return [];
    },
  },
  {
    id: "SEC-003",
    category: "security",
    severity: "warning",
    title: "No sharing rules detected",
    check: (inv) => {
      const permSets = inv.filter(i => i.category === "PermissionSet");
      const profiles = inv.filter(i => i.category === "Profile");
      if (permSets.length + profiles.length > 0 && inv.filter(i => i.category === "SharingRule").length === 0) {
        return [{
          description: "No sharing rules were detected in the org inventory. Data access may rely solely on org-wide defaults.",
          recommendation: "Review OWD settings and implement sharing rules for proper data segmentation between teams/roles.",
        }];
      }
      return [];
    },
  },
  {
    id: "SEC-004",
    category: "security",
    severity: "critical",
    title: "Apex classes without 'with sharing'",
    check: (inv) => {
      return inv
        .filter(i => i.category === "ApexClass" && i.sourceCode)
        .filter(cls => {
          const code = cls.sourceCode!;
          const hasClass = /\bclass\s+\w+/.test(code);
          const hasWithSharing = /\bwith\s+sharing\b/i.test(code);
          const hasWithoutSharing = /\bwithout\s+sharing\b/i.test(code);
          const hasInheritedSharing = /\binherited\s+sharing\b/i.test(code);
          return hasClass && !hasWithSharing && !hasWithoutSharing && !hasInheritedSharing;
        })
        .map(cls => ({
          componentApiName: cls.apiName,
          componentType: "ApexClass",
          description: `Apex class "${cls.apiName}" does not declare a sharing model (with sharing / without sharing / inherited sharing).`,
          recommendation: "Add 'with sharing' by default. Only use 'without sharing' when explicitly needed with documented justification.",
          codeSnippet: cls.sourceCode?.substring(0, 200),
        }));
    },
  },
  {
    id: "SEC-005",
    category: "security",
    severity: "critical",
    title: "Hardcoded Salesforce IDs in Apex",
    check: (inv) => {
      const idPattern = /['"][a-zA-Z0-9]{15}['"]|['"][a-zA-Z0-9]{18}['"]/g;
      const sfIdPattern = /['"]([0-9a-zA-Z]{15,18})['"]/g;
      return inv
        .filter(i => (i.category === "ApexClass" || i.category === "ApexTrigger") && i.sourceCode)
        .flatMap(cls => {
          const matches = cls.sourceCode!.match(sfIdPattern) || [];
          const sfIds = matches.filter(m => {
            const id = m.replace(/['"]/g, "");
            return /^[a-zA-Z0-9]{15}$/.test(id) || /^[a-zA-Z0-9]{18}$/.test(id);
          }).filter(m => {
            const id = m.replace(/['"]/g, "");
            // Filter to likely SF IDs (start with known key prefixes)
            return /^(001|003|005|006|00D|00G|00e|01I|01p|012|0RF)/.test(id);
          });
          if (sfIds.length > 0) {
            return [{
              componentApiName: cls.apiName,
              componentType: cls.category,
              description: `Found ${sfIds.length} hardcoded Salesforce ID(s) in "${cls.apiName}".`,
              recommendation: "Replace hardcoded IDs with Custom Metadata Types, Custom Settings, or Custom Labels for environment portability.",
              codeSnippet: sfIds.slice(0, 3).join(", "),
            }];
          }
          return [];
        });
    },
  },
  {
    id: "SEC-006",
    category: "security",
    severity: "warning",
    title: "Overly permissive permission set count",
    check: (inv) => {
      const permSets = inv.filter(i => i.category === "PermissionSet");
      if (permSets.length > 20) {
        return [{
          description: `${permSets.length} permission sets found. A high number may indicate permission sprawl and difficulty in auditing access.`,
          recommendation: "Consolidate permission sets. Use permission set groups to organize related permissions.",
        }];
      }
      return [];
    },
  },
  {
    id: "SEC-007",
    category: "security",
    severity: "info",
    title: "No custom permission sets",
    check: (inv) => {
      const permSets = inv.filter(i => i.category === "PermissionSet");
      if (permSets.length === 0) {
        const profiles = inv.filter(i => i.category === "Profile");
        if (profiles.length > 0) {
          return [{
            description: "No custom permission sets found — access control relies entirely on profiles.",
            recommendation: "Implement permission sets for granular access control. Salesforce recommends permission sets over profile-based permissions.",
          }];
        }
      }
      return [];
    },
  },

  // ====== PERFORMANCE ======
  {
    id: "PERF-001",
    category: "performance",
    severity: "critical",
    title: "SOQL inside loops",
    check: (inv) => {
      return inv
        .filter(i => (i.category === "ApexClass" || i.category === "ApexTrigger") && i.sourceCode)
        .filter(cls => {
          const code = cls.sourceCode!;
          return /for\s*\([^)]*\)\s*\{[^}]*\[SELECT\b/is.test(code) ||
                 /for\s*\([^)]*\)\s*\{[^}]*Database\.query/is.test(code) ||
                 /while\s*\([^)]*\)\s*\{[^}]*\[SELECT\b/is.test(code);
        })
        .map(cls => ({
          componentApiName: cls.apiName,
          componentType: cls.category,
          description: `Potential SOQL query inside a loop detected in "${cls.apiName}". This can hit the 100 SOQL query governor limit.`,
          recommendation: "Move SOQL queries outside loops. Collect IDs first, then query in bulk using IN clause.",
          codeSnippet: extractLoopWithQuery(cls.sourceCode!, "SELECT"),
        }));
    },
  },
  {
    id: "PERF-002",
    category: "performance",
    severity: "critical",
    title: "DML inside loops",
    check: (inv) => {
      const dmlPattern = /for\s*\([^)]*\)\s*\{[^}]*(insert|update|delete|upsert)\s+/is;
      return inv
        .filter(i => (i.category === "ApexClass" || i.category === "ApexTrigger") && i.sourceCode)
        .filter(cls => dmlPattern.test(cls.sourceCode!))
        .map(cls => ({
          componentApiName: cls.apiName,
          componentType: cls.category,
          description: `Potential DML operation inside a loop detected in "${cls.apiName}". This can hit the 150 DML statement governor limit.`,
          recommendation: "Collect records in a List, then perform a single DML operation outside the loop.",
          codeSnippet: extractLoopWithQuery(cls.sourceCode!, "insert|update|delete|upsert"),
        }));
    },
  },
  {
    id: "PERF-003",
    category: "performance",
    severity: "warning",
    title: "Non-bulkified triggers",
    check: (inv) => {
      return inv
        .filter(i => i.category === "ApexTrigger" && i.sourceCode)
        .filter(trig => {
          const code = trig.sourceCode!;
          const usesBulk = /List<|Set<|Map<|Trigger\.new|Trigger\.old/i.test(code);
          return !usesBulk;
        })
        .map(trig => ({
          componentApiName: trig.apiName,
          componentType: "ApexTrigger",
          description: `Trigger "${trig.apiName}" may not be properly bulkified — no List/Set/Map or Trigger.new/old patterns detected.`,
          recommendation: "Ensure trigger processes all records in Trigger.new/old collections, not just single records.",
        }));
    },
  },
  {
    id: "PERF-004",
    category: "performance",
    severity: "warning",
    title: "Excessive number of Flows",
    check: (inv) => {
      const flows = inv.filter(i => i.category === "Flow");
      if (flows.length > 50) {
        return [{
          description: `${flows.length} active Flows detected. A high number of Flows can impact org performance and create order-of-execution complexity.`,
          recommendation: "Review and consolidate Flows. Remove obsolete Flows and combine related automations where possible.",
        }];
      }
      return [];
    },
  },
  {
    id: "PERF-005",
    category: "performance",
    severity: "warning",
    title: "Apex classes using single record operations",
    check: (inv) => {
      return inv
        .filter(i => i.category === "ApexClass" && i.sourceCode)
        .filter(cls => {
          const code = cls.sourceCode!;
          // Detect patterns like insert singleRecord; update singleRecord; (without List)
          return /\b(insert|update|upsert|delete)\s+[a-z]\w+\s*;/i.test(code) &&
                 !/(insert|update|upsert|delete)\s+\w*[Ll]ist/i.test(code);
        })
        .slice(0, 10)
        .map(cls => ({
          componentApiName: cls.apiName,
          componentType: "ApexClass",
          description: `Apex class "${cls.apiName}" appears to perform DML on single records instead of collections.`,
          recommendation: "Use List<SObject> for DML operations to support bulk processing.",
        }));
    },
  },
  {
    id: "PERF-006",
    category: "performance",
    severity: "info",
    title: "High-field objects without indexed fields",
    check: (inv) => {
      const objects = inv.filter(i => i.category === "CustomObject");
      const fields = inv.filter(i => i.category === "CustomField");
      return objects
        .filter(obj => {
          const objFields = fields.filter(f => f.parentApiName === obj.apiName);
          const hasIndex = objFields.some(f => {
            const meta = f.metadataJson ? JSON.parse(f.metadataJson) : {};
            return meta.externalId || meta.unique;
          });
          return objFields.length > 30 && !hasIndex;
        })
        .map(obj => ({
          componentApiName: obj.apiName,
          componentType: "CustomObject",
          description: `Custom object "${obj.label}" has many fields but no indexed (External ID / Unique) fields detected.`,
          recommendation: "Add External ID or Unique fields for frequently queried fields to improve SOQL performance.",
        }));
    },
  },
  {
    id: "PERF-007",
    category: "performance",
    severity: "warning",
    title: "Nested SOQL queries",
    check: (inv) => {
      return inv
        .filter(i => (i.category === "ApexClass" || i.category === "ApexTrigger") && i.sourceCode)
        .filter(cls => {
          // Detect [SELECT ... (SELECT ... FROM ...) FROM ...]
          return /\[SELECT[^]]*\(SELECT[^)]*\)[^]]*\]/is.test(cls.sourceCode!);
        })
        .map(cls => ({
          componentApiName: cls.apiName,
          componentType: cls.category,
          description: `Nested SOQL query (subquery) detected in "${cls.apiName}". Subqueries can be expensive and count toward governor limits.`,
          recommendation: "Consider separate queries with Maps for relationship traversal to improve readability and control.",
        }));
    },
  },

  // ====== MAINTAINABILITY ======
  {
    id: "MAINT-001",
    category: "maintainability",
    severity: "warning",
    title: "Process Builders detected (being retired)",
    check: (inv) => {
      const pbs = inv.filter(i => i.category === "ProcessBuilder");
      if (pbs.length > 0) {
        return pbs.map(pb => ({
          componentApiName: pb.apiName,
          componentType: "ProcessBuilder",
          description: `Process Builder "${pb.label}" should be migrated to a Flow. Process Builder is being retired by Salesforce.`,
          recommendation: "Use the Migrate to Flow tool in Setup to convert this Process Builder to a Flow.",
        }));
      }
      return [];
    },
  },
  {
    id: "MAINT-002",
    category: "maintainability",
    severity: "warning",
    title: "Hardcoded values in code",
    check: (inv) => {
      return inv
        .filter(i => (i.category === "ApexClass" || i.category === "ApexTrigger") && i.sourceCode)
        .filter(cls => {
          const code = cls.sourceCode!;
          // Check for hardcoded URLs, email domains, etc.
          return /https?:\/\/[a-z0-9]+\.salesforce\.com/i.test(code) ||
                 /https?:\/\/[a-z0-9]+\.force\.com/i.test(code);
        })
        .map(cls => ({
          componentApiName: cls.apiName,
          componentType: cls.category,
          description: `Hardcoded Salesforce URLs detected in "${cls.apiName}". This will break across environments.`,
          recommendation: "Use URL.getOrgDomainUrl() or Custom Settings to store environment-specific URLs.",
        }));
    },
  },
  {
    id: "MAINT-003",
    category: "maintainability",
    severity: "critical",
    title: "No test classes detected",
    check: (inv) => {
      const classes = inv.filter(i => i.category === "ApexClass");
      const testClasses = classes.filter(c =>
        /test/i.test(c.apiName) || (c.sourceCode && /@isTest/i.test(c.sourceCode))
      );
      if (classes.length > 0 && testClasses.length === 0) {
        return [{
          description: "No Apex test classes detected in the org. Salesforce requires 75% code coverage for production deployments.",
          recommendation: "Create comprehensive test classes for all Apex code. Follow Salesforce testing best practices.",
        }];
      }
      return [];
    },
  },
  {
    id: "MAINT-004",
    category: "maintainability",
    severity: "warning",
    title: "Low test coverage indication",
    check: (inv) => {
      const classes = inv.filter(i => i.category === "ApexClass");
      const testClasses = classes.filter(c =>
        /test/i.test(c.apiName) || (c.sourceCode && /@isTest/i.test(c.sourceCode))
      );
      const nonTestClasses = classes.filter(c =>
        !/test/i.test(c.apiName) && !(c.sourceCode && /@isTest/i.test(c.sourceCode))
      );
      if (nonTestClasses.length > 0 && testClasses.length > 0) {
        const ratio = testClasses.length / nonTestClasses.length;
        if (ratio < 0.3) {
          return [{
            description: `Only ${testClasses.length} test classes for ${nonTestClasses.length} non-test classes (${Math.round(ratio * 100)}% ratio). Test coverage may be insufficient.`,
            recommendation: "Aim for at least 1 test class per 2-3 production classes. Focus on positive, negative, and bulk test scenarios.",
          }];
        }
      }
      return [];
    },
  },
  {
    id: "MAINT-005",
    category: "maintainability",
    severity: "warning",
    title: "Deprecated API versions",
    check: (inv) => {
      return inv
        .filter(i => (i.category === "ApexClass" || i.category === "ApexTrigger" || i.category === "LWC") && i.metadataJson)
        .filter(cls => {
          const meta = JSON.parse(cls.metadataJson!);
          const version = parseFloat(meta.apiVersion || "60");
          return version < 55;
        })
        .map(cls => {
          const meta = JSON.parse(cls.metadataJson!);
          return {
            componentApiName: cls.apiName,
            componentType: cls.category,
            description: `"${cls.apiName}" uses API version ${meta.apiVersion} which is below v55.0. Old API versions may miss security patches and features.`,
            recommendation: "Update to API version 60.0 or later. Test thoroughly after upgrading.",
          };
        });
    },
  },
  {
    id: "MAINT-006",
    category: "maintainability",
    severity: "warning",
    title: "Multiple triggers per object",
    check: (inv) => {
      const triggers = inv.filter(i => i.category === "ApexTrigger" && i.parentApiName);
      const byObject = new Map<string, string[]>();
      for (const t of triggers) {
        const obj = t.parentApiName!;
        if (!byObject.has(obj)) byObject.set(obj, []);
        byObject.get(obj)!.push(t.apiName);
      }
      const findings: HealthRuleFinding[] = [];
      for (const [obj, trigs] of byObject) {
        if (trigs.length > 1) {
          findings.push({
            componentApiName: obj,
            componentType: "CustomObject",
            description: `Object "${obj}" has ${trigs.length} triggers: ${trigs.join(", ")}. Execution order is non-deterministic.`,
            recommendation: "Consolidate into a single trigger per object using the Handler pattern (one trigger delegating to a handler class).",
          });
        }
      }
      return findings;
    },
  },
  {
    id: "MAINT-007",
    category: "maintainability",
    severity: "info",
    title: "Custom objects without descriptions",
    check: (inv) => {
      const undescribed = inv.filter(i => i.category === "CustomObject" && !i.description);
      if (undescribed.length > 5) {
        return [{
          description: `${undescribed.length} custom objects have no description. This makes it harder for new team members to understand the data model.`,
          recommendation: "Add meaningful descriptions to all custom objects explaining their business purpose.",
        }];
      }
      return [];
    },
  },
  {
    id: "MAINT-008",
    category: "maintainability",
    severity: "info",
    title: "Possible stub/unused Apex classes",
    check: (inv) => {
      return inv
        .filter(i => i.category === "ApexClass" && i.sourceCode)
        .filter(cls => {
          const code = cls.sourceCode!.trim();
          return code.length < 50 && !/test/i.test(cls.apiName);
        })
        .map(cls => ({
          componentApiName: cls.apiName,
          componentType: "ApexClass",
          description: `Apex class "${cls.apiName}" has very little code (< 50 characters) and may be an unused stub.`,
          recommendation: "Review and remove unused classes to reduce maintenance burden and deployment complexity.",
        }));
    },
  },
  {
    id: "MAINT-009",
    category: "maintainability",
    severity: "warning",
    title: "Workflow Rules detected (being retired)",
    check: (inv) => {
      const wfs = inv.filter(i => i.category === "WorkflowRule" || (i.metadataJson && i.metadataJson.includes('"processType":"Workflow"')));
      if (wfs.length > 0) {
        return [{
          description: `${wfs.length} Workflow Rule(s) detected. Workflow Rules are being retired by Salesforce in favor of Flows.`,
          recommendation: "Migrate all Workflow Rules to Record-Triggered Flows using the Migrate to Flow tool in Setup.",
        }];
      }
      return [];
    },
  },
  {
    id: "MAINT-010",
    category: "maintainability",
    severity: "warning",
    title: "Excessive validation rules",
    check: (inv) => {
      const validations = inv.filter(i => i.category === "ValidationRule");
      if (validations.length > 20) {
        const byObject = new Map<string, number>();
        for (const vr of validations) {
          const obj = vr.parentApiName || "Unknown";
          byObject.set(obj, (byObject.get(obj) || 0) + 1);
        }
        const findings: HealthRuleFinding[] = [];
        for (const [obj, count] of byObject) {
          if (count > 10) {
            findings.push({
              componentApiName: obj,
              componentType: "CustomObject",
              description: `Object "${obj}" has ${count} active validation rules. This can impact data import performance and user experience.`,
              recommendation: "Consolidate related validation rules. Consider using Apex validation for complex logic.",
            });
          }
        }
        if (findings.length === 0) {
          findings.push({
            description: `${validations.length} total validation rules detected across all objects.`,
            recommendation: "Review validation rules periodically. Consolidate where possible to reduce complexity.",
          });
        }
        return findings;
      }
      return [];
    },
  },

  // ====== SCALABILITY ======
  {
    id: "SCALE-001",
    category: "scalability",
    severity: "warning",
    title: "Objects with too many custom fields",
    check: (inv) => {
      const objects = inv.filter(i => i.category === "CustomObject");
      const fields = inv.filter(i => i.category === "CustomField");
      return objects
        .filter(obj => {
          const count = fields.filter(f => f.parentApiName === obj.apiName).length;
          return count > 100;
        })
        .map(obj => {
          const count = fields.filter(f => f.parentApiName === obj.apiName).length;
          return {
            componentApiName: obj.apiName,
            componentType: "CustomObject",
            description: `Custom object "${obj.label}" has ${count} custom fields, exceeding 100. This approaches the 500 field limit.`,
            recommendation: "Review field usage. Archive unused fields and consider child objects for related data groups.",
          };
        });
    },
  },
  {
    id: "SCALE-002",
    category: "scalability",
    severity: "warning",
    title: "Too many custom objects",
    check: (inv) => {
      const objects = inv.filter(i => i.category === "CustomObject");
      if (objects.length > 200) {
        return [{
          description: `${objects.length} custom objects detected. This is a high number that may indicate data model complexity issues.`,
          recommendation: "Audit custom objects for redundancy. Consider using Big Objects for archival data and reducing the object count.",
        }];
      }
      return [];
    },
  },
  {
    id: "SCALE-003",
    category: "scalability",
    severity: "info",
    title: "Complex object relationships",
    check: (inv) => {
      const fields = inv.filter(i => i.category === "CustomField" && i.metadataJson);
      const lookupsByObject = new Map<string, number>();
      for (const f of fields) {
        const meta = JSON.parse(f.metadataJson!);
        if (meta.type === "Lookup" || meta.type === "MasterDetail" || meta.type === "reference") {
          const obj = f.parentApiName || "Unknown";
          lookupsByObject.set(obj, (lookupsByObject.get(obj) || 0) + 1);
        }
      }
      const findings: HealthRuleFinding[] = [];
      for (const [obj, count] of lookupsByObject) {
        if (count > 10) {
          findings.push({
            componentApiName: obj,
            componentType: "CustomObject",
            description: `Object "${obj}" has ${count} relationship fields. Complex relationships can impact query performance and SOQL join limits.`,
            recommendation: "Review relationship necessity. Consider junction objects or denormalization for frequently accessed data.",
          });
        }
      }
      return findings;
    },
  },
  {
    id: "SCALE-004",
    category: "scalability",
    severity: "critical",
    title: "Governor limit risk patterns",
    check: (inv) => {
      const findings: HealthRuleFinding[] = [];
      const code = inv.filter(i => (i.category === "ApexClass" || i.category === "ApexTrigger") && i.sourceCode);
      for (const cls of code) {
        const src = cls.sourceCode!;
        // Detect Limits.getQueries approaching limit
        if (/Limits\.getQueries/i.test(src) || /Limits\.getDml/i.test(src)) {
          // This is actually good — they're checking limits. Skip.
          continue;
        }
        // Count SOQL statements
        const soqlCount = (src.match(/\[SELECT\b/gi) || []).length;
        if (soqlCount > 10) {
          findings.push({
            componentApiName: cls.apiName,
            componentType: cls.category,
            description: `"${cls.apiName}" contains ${soqlCount} SOQL queries. Multiple queries in a single execution context risk hitting the 100 SOQL limit.`,
            recommendation: "Consolidate queries. Use Maps and collections to reduce total SOQL calls per transaction.",
          });
        }
      }
      return findings.slice(0, 10);
    },
  },
  {
    id: "SCALE-005",
    category: "scalability",
    severity: "warning",
    title: "Large Apex classes",
    check: (inv) => {
      return inv
        .filter(i => i.category === "ApexClass" && i.sourceCode)
        .filter(cls => {
          const lines = cls.sourceCode!.split("\n").length;
          return lines > 500;
        })
        .map(cls => ({
          componentApiName: cls.apiName,
          componentType: "ApexClass",
          description: `Apex class "${cls.apiName}" has ${cls.sourceCode!.split("\n").length} lines. Large classes are difficult to maintain and test.`,
          recommendation: "Refactor into smaller, focused classes following Single Responsibility Principle. Extract utility methods into helper classes.",
        }));
    },
  },
  {
    id: "SCALE-006",
    category: "scalability",
    severity: "warning",
    title: "Too many installed packages",
    check: (inv) => {
      const packages = inv.filter(i => i.category === "InstalledPackage");
      if (packages.length > 20) {
        return [{
          description: `${packages.length} installed packages detected. A high number increases namespace conflicts, API version dependencies, and deployment complexity.`,
          recommendation: "Audit installed packages. Remove unused packages and consolidate where possible.",
        }];
      }
      return [];
    },
  },
];

// ========== HELPERS ==========

function extractLoopWithQuery(code: string, keyword: string): string | undefined {
  const pattern = new RegExp(`(for|while)\\s*\\([^)]*\\)\\s*\\{[^}]*?(${keyword})`, "is");
  const match = code.match(pattern);
  if (match) {
    const idx = match.index || 0;
    return code.substring(idx, Math.min(idx + 200, code.length)).trim();
  }
  return undefined;
}

function scoreToGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function computeComplexity(inventory: OrgInventoryItem[]): { score: string; summary: string } {
  const objects = inventory.filter(i => i.category === "CustomObject").length;
  const fields = inventory.filter(i => i.category === "CustomField").length;
  const apex = inventory.filter(i => i.category === "ApexClass").length;
  const flows = inventory.filter(i => i.category === "Flow" || i.category === "ProcessBuilder").length;
  const triggers = inventory.filter(i => i.category === "ApexTrigger").length;
  const total = objects + fields + apex + flows + triggers;

  let score: string;
  if (total < 100) score = "Low";
  else if (total < 500) score = "Moderate";
  else if (total < 1000) score = "High";
  else if (total < 2000) score = "Very High";
  else score = "Extreme";

  const summary = `This org has ${objects} custom objects, ${fields} custom fields, ${apex} Apex classes, ${flows} Flows, and ${triggers} triggers. Complexity: ${score} (${total} total components).`;
  return { score, summary };
}

// ========== MAIN FUNCTION ==========

export async function executeHealthAssessment(
  assessmentId: number,
  orgId: number,
  onProgress: (msg: string) => void
): Promise<void> {
  storage.updateHealthAssessment(assessmentId, { status: "running" });
  onProgress("Starting health assessment...");

  const inventory = storage.getOrgInventory(orgId);
  if (inventory.length === 0) {
    storage.updateHealthAssessment(assessmentId, {
      status: "failed",
      completedAt: new Date().toISOString(),
    });
    return;
  }

  // Clear previous findings for this assessment
  storage.deleteHealthFindings(assessmentId);

  try {
    // ========== Run all rules ==========
    onProgress("Running best practice rules...");
    const categoryScores: Record<string, number> = {
      security: 100,
      performance: 100,
      maintainability: 100,
      scalability: 100,
    };
    let criticalCount = 0;
    let warningCount = 0;
    let infoCount = 0;

    for (const rule of rules) {
      const findings = rule.check(inventory, inventory);
      for (const finding of findings) {
        storage.createHealthFinding({
          assessmentId,
          category: rule.category,
          severity: rule.severity,
          ruleId: rule.id,
          title: rule.title,
          description: finding.description,
          componentApiName: finding.componentApiName || null,
          componentType: finding.componentType || null,
          recommendation: finding.recommendation,
          codeSnippet: finding.codeSnippet || null,
        });

        if (rule.severity === "critical") {
          categoryScores[rule.category] -= 15;
          criticalCount++;
        } else if (rule.severity === "warning") {
          categoryScores[rule.category] -= 7;
          warningCount++;
        } else {
          categoryScores[rule.category] -= 2;
          infoCount++;
        }
      }
    }

    // Cap scores at 0
    for (const cat of Object.keys(categoryScores)) {
      categoryScores[cat] = Math.max(0, categoryScores[cat]);
    }

    // ========== AI Code Analysis ==========
    onProgress("Running AI code analysis...");
    try {
      const codeComponents = inventory
        .filter(i => (i.category === "ApexClass" || i.category === "ApexTrigger") && i.sourceCode && i.sourceCode.length > 100)
        .slice(0, 10);

      if (codeComponents.length > 0) {
        const codeSnippets = codeComponents.map((c, idx) =>
          `${idx + 1}. [${c.category}] ${c.apiName}\n${c.sourceCode!.substring(0, 1500)}`
        ).join("\n\n---\n\n");

        const message = await getClient().messages.create({
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 2048,
          messages: [{
            role: "user",
            content: `You are a Salesforce code quality reviewer. Analyze these Apex code snippets for anti-patterns, security issues, and performance problems.

${codeSnippets}

For each issue found, respond with JSON only (no markdown):
{"issues": [{"componentName": "ClassName", "severity": "critical|warning|info", "category": "security|performance|maintainability|scalability", "title": "Short title", "description": "What the issue is", "recommendation": "How to fix it", "codeSnippet": "relevant code line if applicable"}]}

Only flag significant issues. Return empty issues array if code looks clean.`
          }],
        });

        const content = message.content[0];
        if (content.type === "text") {
          let parsed: any;
          try {
            parsed = JSON.parse(content.text);
          } catch {
            const jsonMatch = content.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
          }

          if (parsed?.issues) {
            for (const issue of parsed.issues) {
              const cat = issue.category as string;
              const sev = issue.severity as string;
              if (!["security", "performance", "maintainability", "scalability"].includes(cat)) continue;
              if (!["critical", "warning", "info"].includes(sev)) continue;

              storage.createHealthFinding({
                assessmentId,
                category: cat,
                severity: sev,
                ruleId: "AI-001",
                title: issue.title || "AI-detected issue",
                description: issue.description || "",
                componentApiName: issue.componentName || null,
                componentType: "ApexClass",
                recommendation: issue.recommendation || "Review and fix the identified issue.",
                codeSnippet: issue.codeSnippet || null,
              });

              if (sev === "critical") { categoryScores[cat] -= 15; criticalCount++; }
              else if (sev === "warning") { categoryScores[cat] -= 7; warningCount++; }
              else { categoryScores[cat] -= 2; infoCount++; }
            }
          }
        }
      }
    } catch (_e) {
      // AI analysis is optional — continue if it fails
    }

    // Re-cap scores after AI findings
    for (const cat of Object.keys(categoryScores)) {
      categoryScores[cat] = Math.max(0, categoryScores[cat]);
    }

    // ========== Compute scores ==========
    onProgress("Computing scores...");
    const securityScore = categoryScores.security;
    const performanceScore = categoryScores.performance;
    const maintainabilityScore = categoryScores.maintainability;
    const scalabilityScore = categoryScores.scalability;

    const overallScore = Math.round(
      securityScore * 0.30 +
      performanceScore * 0.25 +
      maintainabilityScore * 0.25 +
      scalabilityScore * 0.20
    );
    const overallGrade = scoreToGrade(overallScore);

    // ========== Complexity ==========
    const complexity = computeComplexity(inventory);
    const totalFindings = criticalCount + warningCount + infoCount;

    // ========== Save results ==========
    storage.updateHealthAssessment(assessmentId, {
      status: "completed",
      overallGrade,
      overallScore,
      securityScore,
      performanceScore,
      maintainabilityScore,
      scalabilityScore,
      totalFindings,
      criticalCount,
      warningCount,
      infoCount,
      complexityScore: complexity.score,
      complexitySummary: complexity.summary,
      completedAt: new Date().toISOString(),
    });

    const org = storage.getOrg(orgId);
    fireWebhook("health_assessment", {
      orgName: org?.name,
      overallGrade,
      overallScore,
      totalFindings,
      criticalCount,
    });

    onProgress(`Assessment complete: Grade ${overallGrade} (${overallScore}/100), ${totalFindings} findings`);

  } catch (error: any) {
    storage.updateHealthAssessment(assessmentId, {
      status: "failed",
      completedAt: new Date().toISOString(),
    });
    onProgress(`Assessment failed: ${error.message}`);
  }
}
