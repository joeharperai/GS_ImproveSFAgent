/**
 * GS_ImproveSFAgent — Compliance Templates
 *
 * Pre-built requirement templates for common Salesforce patterns.
 */

export interface ComplianceTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  requirementText: string;
  tags: string[];
  complexity: "simple" | "moderate" | "complex";
  estimatedComponents: number;
}

export const COMPLIANCE_TEMPLATES: ComplianceTemplate[] = [
  {
    id: "lead-to-opp",
    name: "Lead to Opportunity Conversion",
    category: "Sales",
    description: "Standard lead qualification and conversion flow with field mapping",
    requirementText: "Create a lead qualification and conversion process: 1) Add a Lead Score field (number) on Lead that auto-calculates based on key fields (Industry, Annual Revenue, Number of Employees). 2) Create a Flow that auto-assigns Lead Status based on score thresholds (Cold < 30, Warm 30-70, Hot > 70). 3) When converting a Lead, map custom Lead fields to Opportunity and Contact fields. 4) Create a validation rule preventing conversion of Leads with Status = 'Cold' unless overridden by a manager profile.",
    tags: ["lead", "opportunity", "conversion", "sales"],
    complexity: "moderate",
    estimatedComponents: 8,
  },
  {
    id: "case-management",
    name: "Case Management with Escalation",
    category: "Service",
    description: "Case routing, SLA tracking, and escalation rules",
    requirementText: "Build a case management system: 1) Custom fields on Case: SLA_Deadline__c (datetime), Escalation_Level__c (picklist: None/L1/L2/L3), Resolution_Notes__c (long text). 2) A record-triggered Flow that sets SLA_Deadline__c based on Priority (High=4hrs, Medium=8hrs, Low=24hrs from CreatedDate). 3) A scheduled Flow that checks every hour for Cases past their SLA deadline and auto-escalates by incrementing Escalation_Level__c. 4) A Permission Set 'Case_Manager' with edit access to escalation fields.",
    tags: ["case", "service", "escalation", "SLA"],
    complexity: "moderate",
    estimatedComponents: 7,
  },
  {
    id: "duplicate-management",
    name: "Duplicate Detection & Merge",
    category: "Data Model",
    description: "Detect and flag duplicate records on Account and Contact",
    requirementText: "Implement duplicate detection: 1) Create a custom field Is_Potential_Duplicate__c (checkbox) on Account and Contact. 2) Create matching rules for Account (match on Name + BillingCity) and Contact (match on Email OR FirstName+LastName+Phone). 3) Create duplicate rules that flag (not block) potential duplicates and set Is_Potential_Duplicate__c = true. 4) Create a report showing all records where Is_Potential_Duplicate__c = true, grouped by match criteria.",
    tags: ["duplicate", "data quality", "matching"],
    complexity: "moderate",
    estimatedComponents: 6,
  },
  {
    id: "field-security-audit",
    name: "Field-Level Security Audit Setup",
    category: "Security",
    description: "Permission sets for tiered data access",
    requirementText: "Create a tiered field-level security model: 1) Permission Set 'Basic_User' with read access to standard Account/Contact/Opportunity fields only. 2) Permission Set 'Financial_User' extending Basic_User with read/write access to Revenue, AnnualRevenue, Amount fields. 3) Permission Set 'Admin_User' with full read/write to all custom and standard fields. 4) A custom report type showing which permission sets each user has assigned.",
    tags: ["security", "permissions", "FLS", "audit"],
    complexity: "simple",
    estimatedComponents: 4,
  },
  {
    id: "approval-process",
    name: "Discount Approval Process",
    category: "Automation",
    description: "Multi-tier approval for opportunity discounts",
    requirementText: "Build a discount approval workflow: 1) Custom fields on Opportunity: Discount_Percentage__c (percent), Discount_Approved__c (checkbox), Approved_By__c (lookup to User). 2) A validation rule preventing Opportunity Stage from moving to 'Closed Won' if Discount_Percentage__c > 10 and Discount_Approved__c = false. 3) A Flow that triggers when Discount_Percentage__c > 10: submits for approval — 10-20% needs Sales Manager, 20-30% needs VP Sales, >30% needs CEO. 4) On approval, set Discount_Approved__c = true and Approved_By__c to the approver.",
    tags: ["approval", "discount", "opportunity", "automation"],
    complexity: "complex",
    estimatedComponents: 10,
  },
  {
    id: "activity-tracking",
    name: "Activity & Engagement Tracking",
    category: "Reporting",
    description: "Track and report on sales team activities",
    requirementText: "Build activity tracking: 1) Custom object Activity_Summary__c with fields: Account__c (lookup), Month__c (date), Calls_Made__c (number), Emails_Sent__c (number), Meetings_Held__c (number), Total_Activities__c (formula). 2) A scheduled Flow that runs monthly: queries Tasks and Events for each Account from the prior month, creates/updates an Activity_Summary__c record. 3) A report showing Activity_Summary__c by Account Owner and Month with charts for activity trends.",
    tags: ["activity", "reporting", "engagement", "metrics"],
    complexity: "complex",
    estimatedComponents: 8,
  },
  {
    id: "data-validation-suite",
    name: "Data Quality Validation Rules",
    category: "Data Model",
    description: "Comprehensive validation rules for clean data entry",
    requirementText: "Create a data quality validation suite: 1) Account: Phone must be 10+ digits, Website must start with http/https, BillingCountry is required if BillingStreet is populated. 2) Contact: Email format validation, Phone format validation, MailingAddress required if DoNotMail is false. 3) Opportunity: CloseDate cannot be in the past for new Opportunities, Amount is required when Stage = 'Proposal' or later. 4) All validation rules should have clear, user-friendly error messages referencing the field with the issue.",
    tags: ["validation", "data quality", "rules"],
    complexity: "simple",
    estimatedComponents: 8,
  },
  {
    id: "onboarding-checklist",
    name: "Customer Onboarding Checklist",
    category: "Automation",
    description: "Track customer onboarding steps with automated reminders",
    requirementText: "Build a customer onboarding tracker: 1) Custom object Onboarding_Task__c with fields: Account__c (master-detail to Account), Task_Name__c (text), Due_Date__c (date), Completed__c (checkbox), Completed_Date__c (date), Assigned_To__c (lookup to User), Order__c (number). 2) When an Opportunity is marked Closed Won, a Flow auto-creates a set of Onboarding_Task__c records from a template (Welcome Call, Kick-off Meeting, Training Session, Go-Live Review, 30-Day Check-in). 3) A scheduled Flow sends email reminders 2 days before each uncompleted task's due date. 4) A rollup summary or Flow-based count on Account showing onboarding completion percentage.",
    tags: ["onboarding", "automation", "checklist", "customer success"],
    complexity: "complex",
    estimatedComponents: 12,
  },
];
