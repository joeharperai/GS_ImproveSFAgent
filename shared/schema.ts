import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Customers — groups related Salesforce orgs together
export const customers = sqliteTable("customers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  industry: text("industry"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true });
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customers.$inferSelect;

// Salesforce org connections
export const sfOrgs = sqliteTable("sf_orgs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  instanceUrl: text("instance_url").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  clientId: text("client_id"),
  clientSecret: text("client_secret"),
  customerId: integer("customer_id"),
  accessMode: text("access_mode").notNull().default("read_only"), // read_only | read_write
  orgType: text("org_type").notNull().default("sandbox"), // sandbox | production | developer
  orgEdition: text("org_edition"), // Enterprise Edition, Professional Edition, Developer Edition, etc.
  status: text("status").notNull().default("disconnected"), // connected | disconnected | error
  connectedAt: text("connected_at"),
});

export const insertSfOrgSchema = createInsertSchema(sfOrgs).omit({ id: true });
export type InsertSfOrg = z.infer<typeof insertSfOrgSchema>;
export type SfOrg = typeof sfOrgs.$inferSelect;

// Deployment requirements
export const requirements = sqliteTable("requirements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull().default("declarative"),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("draft"),
  orgId: integer("org_id"),
  createdAt: text("created_at").notNull(),
});

export const insertRequirementSchema = createInsertSchema(requirements).omit({ id: true });
export type InsertRequirement = z.infer<typeof insertRequirementSchema>;
export type Requirement = typeof requirements.$inferSelect;

// AI analysis results
export const analyses = sqliteTable("analyses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  requirementId: integer("requirement_id").notNull(),
  summary: text("summary").notNull(),
  componentsJson: text("components_json").notNull(),
  dependenciesJson: text("dependencies_json").notNull(),
  bestPracticesJson: text("best_practices_json").notNull(),
  risksJson: text("risks_json").notNull(),
  estimatedEffort: text("estimated_effort"),
  createdAt: text("created_at").notNull(),
});

export const insertAnalysisSchema = createInsertSchema(analyses).omit({ id: true });
export type InsertAnalysis = z.infer<typeof insertAnalysisSchema>;
export type Analysis = typeof analyses.$inferSelect;

// Generated metadata components
export const metadataComponents = sqliteTable("metadata_components", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  requirementId: integer("requirement_id").notNull(),
  componentType: text("component_type").notNull(),
  apiName: text("api_name").notNull(),
  label: text("label").notNull(),
  metadataXml: text("metadata_xml").notNull(),
  status: text("status").notNull().default("pending"),
  deploymentLog: text("deployment_log"),
  createdAt: text("created_at").notNull(),
});

export const insertMetadataComponentSchema = createInsertSchema(metadataComponents).omit({ id: true });
export type InsertMetadataComponent = z.infer<typeof insertMetadataComponentSchema>;
export type MetadataComponent = typeof metadataComponents.$inferSelect;

// Deployment history
export const deployments = sqliteTable("deployments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  requirementId: integer("requirement_id").notNull(),
  orgId: integer("org_id").notNull(),
  status: text("status").notNull().default("pending"),
  componentsJson: text("components_json").notNull(),
  logJson: text("log_json").notNull(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
});

export const insertDeploymentSchema = createInsertSchema(deployments).omit({ id: true });
export type InsertDeployment = z.infer<typeof insertDeploymentSchema>;
export type Deployment = typeof deployments.$inferSelect;

// Agent execution runs — tracks the full agentic loop
export const agentRuns = sqliteTable("agent_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  requirementId: integer("requirement_id").notNull(),
  orgId: integer("org_id"),
  status: text("status").notNull().default("pending"), // pending | running | success | failed | cancelled
  phase: text("phase").notNull().default("init"), // init | architect_review | analyzing | generating | deploying | testing | fixing | complete
  stepsJson: text("steps_json").notNull().default("[]"), // JSON array of step logs
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  errorSummary: text("error_summary"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
});

export const insertAgentRunSchema = createInsertSchema(agentRuns).omit({ id: true });
export type InsertAgentRun = z.infer<typeof insertAgentRunSchema>;
export type AgentRun = typeof agentRuns.$inferSelect;

// Org discovery scans — tracks each metadata discovery run
export const orgScans = sqliteTable("org_scans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id").notNull(),
  status: text("status").notNull().default("pending"), // pending | running | completed | failed
  totalComponents: integer("total_components").default(0),
  describedComponents: integer("described_components").default(0),
  cloudsDetectedJson: text("clouds_detected_json").default("[]"),
  packagesJson: text("packages_json").default("[]"),
  errorLog: text("error_log"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
});

export const insertOrgScanSchema = createInsertSchema(orgScans).omit({ id: true });
export type InsertOrgScan = z.infer<typeof insertOrgScanSchema>;
export type OrgScan = typeof orgScans.$inferSelect;

// Org inventory — discovered metadata components from Salesforce orgs
export const orgInventory = sqliteTable("org_inventory", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id").notNull(),
  category: text("category").notNull(),
  apiName: text("api_name").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  sourceCode: text("source_code"),
  metadataJson: text("metadata_json"),
  parentApiName: text("parent_api_name"),
  status: text("status").notNull().default("discovered"),
  discoveredAt: text("discovered_at").notNull(),
});

export const insertOrgInventoryItemSchema = createInsertSchema(orgInventory).omit({ id: true });
export type InsertOrgInventoryItem = z.infer<typeof insertOrgInventoryItemSchema>;
export type OrgInventoryItem = typeof orgInventory.$inferSelect;

// Health assessments — org-level health scores and grades
export const healthAssessments = sqliteTable("health_assessments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id").notNull(),
  overallGrade: text("overall_grade").notNull().default("N/A"),
  overallScore: integer("overall_score").notNull().default(0),
  securityScore: integer("security_score").notNull().default(0),
  performanceScore: integer("performance_score").notNull().default(0),
  maintainabilityScore: integer("maintainability_score").notNull().default(0),
  scalabilityScore: integer("scalability_score").notNull().default(0),
  totalFindings: integer("total_findings").notNull().default(0),
  criticalCount: integer("critical_count").notNull().default(0),
  warningCount: integer("warning_count").notNull().default(0),
  infoCount: integer("info_count").notNull().default(0),
  complexityScore: text("complexity_score").default("Low"),
  complexitySummary: text("complexity_summary"),
  status: text("status").notNull().default("pending"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
});

export const insertHealthAssessmentSchema = createInsertSchema(healthAssessments).omit({ id: true });
export type InsertHealthAssessment = z.infer<typeof insertHealthAssessmentSchema>;
export type HealthAssessment = typeof healthAssessments.$inferSelect;

// Health findings — individual rule violations
export const healthFindings = sqliteTable("health_findings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  assessmentId: integer("assessment_id").notNull(),
  category: text("category").notNull(),
  severity: text("severity").notNull(),
  ruleId: text("rule_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  componentApiName: text("component_api_name"),
  componentType: text("component_type"),
  recommendation: text("recommendation").notNull(),
  codeSnippet: text("code_snippet"),
});

export const insertHealthFindingSchema = createInsertSchema(healthFindings).omit({ id: true });
export type InsertHealthFinding = z.infer<typeof insertHealthFindingSchema>;
export type HealthFinding = typeof healthFindings.$inferSelect;

// Change requests — tracks requests to modify existing org components
export const changeRequests = sqliteTable("change_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  targetComponentId: integer("target_component_id"),
  targetApiName: text("target_api_name"),
  targetType: text("target_type"),
  originalCode: text("original_code"),
  proposedCode: text("proposed_code"),
  diffJson: text("diff_json"),
  impactAnalysisJson: text("impact_analysis_json"),
  status: text("status").notNull().default("draft"),
  rollbackPackageJson: text("rollback_package_json"),
  deployedToSandbox: integer("deployed_to_sandbox").default(0),
  deployedToProduction: integer("deployed_to_production").default(0),
  sandboxOrgId: integer("sandbox_org_id"),
  productionOrgId: integer("production_org_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
});

export const insertChangeRequestSchema = createInsertSchema(changeRequests).omit({ id: true });
export type InsertChangeRequest = z.infer<typeof insertChangeRequestSchema>;
export type ChangeRequest = typeof changeRequests.$inferSelect;

// Users — built-in authentication
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  salt: text("salt").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("user"), // admin | user
  createdAt: text("created_at").notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Sessions — token-based auth sessions
export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  token: text("token").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const insertSessionSchema = createInsertSchema(sessions).omit({ id: true });
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessions.$inferSelect;

// Deployment snapshots — before/after metadata for diff comparison
export const deploymentSnapshots = sqliteTable("deployment_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  deploymentId: integer("deployment_id").notNull(),
  componentApiName: text("component_api_name").notNull(),
  componentType: text("component_type").notNull(),
  beforeMetadata: text("before_metadata"), // null if new component
  afterMetadata: text("after_metadata").notNull(),
  changeType: text("change_type").notNull(), // "created" | "modified" | "deleted"
  createdAt: text("created_at").notNull(),
});

export const insertDeploymentSnapshotSchema = createInsertSchema(deploymentSnapshots).omit({ id: true });
export type InsertDeploymentSnapshot = z.infer<typeof insertDeploymentSnapshotSchema>;
export type DeploymentSnapshot = typeof deploymentSnapshots.$inferSelect;

// Promotions — sandbox-to-sandbox or sandbox-to-production
export const promotions = sqliteTable("promotions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceDeploymentId: integer("source_deployment_id").notNull(),
  sourceOrgId: integer("source_org_id").notNull(),
  targetOrgId: integer("target_org_id").notNull(),
  status: text("status").notNull().default("pending"), // pending | promoting | success | failed
  componentsJson: text("components_json").notNull().default("[]"),
  logJson: text("log_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
});

export const insertPromotionSchema = createInsertSchema(promotions).omit({ id: true });
export type InsertPromotion = z.infer<typeof insertPromotionSchema>;
export type Promotion = typeof promotions.$inferSelect;

// Deploy queue — ensures one deploy per org at a time
export const deployQueue = sqliteTable("deploy_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id").notNull(),
  requirementId: integer("requirement_id"),
  status: text("status").notNull().default("queued"), // queued | running | completed | failed
  priority: integer("priority").notNull().default(0),
  payload: text("payload").notNull(), // JSON with component IDs and deploy options
  result: text("result"), // JSON with deploy result
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
});

export const insertDeployQueueItemSchema = createInsertSchema(deployQueue).omit({ id: true });
export type InsertDeployQueueItem = z.infer<typeof insertDeployQueueItemSchema>;
export type DeployQueueItem = typeof deployQueue.$inferSelect;

// Agent step log entry type (not a table, stored as JSON in agentRuns.stepsJson)
export interface AgentStep {
  id: string;
  timestamp: string;
  phase: string;
  action: string;
  detail: string;
  status: "info" | "success" | "warning" | "error" | "thinking";
  durationMs?: number;
  metadata?: Record<string, any>;
}
