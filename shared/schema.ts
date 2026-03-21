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
  category: text("category").notNull().default("declarative"), // declarative | apex | lwc | integration | data_migration | flow
  priority: text("priority").notNull().default("medium"), // low | medium | high | critical
  status: text("status").notNull().default("draft"), // draft | analyzing | analyzed | generating | ready | deploying | deployed | failed
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
  componentsJson: text("components_json").notNull(), // JSON array of components to create
  dependenciesJson: text("dependencies_json").notNull(), // JSON array of dependencies
  bestPracticesJson: text("best_practices_json").notNull(), // JSON array of best practice notes
  risksJson: text("risks_json").notNull(), // JSON array of risks
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
  componentType: text("component_type").notNull(), // CustomObject | CustomField | Flow | ApexClass | ApexTrigger | LWC | ValidationRule | PermissionSet | Layout
  apiName: text("api_name").notNull(),
  label: text("label").notNull(),
  metadataXml: text("metadata_xml").notNull(), // The generated metadata XML or code
  status: text("status").notNull().default("pending"), // pending | approved | deployed | failed
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
  status: text("status").notNull().default("pending"), // pending | in_progress | success | partial | failed | rolled_back
  componentsJson: text("components_json").notNull(), // JSON array of component IDs deployed
  logJson: text("log_json").notNull(), // JSON array of deployment log entries
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
});

export const insertDeploymentSchema = createInsertSchema(deployments).omit({ id: true });
export type InsertDeployment = z.infer<typeof insertDeploymentSchema>;
export type Deployment = typeof deployments.$inferSelect;
