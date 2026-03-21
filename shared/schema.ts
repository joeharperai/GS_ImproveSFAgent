import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Salesforce org connections
export const sfOrgs = sqliteTable("sf_orgs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  instanceUrl: text("instance_url").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  clientId: text("client_id"),
  clientSecret: text("client_secret"),
  orgType: text("org_type").notNull().default("sandbox"), // sandbox | production | developer
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
