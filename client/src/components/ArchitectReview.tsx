import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Shield, ShieldAlert, ShieldCheck, ShieldX,
  AlertTriangle, AlertOctagon, Info, Loader2,
  MessageSquareWarning, Database, Zap, ChevronDown, ChevronUp,
} from "lucide-react";
import { useState } from "react";

interface ArchitectViolation {
  rule: string;
  severity: "blocker" | "critical" | "warning" | "info";
  component?: string;
  description: string;
  recommendation: string;
  frameworkPillar: string;
}

interface ArchitectReviewResult {
  overallVerdict: "pass" | "pass_with_warnings" | "fail";
  violations: ArchitectViolation[];
  designChallenges: string[];
  fscImplications: string[];
  governorLimitRisks: string[];
  recommendations: string[];
  approvedToGenerate: boolean;
}

export function ArchitectReviewPanel({ requirementId }: { requirementId: number }) {
  const [review, setReview] = useState<ArchitectReviewResult | null>(null);
  const [expanded, setExpanded] = useState(true);

  const reviewMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/requirements/${requirementId}/architect-review`).then((r) => r.json()),
    onSuccess: (data: ArchitectReviewResult) => {
      setReview(data);
    },
  });

  if (!review && !reviewMutation.isPending) {
    return (
      <Card className="border-amber-500/30 bg-gradient-to-r from-amber-500/[0.04] to-transparent" data-testid="card-architect-review-prompt">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <ShieldAlert className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-sm font-semibold">Architect Review</p>
                <p className="text-xs text-muted-foreground">
                  Challenge your design against the Salesforce Well-Architected Framework before generating code
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => reviewMutation.mutate()}
              className="gap-1.5 border-amber-500/30 text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950"
              data-testid="button-run-architect-review"
            >
              <Shield className="h-3.5 w-3.5" />
              Run Review
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (reviewMutation.isPending) {
    return (
      <Card className="border-amber-500/30 bg-gradient-to-r from-amber-500/[0.04] to-transparent">
        <CardContent className="p-6 flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
          <div className="text-center">
            <p className="text-sm font-medium">Architectural Review in Progress</p>
            <p className="text-xs text-muted-foreground mt-1">
              Validating against Well-Architected Framework, governor limits, FSC conventions...
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (reviewMutation.isError) {
    return (
      <Card className="border-red-500/30 bg-gradient-to-r from-red-500/[0.04] to-transparent">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <ShieldX className="h-5 w-5 text-red-500" />
            <div>
              <p className="text-sm font-medium text-red-500">Review Failed</p>
              <p className="text-xs text-muted-foreground">{(reviewMutation.error as any)?.message || "Please try again"}</p>
            </div>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => reviewMutation.mutate()}>
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!review) return null;

  const blockers = review.violations.filter(v => v.severity === "blocker");
  const criticals = review.violations.filter(v => v.severity === "critical");
  const warnings = review.violations.filter(v => v.severity === "warning");
  const infos = review.violations.filter(v => v.severity === "info");

  const verdictConfig = {
    pass: {
      icon: ShieldCheck,
      color: "text-green-500",
      bg: "bg-green-500/10 border-green-500/30",
      label: "Approved",
      description: "Design complies with Salesforce Well-Architected Framework",
    },
    pass_with_warnings: {
      icon: ShieldAlert,
      color: "text-amber-500",
      bg: "bg-amber-500/10 border-amber-500/30",
      label: "Approved with Warnings",
      description: "Design has non-blocking issues to address",
    },
    fail: {
      icon: ShieldX,
      color: "text-red-500",
      bg: "bg-red-500/10 border-red-500/30",
      label: "Blocked",
      description: "Design has blocking violations — must be revised before code generation",
    },
  };

  const verdict = verdictConfig[review.overallVerdict];
  const VerdictIcon = verdict.icon;

  return (
    <Card className={`${verdict.bg}`} data-testid="card-architect-review-result">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-xl ${verdict.bg} flex items-center justify-center`}>
              <VerdictIcon className={`h-5 w-5 ${verdict.color}`} />
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                Architect Review: <span className={verdict.color}>{verdict.label}</span>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{verdict.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpanded(!expanded)}
              className="h-7 w-7 p-0"
              data-testid="button-toggle-review"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => reviewMutation.mutate()}
              className="gap-1 text-xs"
              data-testid="button-rerun-review"
            >
              <Shield className="h-3 w-3" />
              Re-review
            </Button>
          </div>
        </div>

        {/* Summary badges */}
        <div className="flex flex-wrap gap-2 mt-3">
          {blockers.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/30 px-2.5 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-400">
              <AlertOctagon className="h-3 w-3" /> {blockers.length} Blocker{blockers.length !== 1 ? "s" : ""}
            </span>
          )}
          {criticals.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 dark:bg-orange-900/30 px-2.5 py-0.5 text-[11px] font-medium text-orange-700 dark:text-orange-400">
              <AlertTriangle className="h-3 w-3" /> {criticals.length} Critical
            </span>
          )}
          {warnings.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/30 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" /> {warnings.length} Warning{warnings.length !== 1 ? "s" : ""}
            </span>
          )}
          {infos.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/30 px-2.5 py-0.5 text-[11px] font-medium text-blue-700 dark:text-blue-400">
              <Info className="h-3 w-3" /> {infos.length} Info
            </span>
          )}
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4 pt-0">
          {/* Violations */}
          {review.violations.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Violations</p>
              <ScrollArea className={review.violations.length > 4 ? "h-[280px]" : ""}>
                <div className="space-y-2 pr-2">
                  {review.violations.map((v, i) => (
                    <ViolationCard key={i} violation={v} />
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Design Challenges */}
          {review.designChallenges.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <MessageSquareWarning className="h-3.5 w-3.5" />
                Architect Challenges
              </p>
              <div className="space-y-1.5">
                {review.designChallenges.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-muted/40 border border-border/50">
                    <span className="text-xs font-bold text-muted-foreground mt-0.5 shrink-0">Q{i + 1}</span>
                    <p className="text-xs leading-relaxed">{c}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Governor Limit Risks */}
          {review.governorLimitRisks.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-yellow-500" />
                Governor Limit Risks
              </p>
              <div className="space-y-1.5">
                {review.governorLimitRisks.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs p-2 rounded bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200/50 dark:border-yellow-800/30">
                    <Zap className="h-3 w-3 text-yellow-500 mt-0.5 shrink-0" />
                    <span>{r}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* FSC Implications */}
          {review.fscImplications.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5 text-purple-500" />
                FSC Implications
              </p>
              <div className="space-y-1.5">
                {review.fscImplications.map((f, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs p-2 rounded bg-purple-50 dark:bg-purple-950/20 border border-purple-200/50 dark:border-purple-800/30">
                    <Database className="h-3 w-3 text-purple-500 mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {review.recommendations.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-green-500" />
                Recommendations
              </p>
              <div className="space-y-1.5">
                {review.recommendations.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs p-2 rounded bg-green-50 dark:bg-green-950/20 border border-green-200/50 dark:border-green-800/30">
                    <ShieldCheck className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                    <span>{r}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function ViolationCard({ violation }: { violation: ArchitectViolation }) {
  const severityConfig = {
    blocker: {
      icon: AlertOctagon,
      bg: "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800/40",
      iconColor: "text-red-500",
      badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    },
    critical: {
      icon: AlertTriangle,
      bg: "bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800/40",
      iconColor: "text-orange-500",
      badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400",
    },
    warning: {
      icon: AlertTriangle,
      bg: "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40",
      iconColor: "text-amber-500",
      badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    },
    info: {
      icon: Info,
      bg: "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800/40",
      iconColor: "text-blue-500",
      badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
    },
  };

  const config = severityConfig[violation.severity];
  const SeverityIcon = config.icon;

  return (
    <div className={`rounded-lg border p-3 ${config.bg}`} data-testid={`violation-${violation.severity}`}>
      <div className="flex items-start gap-2.5">
        <SeverityIcon className={`h-4 w-4 mt-0.5 shrink-0 ${config.iconColor}`} />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${config.badge}`}>
              {violation.severity}
            </span>
            <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {violation.frameworkPillar}
            </span>
            {violation.component && (
              <span className="text-[10px] font-mono text-muted-foreground">
                {violation.component}
              </span>
            )}
          </div>
          <p className="text-xs font-medium leading-snug">{violation.rule}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{violation.description}</p>
          <div className="flex items-start gap-1.5 pt-0.5">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase shrink-0 mt-0.5">Fix:</span>
            <p className="text-xs text-foreground/80 leading-relaxed">{violation.recommendation}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
