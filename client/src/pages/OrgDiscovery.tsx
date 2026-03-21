import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Play, ChevronRight, ChevronDown, Code2, FileText, Zap, Shield,
  Package, Users2, Database, BarChart3, Layout, Workflow, Layers,
  RefreshCw, Brain, CheckCircle2, AlertCircle, Clock, X,
  Globe, Eye, Sparkles,
} from "lucide-react";
import type { SfOrg } from "@shared/schema";

// Category icons & colors
const CATEGORY_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  CustomObject: { icon: Database, color: "text-blue-500", label: "Custom Objects" },
  CustomField: { icon: Layers, color: "text-blue-400", label: "Custom Fields" },
  ApexClass: { icon: Code2, color: "text-purple-500", label: "Apex Classes" },
  ApexTrigger: { icon: Zap, color: "text-amber-500", label: "Apex Triggers" },
  Flow: { icon: Workflow, color: "text-green-500", label: "Flows" },
  ProcessBuilder: { icon: Workflow, color: "text-orange-500", label: "Process Builders" },
  ValidationRule: { icon: Shield, color: "text-red-500", label: "Validation Rules" },
  LWC: { icon: Layout, color: "text-cyan-500", label: "LWC Components" },
  PermissionSet: { icon: Users2, color: "text-indigo-500", label: "Permission Sets" },
  Profile: { icon: Users2, color: "text-indigo-400", label: "Profiles" },
  InstalledPackage: { icon: Package, color: "text-teal-500", label: "Installed Packages" },
  Report: { icon: BarChart3, color: "text-emerald-500", label: "Reports" },
  Dashboard: { icon: BarChart3, color: "text-emerald-400", label: "Dashboards" },
  CustomMetadataType: { icon: Database, color: "text-violet-500", label: "Custom Metadata Types" },
  PlatformEvent: { icon: Zap, color: "text-rose-500", label: "Platform Events" },
  CustomSetting: { icon: Database, color: "text-slate-500", label: "Custom Settings" },
};

function getCategoryConfig(category: string) {
  return CATEGORY_CONFIG[category] || { icon: FileText, color: "text-muted-foreground", label: category };
}

export default function OrgDiscovery() {
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [scanProgress, setScanProgress] = useState<any | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  // Fetch orgs
  const { data: orgs = [] } = useQuery<SfOrg[]>({
    queryKey: ["/api/orgs"],
  });

  const connectedOrgs = orgs.filter(o => o.status === "connected");

  // Fetch inventory summary (category counts)
  const { data: summary = {} } = useQuery<Record<string, number>>({
    queryKey: ["/api/orgs", selectedOrgId, "inventory", "summary"],
    queryFn: () => apiRequest("GET", `/api/orgs/${selectedOrgId}/inventory/summary`).then(r => r.json()),
    enabled: !!selectedOrgId,
  });

  // Fetch inventory items
  const inventoryQueryKey = [
    "/api/orgs", selectedOrgId, "inventory",
    selectedCategory || "all",
    searchQuery,
  ];
  const { data: inventoryItems = [], isLoading: inventoryLoading } = useQuery<any[]>({
    queryKey: inventoryQueryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedCategory) params.set("category", selectedCategory);
      if (searchQuery) params.set("search", searchQuery);
      return apiRequest("GET", `/api/orgs/${selectedOrgId}/inventory?${params}`).then(r => r.json());
    },
    enabled: !!selectedOrgId,
  });

  // Fetch latest scan
  const { data: scans = [] } = useQuery<any[]>({
    queryKey: ["/api/orgs", selectedOrgId, "scans"],
    queryFn: () => apiRequest("GET", `/api/orgs/${selectedOrgId}/scans`).then(r => r.json()),
    enabled: !!selectedOrgId,
  });
  const latestScan = scans[0];

  // Start discovery
  const startScan = useMutation({
    mutationFn: () => apiRequest("POST", `/api/orgs/${selectedOrgId}/discover`),
    onSuccess: async (res) => {
      const scan = await res.json();
      toast({ title: "Discovery started", description: "Scanning org metadata..." });

      // Connect to SSE for progress
      const eventSource = new EventSource(`/api/scans/${scan.id}/stream`);
      eventSource.onmessage = (event) => {
        const progress = JSON.parse(event.data);
        setScanProgress(progress);

        if (progress.phase === "complete" || progress.phase === "error" || progress.phase === "done") {
          eventSource.close();
          setScanProgress(null);
          queryClient.invalidateQueries({ queryKey: ["/api/orgs", selectedOrgId, "inventory"] });
          queryClient.invalidateQueries({ queryKey: ["/api/orgs", selectedOrgId, "scans"] });
          queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
        }
      };
      eventSource.onerror = () => {
        eventSource.close();
        setScanProgress(null);
        queryClient.invalidateQueries({ queryKey: ["/api/orgs", selectedOrgId, "inventory"] });
        queryClient.invalidateQueries({ queryKey: ["/api/orgs", selectedOrgId, "scans"] });
      };
    },
    onError: () => {
      toast({ title: "Discovery failed", description: "Could not start scan", variant: "destructive" });
    },
  });

  // AI describe single item
  const describeItem = useMutation({
    mutationFn: (itemId: number) => apiRequest("POST", `/api/inventory/${itemId}/describe`),
    onSuccess: async (res) => {
      const updated = await res.json();
      setSelectedItem(updated);
      queryClient.invalidateQueries({ queryKey: ["/api/orgs", selectedOrgId, "inventory"] });
      toast({ title: "Description generated" });
    },
    onError: () => {
      toast({ title: "Description failed", variant: "destructive" });
    },
  });

  // Sort categories by count
  const sortedCategories = Object.entries(summary)
    .sort(([, a], [, b]) => b - a);
  const totalComponents = Object.values(summary).reduce((s, c) => s + c, 0);

  const toggleCategory = (cat: string) => {
    const next = new Set(expandedCategories);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    setExpandedCategories(next);
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2" data-testid="text-page-title">
              <Search className="h-5 w-5 text-muted-foreground" />
              Org Discovery
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Explore metadata components in your Salesforce orgs
            </p>
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
            <Button
              onClick={() => startScan.mutate()}
              disabled={!selectedOrgId || startScan.isPending || !!scanProgress}
              data-testid="button-scan-org"
            >
              {scanProgress ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              {scanProgress ? "Scanning..." : "Scan Org"}
            </Button>
          </div>
        </div>

        {/* Scan progress */}
        {scanProgress && (
          <div className="mt-3 p-3 rounded-lg bg-muted/50 border" data-testid="card-scan-progress">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">{scanProgress.message}</span>
              <Badge variant="outline" className="text-xs">
                {scanProgress.totalComponents} found
              </Badge>
            </div>
            <Progress
              value={scanProgress.describedComponents && scanProgress.totalComponents
                ? (scanProgress.describedComponents / Math.max(scanProgress.totalComponents, 1)) * 100
                : undefined}
              className="h-1.5"
            />
          </div>
        )}

        {/* Last scan info + detected clouds */}
        {latestScan && !scanProgress && (
          <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Last scan: {new Date(latestScan.completedAt || latestScan.startedAt).toLocaleString()}
            </span>
            <span>{latestScan.totalComponents} components</span>
            {latestScan.cloudsDetectedJson && JSON.parse(latestScan.cloudsDetectedJson).length > 0 && (
              <div className="flex items-center gap-1.5">
                <span>Clouds:</span>
                {JSON.parse(latestScan.cloudsDetectedJson).map((cloud: string) => (
                  <Badge key={cloud} variant="secondary" className="text-[10px] px-1.5 py-0">
                    {cloud}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {!selectedOrgId ? (
        <EmptyState />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Category Tree */}
          <div className="w-64 border-r bg-muted/30 flex flex-col">
            <div className="p-3 border-b">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search components..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-sm"
                  data-testid="input-search"
                />
              </div>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2">
                {/* All items */}
                <button
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-sm transition-colors ${
                    !selectedCategory ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground"
                  }`}
                  onClick={() => { setSelectedCategory(null); setSelectedItem(null); }}
                  data-testid="button-category-all"
                >
                  <span>All Components</span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 min-w-[28px] justify-center">
                    {totalComponents}
                  </Badge>
                </button>

                <div className="mt-2 space-y-0.5">
                  {sortedCategories.map(([category, count]) => {
                    const config = getCategoryConfig(category);
                    const Icon = config.icon;
                    const isSelected = selectedCategory === category;

                    return (
                      <button
                        key={category}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-sm transition-colors ${
                          isSelected ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground"
                        }`}
                        onClick={() => { setSelectedCategory(category); setSelectedItem(null); }}
                        data-testid={`button-category-${category}`}
                      >
                        <div className="flex items-center gap-2">
                          <Icon className={`h-3.5 w-3.5 ${config.color}`} />
                          <span className="truncate">{config.label}</span>
                        </div>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 min-w-[28px] justify-center">
                          {count}
                        </Badge>
                      </button>
                    );
                  })}
                </div>

                {sortedCategories.length === 0 && !scanProgress && (
                  <p className="text-xs text-muted-foreground text-center mt-8 px-4">
                    No metadata discovered yet. Click "Scan Org" to start.
                  </p>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Center: Component List */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b bg-background flex items-center justify-between">
              <span className="text-sm font-medium">
                {selectedCategory ? getCategoryConfig(selectedCategory).label : "All Components"}
                <span className="text-muted-foreground ml-1.5">({inventoryItems.length})</span>
              </span>
            </div>
            <ScrollArea className="flex-1">
              <div className="divide-y">
                {inventoryLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="px-4 py-3 flex items-center gap-3">
                      <Skeleton className="h-8 w-8 rounded" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-72" />
                      </div>
                    </div>
                  ))
                ) : inventoryItems.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    {searchQuery ? "No components match your search." : "No components found in this category."}
                  </div>
                ) : (
                  inventoryItems.map((item: any) => {
                    const config = getCategoryConfig(item.category);
                    const Icon = config.icon;
                    const isActive = selectedItem?.id === item.id;

                    return (
                      <button
                        key={item.id}
                        className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors hover:bg-muted/50 ${
                          isActive ? "bg-primary/5 border-l-2 border-l-primary" : ""
                        }`}
                        onClick={() => setSelectedItem(item)}
                        data-testid={`row-inventory-${item.id}`}
                      >
                        <div className={`mt-0.5 p-1.5 rounded ${isActive ? "bg-primary/10" : "bg-muted"}`}>
                          <Icon className={`h-4 w-4 ${config.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{item.label}</span>
                            {item.status === "described" && (
                              <Sparkles className="h-3 w-3 text-amber-500 flex-shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground font-mono truncate">{item.apiName}</p>
                          {item.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
                          )}
                        </div>
                        {item.parentApiName && (
                          <Badge variant="outline" className="text-[10px] flex-shrink-0 mt-0.5">
                            {item.parentApiName}
                          </Badge>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Right: Detail Panel */}
          {selectedItem && (
            <DetailPanel
              item={selectedItem}
              onClose={() => setSelectedItem(null)}
              onDescribe={() => describeItem.mutate(selectedItem.id)}
              isDescribing={describeItem.isPending}
            />
          )}
        </div>
      )}
    </div>
  );
}

function DetailPanel({
  item,
  onClose,
  onDescribe,
  isDescribing,
}: {
  item: any;
  onClose: () => void;
  onDescribe: () => void;
  isDescribing: boolean;
}) {
  const config = getCategoryConfig(item.category);
  const Icon = config.icon;
  const metadata = item.metadataJson ? JSON.parse(item.metadataJson) : null;

  return (
    <div className="w-96 border-l bg-background flex flex-col" data-testid="panel-detail">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`h-4 w-4 ${config.color} flex-shrink-0`} />
          <span className="text-sm font-semibold truncate">{item.label}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0" data-testid="button-close-detail">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* API Name */}
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">API Name</label>
            <p className="text-sm font-mono mt-0.5">{item.apiName}</p>
          </div>

          {/* Category */}
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Type</label>
            <div className="mt-0.5">
              <Badge variant="secondary">{config.label}</Badge>
            </div>
          </div>

          {/* Parent */}
          {item.parentApiName && (
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Parent Object</label>
              <p className="text-sm font-mono mt-0.5">{item.parentApiName}</p>
            </div>
          )}

          {/* AI Description */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">AI Description</label>
              {!item.description && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs gap-1"
                  onClick={onDescribe}
                  disabled={isDescribing}
                  data-testid="button-generate-description"
                >
                  {isDescribing ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <Brain className="h-3 w-3" />
                  )}
                  Generate
                </Button>
              )}
            </div>
            {item.description ? (
              <div className="mt-1 p-2.5 rounded-md bg-muted/50 border text-sm leading-relaxed">
                <Sparkles className="h-3.5 w-3.5 text-amber-500 inline mr-1.5 -mt-0.5" />
                {item.description}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mt-1 italic">No description yet</p>
            )}
          </div>

          {/* Metadata details */}
          {metadata && Object.keys(metadata).length > 0 && (
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Properties</label>
              <div className="mt-1 space-y-1">
                {Object.entries(metadata).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between text-sm py-1 border-b border-border/50 last:border-0">
                    <span className="text-muted-foreground capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</span>
                    <span className="font-mono text-xs">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Source Code */}
          {item.sourceCode && (
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Source Code</label>
              <pre className="mt-1 p-3 rounded-md bg-zinc-950 text-zinc-100 text-xs overflow-x-auto max-h-80 font-mono leading-relaxed">
                <code>{item.sourceCode}</code>
              </pre>
            </div>
          )}

          {/* Discovered at */}
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Discovered</label>
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(item.discoveredAt).toLocaleString()}
            </p>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
          <Search className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold mb-1">Org Discovery</h2>
        <p className="text-sm text-muted-foreground">
          Select a connected Salesforce org to explore its metadata — custom objects, Apex classes, Flows, LWC components, and more. Each component gets an AI-generated description.
        </p>
      </div>
    </div>
  );
}
