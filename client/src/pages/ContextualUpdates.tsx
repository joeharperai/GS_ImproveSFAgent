import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useToast } from "@/hooks/use-toast";
import {
  GitCompareArrows, Plus, Globe, ArrowLeft, Play, Check, X, RotateCcw,
  Upload, Rocket, AlertTriangle, ArrowRight, Trash2, RefreshCw,
  Shield, Code2, ChevronRight, ExternalLink, Clock,
} from "lucide-react";
import type { SfOrg, ChangeRequest, OrgInventoryItem } from "@shared/schema";

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  draft: { color: "text-slate-500", bg: "bg-slate-500/10 border-slate-500/20", label: "Draft" },
  analyzing: { color: "text-blue-500", bg: "bg-blue-500/10 border-blue-500/20", label: "Analyzing" },
  proposed: { color: "text-purple-500", bg: "bg-purple-500/10 border-purple-500/20", label: "Proposed" },
  approved: { color: "text-green-500", bg: "bg-green-500/10 border-green-500/20", label: "Approved" },
  deploying: { color: "text-amber-500", bg: "bg-amber-500/10 border-amber-500/20", label: "Deploying" },
  deployed: { color: "text-emerald-500", bg: "bg-emerald-500/10 border-emerald-500/20", label: "Deployed" },
  rejected: { color: "text-red-500", bg: "bg-red-500/10 border-red-500/20", label: "Rejected" },
  rolled_back: { color: "text-orange-500", bg: "bg-orange-500/10 border-orange-500/20", label: "Rolled Back" },
};

const RISK_COLORS: Record<string, string> = {
  Low: "bg-green-500/10 text-green-700 border-green-500/20",
  Medium: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
  High: "bg-red-500/10 text-red-700 border-red-500/20",
};

const PIPELINE_STAGES = ["draft", "proposed", "approved", "deployed"];

export default function ContextualUpdates() {
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [selectedCrId, setSelectedCrId] = useState<number | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const { toast } = useToast();

  // Fetch orgs
  const { data: orgs = [] } = useQuery<SfOrg[]>({
    queryKey: ["/api/orgs"],
  });
  const connectedOrgs = orgs.filter(o => o.status === "connected");

  // Fetch change requests for selected org
  const { data: changeRequests = [] } = useQuery<ChangeRequest[]>({
    queryKey: ["/api/orgs", selectedOrgId, "changes"],
    queryFn: () => apiRequest("GET", `/api/orgs/${selectedOrgId}/changes`).then(r => r.json()),
    enabled: !!selectedOrgId,
  });

  // Fetch selected change request detail
  const { data: selectedCr } = useQuery<ChangeRequest>({
    queryKey: ["/api/changes", selectedCrId],
    queryFn: () => apiRequest("GET", `/api/changes/${selectedCrId}`).then(r => r.json()),
    enabled: !!selectedCrId,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === "analyzing" ? 2000 : false;
    },
  });

  // Fetch inventory for target component selector
  const { data: inventory = [] } = useQuery<OrgInventoryItem[]>({
    queryKey: ["/api/orgs", selectedOrgId, "inventory"],
    queryFn: () => apiRequest("GET", `/api/orgs/${selectedOrgId}/inventory`).then(r => r.json()),
    enabled: !!selectedOrgId,
  });

  const inventoryWithCode = inventory.filter(i => i.sourceCode);

  if (selectedCr && selectedCrId) {
    return (
      <ChangeRequestDetail
        cr={selectedCr}
        onBack={() => {
          setSelectedCrId(null);
          queryClient.invalidateQueries({ queryKey: ["/api/orgs", selectedOrgId, "changes"] });
        }}
        orgId={selectedOrgId}
      />
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SidebarTrigger />
          <div>
            <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
              <GitCompareArrows className="h-5 w-5 text-purple-500" />
              Contextual Updates
            </h1>
            <p className="text-sm text-muted-foreground">
              Modify existing Salesforce components with AI-powered diff review
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
            <SelectTrigger className="w-[240px]" data-testid="select-org">
              <SelectValue placeholder="Select an org..." />
            </SelectTrigger>
            <SelectContent>
              {connectedOrgs.map(org => (
                <SelectItem key={org.id} value={String(org.id)}>
                  <div className="flex items-center gap-2">
                    <Globe className="h-3.5 w-3.5 text-green-500" />
                    {org.name}
                  </div>
                </SelectItem>
              ))}
              {connectedOrgs.length === 0 && (
                <SelectItem value="none" disabled>No connected orgs</SelectItem>
              )}
            </SelectContent>
          </Select>

          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button disabled={!selectedOrgId} data-testid="button-new-change">
                <Plus className="h-4 w-4 mr-2" />
                New Change Request
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Change Request</DialogTitle>
              </DialogHeader>
              <CreateChangeForm
                orgId={parseInt(selectedOrgId)}
                inventory={inventoryWithCode}
                onCreated={(cr) => {
                  setShowCreateDialog(false);
                  setSelectedCrId(cr.id);
                  queryClient.invalidateQueries({ queryKey: ["/api/orgs", selectedOrgId, "changes"] });
                  toast({ title: "Change request created" });
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {!selectedOrgId ? (
        <EmptyState />
      ) : changeRequests.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <GitCompareArrows className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium mb-1">No Change Requests</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create a change request to modify an existing component with AI-powered proposals and diff review.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {changeRequests.map((cr) => {
            const statusConfig = STATUS_CONFIG[cr.status] || STATUS_CONFIG.draft;
            const impact = cr.impactAnalysisJson ? JSON.parse(cr.impactAnalysisJson) : null;

            return (
              <Card
                key={cr.id}
                className="cursor-pointer hover:border-primary/30 transition-colors"
                onClick={() => setSelectedCrId(cr.id)}
                data-testid={`card-change-${cr.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium">{cr.title}</span>
                        <Badge className={`text-[10px] ${statusConfig.bg}`}>
                          {statusConfig.label}
                        </Badge>
                        {impact && (
                          <Badge className={`text-[10px] ${RISK_COLORS[impact.riskLevel] || RISK_COLORS.Low}`}>
                            {impact.riskLevel} Risk
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1">{cr.description}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        {cr.targetApiName && (
                          <span className="flex items-center gap-1 font-mono">
                            <Code2 className="h-3 w-3" />
                            {cr.targetApiName}
                          </span>
                        )}
                        {cr.targetType && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{cr.targetType}</Badge>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(cr.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ==================== Create Change Form ====================

function CreateChangeForm({
  orgId,
  inventory,
  onCreated,
}: {
  orgId: number;
  inventory: OrgInventoryItem[];
  onCreated: (cr: ChangeRequest) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetComponentId, setTargetComponentId] = useState<string>("");

  const createMutation = useMutation({
    mutationFn: async () => {
      const component = inventory.find(i => i.id === parseInt(targetComponentId));
      const res = await apiRequest("POST", "/api/changes", {
        orgId,
        title,
        description,
        targetComponentId: component?.id || null,
        targetApiName: component?.apiName || null,
        targetType: component?.category || null,
      });
      return res.json();
    },
    onSuccess: (cr) => onCreated(cr),
  });

  // Group inventory by category
  const grouped = inventory.reduce<Record<string, OrgInventoryItem[]>>((acc, item) => {
    (acc[item.category] = acc[item.category] || []).push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">Title</label>
        <Input
          placeholder="e.g., Add bulk error handling to AccountTrigger"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          data-testid="input-cr-title"
        />
      </div>
      <div>
        <label className="text-sm font-medium">Description</label>
        <Textarea
          placeholder="Describe the change you want to make in plain English..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          data-testid="input-cr-description"
        />
      </div>
      <div>
        <label className="text-sm font-medium">Target Component</label>
        <Select value={targetComponentId} onValueChange={setTargetComponentId}>
          <SelectTrigger data-testid="select-target-component">
            <SelectValue placeholder="Select component to modify..." />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(grouped).map(([category, items]) => (
              <div key={category}>
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{category}</div>
                {items.map(item => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    <span className="font-mono text-xs">{item.apiName}</span>
                    <span className="text-muted-foreground ml-2 text-xs">({item.label})</span>
                  </SelectItem>
                ))}
              </div>
            ))}
            {inventory.length === 0 && (
              <SelectItem value="none" disabled>No components with source code</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>
      <Button
        className="w-full"
        onClick={() => createMutation.mutate()}
        disabled={!title || !description || createMutation.isPending}
        data-testid="button-create-cr"
      >
        {createMutation.isPending ? (
          <RefreshCw className="h-4 w-4 animate-spin mr-2" />
        ) : (
          <Plus className="h-4 w-4 mr-2" />
        )}
        Create Change Request
      </Button>
    </div>
  );
}

// ==================== Change Request Detail ====================

function ChangeRequestDetail({
  cr,
  onBack,
  orgId,
}: {
  cr: ChangeRequest;
  onBack: () => void;
  orgId: string;
}) {
  const { toast } = useToast();
  const statusConfig = STATUS_CONFIG[cr.status] || STATUS_CONFIG.draft;
  const impact = cr.impactAnalysisJson ? JSON.parse(cr.impactAnalysisJson) : null;
  const diffHunks = cr.diffJson ? JSON.parse(cr.diffJson) : [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/changes", cr.id] });
    queryClient.invalidateQueries({ queryKey: ["/api/orgs", orgId, "changes"] });
    queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
  };

  const proposeMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/changes/${cr.id}/propose`),
    onSuccess: () => { invalidate(); toast({ title: "Proposal generated" }); },
    onError: () => toast({ title: "Proposal failed", variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/changes/${cr.id}/approve`),
    onSuccess: () => { invalidate(); toast({ title: "Change approved" }); },
  });

  const rejectMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/changes/${cr.id}/reject`),
    onSuccess: () => { invalidate(); toast({ title: "Change rejected" }); },
  });

  const deploySandboxMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/changes/${cr.id}/deploy-sandbox`),
    onSuccess: () => {
      invalidate();
      toast({ title: "Deployed to sandbox" });
      // Refetch after simulated deploy
      setTimeout(() => invalidate(), 3000);
    },
  });

  const promoteMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/changes/${cr.id}/promote`),
    onSuccess: () => { invalidate(); toast({ title: "Promoted to production" }); },
    onError: () => toast({ title: "Promotion failed", description: "Must deploy to sandbox first", variant: "destructive" }),
  });

  const rollbackMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/changes/${cr.id}/rollback`),
    onSuccess: () => { invalidate(); toast({ title: "Change rolled back" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/changes/${cr.id}`),
    onSuccess: () => { onBack(); toast({ title: "Change request deleted" }); },
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{cr.title}</h1>
              <Badge className={`${statusConfig.bg}`}>
                {statusConfig.label}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{cr.description}</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate()} data-testid="button-delete-cr">
          <Trash2 className="h-4 w-4 text-red-500" />
        </Button>
      </div>

      {/* Pipeline Visualization */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            {PIPELINE_STAGES.map((stage, i) => {
              const stageIdx = PIPELINE_STAGES.indexOf(cr.status === "rolled_back" ? "deployed" : cr.status === "rejected" ? "proposed" : cr.status === "analyzing" ? "draft" : cr.status === "deploying" ? "approved" : cr.status);
              const isActive = i === stageIdx;
              const isComplete = i < stageIdx;
              const config = STATUS_CONFIG[stage] || STATUS_CONFIG.draft;

              return (
                <div key={stage} className="flex items-center flex-1">
                  <div className="flex flex-col items-center flex-1">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                        isComplete
                          ? "bg-primary text-primary-foreground border-primary"
                          : isActive
                            ? `border-primary ${config.bg}`
                            : "border-muted-foreground/30 text-muted-foreground"
                      }`}
                    >
                      {isComplete ? <Check className="h-4 w-4" /> : i + 1}
                    </div>
                    <span className={`text-[10px] mt-1 capitalize ${isActive ? "font-semibold" : "text-muted-foreground"}`}>
                      {stage === "deployed" ? "Sandbox" : stage}
                    </span>
                  </div>
                  {i < PIPELINE_STAGES.length - 1 && (
                    <div className={`h-0.5 flex-1 mx-1 ${i < stageIdx ? "bg-primary" : "bg-muted-foreground/20"}`} />
                  )}
                </div>
              );
            })}
            {/* Production stage */}
            <div className="flex items-center">
              <div className={`h-0.5 w-4 mx-1 ${cr.deployedToProduction ? "bg-primary" : "bg-muted-foreground/20"}`} />
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                    cr.deployedToProduction
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-muted-foreground/30 text-muted-foreground"
                  }`}
                >
                  {cr.deployedToProduction ? <Check className="h-4 w-4" /> : 5}
                </div>
                <span className={`text-[10px] mt-1 ${cr.deployedToProduction ? "font-semibold" : "text-muted-foreground"}`}>
                  Production
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Info Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {cr.targetApiName && (
              <div>
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Target Component</label>
                <p className="text-sm font-mono mt-0.5">{cr.targetApiName}</p>
              </div>
            )}
            {cr.targetType && (
              <div>
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Type</label>
                <div className="mt-0.5">
                  <Badge variant="secondary">{cr.targetType}</Badge>
                </div>
              </div>
            )}
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Created</label>
              <p className="text-xs text-muted-foreground mt-0.5">{new Date(cr.createdAt).toLocaleString()}</p>
            </div>
            {cr.updatedAt && (
              <div>
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Last Updated</label>
                <p className="text-xs text-muted-foreground mt-0.5">{new Date(cr.updatedAt).toLocaleString()}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Impact Analysis */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Impact Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            {impact ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Risk Level:</span>
                  <Badge className={RISK_COLORS[impact.riskLevel] || RISK_COLORS.Low}>
                    {impact.riskLevel}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    ({impact.totalImpactedComponents} impacted component{impact.totalImpactedComponents !== 1 ? "s" : ""})
                  </span>
                </div>

                {impact.referencedBy.length > 0 && (
                  <div>
                    <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Referenced By</label>
                    <div className="mt-1 space-y-1">
                      {impact.referencedBy.map((ref: string, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <ArrowLeft className="h-3 w-3 text-muted-foreground" />
                          <span className="font-mono">{ref}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {impact.references.length > 0 && (
                  <div>
                    <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">References</label>
                    <div className="mt-1 space-y-1">
                      {impact.references.map((ref: string, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span className="font-mono">{ref}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {impact.referencedBy.length === 0 && impact.references.length === 0 && (
                  <p className="text-xs text-muted-foreground">No cross-references detected.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Impact analysis will be generated when you create a proposal.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Diff View */}
      {(cr.originalCode || cr.proposedCode) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <GitCompareArrows className="h-4 w-4" />
              Code Diff
            </CardTitle>
          </CardHeader>
          <CardContent>
            {diffHunks.length > 0 ? (
              <DiffView diffHunks={diffHunks} />
            ) : cr.status === "analyzing" ? (
              <div className="p-8 text-center">
                <RefreshCw className="h-8 w-8 animate-spin mx-auto text-primary mb-2" />
                <p className="text-sm text-muted-foreground">Generating proposal...</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground p-4">
                No diff available. Generate a proposal to see the proposed changes.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Action Bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            {cr.status === "draft" && (
              <Button
                onClick={() => proposeMutation.mutate()}
                disabled={proposeMutation.isPending}
                data-testid="button-propose"
              >
                {proposeMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Generate Proposal
              </Button>
            )}

            {cr.status === "proposed" && (
              <>
                <Button
                  onClick={() => approveMutation.mutate()}
                  disabled={approveMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                  data-testid="button-approve"
                >
                  <Check className="h-4 w-4 mr-2" />
                  Approve
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => rejectMutation.mutate()}
                  disabled={rejectMutation.isPending}
                  data-testid="button-reject"
                >
                  <X className="h-4 w-4 mr-2" />
                  Reject
                </Button>
              </>
            )}

            {cr.status === "approved" && (
              <Button
                onClick={() => deploySandboxMutation.mutate()}
                disabled={deploySandboxMutation.isPending}
                data-testid="button-deploy-sandbox"
              >
                {deploySandboxMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Deploy to Sandbox
              </Button>
            )}

            {cr.status === "deployed" && !cr.deployedToProduction && (
              <>
                <Button
                  onClick={() => promoteMutation.mutate()}
                  disabled={promoteMutation.isPending}
                  data-testid="button-promote"
                >
                  <Rocket className="h-4 w-4 mr-2" />
                  Promote to Production
                </Button>
                <Button
                  variant="outline"
                  onClick={() => rollbackMutation.mutate()}
                  disabled={rollbackMutation.isPending}
                  data-testid="button-rollback"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Rollback
                </Button>
              </>
            )}

            {cr.status === "deployed" && cr.deployedToProduction === 1 && (
              <Button
                variant="outline"
                onClick={() => rollbackMutation.mutate()}
                disabled={rollbackMutation.isPending}
                data-testid="button-rollback"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Rollback
              </Button>
            )}

            {cr.status === "rejected" && (
              <Button
                variant="outline"
                onClick={() => proposeMutation.mutate()}
                disabled={proposeMutation.isPending}
                data-testid="button-repropose"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Re-generate Proposal
              </Button>
            )}

            {cr.status === "analyzing" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Analyzing and generating proposal...
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ==================== Diff View ====================

function DiffView({ diffHunks }: { diffHunks: any[] }) {
  return (
    <ScrollArea className="max-h-[600px]">
      <div className="rounded-lg overflow-hidden border bg-zinc-950 font-mono text-xs">
        {diffHunks.map((hunk: any, i: number) => {
          let bgClass = "";
          let textClass = "text-zinc-300";
          let prefix = " ";

          if (hunk.type === "add") {
            bgClass = "bg-green-500/15";
            textClass = "text-green-300";
            prefix = "+";
          } else if (hunk.type === "remove") {
            bgClass = "bg-red-500/15";
            textClass = "text-red-300";
            prefix = "-";
          }

          return (
            <div
              key={i}
              className={`flex ${bgClass} hover:brightness-110 transition-all`}
              data-testid={`diff-line-${i}`}
            >
              <span className="w-12 text-right pr-3 py-0.5 text-zinc-600 select-none border-r border-zinc-800 flex-shrink-0">
                {hunk.lineNumber}
              </span>
              <span className={`w-5 text-center py-0.5 select-none flex-shrink-0 ${textClass}`}>
                {prefix}
              </span>
              <span className={`py-0.5 pr-4 whitespace-pre ${textClass}`}>
                {hunk.content}
              </span>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

// ==================== Empty State ====================

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[400px]">
      <div className="text-center max-w-md">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
          <GitCompareArrows className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold mb-1">Contextual Updates</h2>
        <p className="text-sm text-muted-foreground">
          Select a connected org to create change requests. The AI generates targeted code modifications with diff review, impact analysis, rollback packages, and sandbox-to-production promotion.
        </p>
      </div>
    </div>
  );
}
