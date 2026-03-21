import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  Plus, FileText, Search, CheckCircle, Clock, AlertTriangle,
  Trash2, ArrowRight,
} from "lucide-react";
import type { Requirement } from "@shared/schema";

export default function Requirements() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const { toast } = useToast();

  const { data: requirements = [], isLoading } = useQuery<Requirement[]>({
    queryKey: ["/api/requirements"],
    queryFn: () => apiRequest("GET", "/api/requirements").then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest("POST", "/api/requirements", data).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requirements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setOpen(false);
      toast({ title: "Requirement created", description: "Ready for AI analysis" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/requirements/${id}`).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requirements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
  });

  const filtered = requirements
    .filter((r) => {
      if (filterStatus !== "all" && r.status !== filterStatus) return false;
      if (search && !r.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .reverse();

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SidebarTrigger />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Requirements</h1>
            <p className="text-sm text-muted-foreground">
              Describe what you need built in Salesforce
            </p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-requirement" size="sm">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New Requirement
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>New Requirement</DialogTitle>
            </DialogHeader>
            <RequirementForm
              onSubmit={(data) => createMutation.mutate(data)}
              isPending={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="input-search"
            placeholder="Search requirements..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[160px]" data-testid="select-filter-status">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="analyzed">Analyzed</SelectItem>
            <SelectItem value="ready">Ready</SelectItem>
            <SelectItem value="deployed">Deployed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Requirements List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="h-14 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium">No requirements yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Create your first requirement to get started
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <Card
              key={r.id}
              data-testid={`card-requirement-${r.id}`}
              className="hover:border-primary/20 transition-colors"
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <Link href={`/requirements/${r.id}`} className="flex-1 cursor-pointer">
                    <div className="flex items-start gap-3">
                      <StatusIcon status={r.status} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{r.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {r.description}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <StatusBadge status={r.status} />
                          <CategoryBadge category={r.category} />
                          <PriorityDot priority={r.priority} />
                        </div>
                      </div>
                    </div>
                  </Link>
                  <div className="flex items-center gap-1 shrink-0">
                    <Link href={`/requirements/${r.id}`}>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteMutation.mutate(r.id)}
                      data-testid={`button-delete-${r.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function RequirementForm({
  onSubmit,
  isPending,
}: {
  onSubmit: (data: any) => void;
  isPending: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("declarative");
  const [priority, setPriority] = useState("medium");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !description) return;
    onSubmit({ title, description, category, priority, status: "draft" });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          data-testid="input-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Create Lead Scoring System"
          required
        />
      </div>
      <div>
        <Label htmlFor="description">Describe what you need</Label>
        <Textarea
          id="description"
          data-testid="input-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the requirement in plain English. Include business rules, field requirements, automation logic, user stories, etc."
          rows={5}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger data-testid="select-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="declarative">Declarative (Objects/Fields/Flows)</SelectItem>
              <SelectItem value="apex">Apex Development</SelectItem>
              <SelectItem value="lwc">Lightning Web Components</SelectItem>
              <SelectItem value="integration">Integration</SelectItem>
              <SelectItem value="data_migration">Data Migration</SelectItem>
              <SelectItem value="flow">Flow Automation</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Priority</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger data-testid="select-priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button
        type="submit"
        className="w-full"
        disabled={isPending || !title || !description}
        data-testid="button-submit-requirement"
      >
        {isPending ? "Creating..." : "Create Requirement"}
      </Button>
    </form>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "deployed":
      return <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />;
    case "failed":
      return <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />;
    case "analyzing":
    case "generating":
    case "deploying":
      return <Clock className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0 animate-pulse" />;
    default:
      return <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />;
  }
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    analyzing: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    analyzed: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    generating: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    ready: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
    deploying: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    deployed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${
        variants[status] || variants.draft
      }`}
    >
      {status}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-primary/10 text-primary capitalize">
      {category?.replace("_", " ")}
    </span>
  );
}

function PriorityDot({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    low: "bg-slate-400",
    medium: "bg-yellow-500",
    high: "bg-orange-500",
    critical: "bg-red-500",
  };
  return (
    <span className="flex items-center gap-1 text-[11px] text-muted-foreground capitalize">
      <span className={`h-1.5 w-1.5 rounded-full ${colors[priority] || colors.medium}`} />
      {priority}
    </span>
  );
}
