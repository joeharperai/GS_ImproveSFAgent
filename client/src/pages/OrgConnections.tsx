import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DialogDescription,
} from "@/components/ui/dialog";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Cloud, CloudOff, CheckCircle, Trash2, Link as LinkIcon,
  Shield, ExternalLink, Info,
} from "lucide-react";
import type { SfOrg } from "@shared/schema";

export default function OrgConnections() {
  const [open, setOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<SfOrg | null>(null);
  const { toast } = useToast();

  const { data: orgs = [], isLoading } = useQuery<SfOrg[]>({
    queryKey: ["/api/orgs"],
    queryFn: () => apiRequest("GET", "/api/orgs").then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest("POST", "/api/orgs", data).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orgs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setOpen(false);
      toast({ title: "Org added", description: "Now connect it with OAuth" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/orgs/${id}`).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orgs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
  });

  const connectMutation = useMutation({
    mutationFn: (data: { orgId: number; clientId: string; clientSecret: string; instanceUrl: string }) =>
      apiRequest("POST", `/api/orgs/${data.orgId}/connect`, data).then((r) => r.json()),
    onSuccess: (data: any) => {
      if (data.authUrl) {
        window.open(data.authUrl, "_blank", "noopener,noreferrer");
        toast({
          title: "OAuth initiated",
          description: "Complete authentication in the new window",
        });
      }
      setConnectOpen(false);
    },
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SidebarTrigger />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Org Connections</h1>
            <p className="text-sm text-muted-foreground">
              Connect your Salesforce sandboxes and orgs
            </p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-org" size="sm">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Org
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add Salesforce Org</DialogTitle>
              <DialogDescription>
                Add a Salesforce org to deploy metadata to.
              </DialogDescription>
            </DialogHeader>
            <AddOrgForm
              onSubmit={(data) => createMutation.mutate(data)}
              isPending={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Setup Instructions */}
      <Card className="border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium">Salesforce Connected App Setup</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                To connect a Salesforce org, you need a Connected App with OAuth enabled.
                In your Salesforce org, go to Setup → App Manager → New Connected App.
                Enable OAuth Settings and add the "Full access (full)" scope. Set the callback
                URL to your app's URL + /api/oauth/callback. Copy the Consumer Key and Consumer
                Secret to use below.
              </p>
              <div className="flex gap-2 mt-3">
                <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                  <a
                    href="https://help.salesforce.com/s/articleView?id=xcloud.connected_app_create.htm"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Connected App Guide
                  </a>
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                  <a
                    href="https://help.salesforce.com/s/articleView?id=xcloud.remoteaccess_oauth_web_server_flow.htm"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    OAuth Flow Docs
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Orgs List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="h-16 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : orgs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Cloud className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium">No orgs connected</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add a Salesforce org to start deploying
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {orgs.map((org) => (
            <Card key={org.id} data-testid={`card-org-${org.id}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                        org.status === "connected"
                          ? "bg-green-100 dark:bg-green-950"
                          : "bg-slate-100 dark:bg-slate-800"
                      }`}
                    >
                      {org.status === "connected" ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : (
                        <CloudOff className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{org.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground font-mono">
                          {org.instanceUrl}
                        </span>
                        <OrgTypeBadge type={org.orgType} />
                      </div>
                      {org.connectedAt && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Connected {new Date(org.connectedAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {org.status !== "connected" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => {
                          setSelectedOrg(org);
                          setConnectOpen(true);
                        }}
                        data-testid={`button-connect-${org.id}`}
                      >
                        <LinkIcon className="h-3 w-3 mr-1" />
                        Connect
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteMutation.mutate(org.id)}
                      data-testid={`button-delete-org-${org.id}`}
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

      {/* Connect OAuth Dialog */}
      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Connect {selectedOrg?.name}
            </DialogTitle>
            <DialogDescription>
              Enter your Connected App credentials to authenticate.
            </DialogDescription>
          </DialogHeader>
          {selectedOrg && (
            <ConnectForm
              org={selectedOrg}
              onSubmit={(data) =>
                connectMutation.mutate({ orgId: selectedOrg.id, ...data })
              }
              isPending={connectMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddOrgForm({
  onSubmit,
  isPending,
}: {
  onSubmit: (data: any) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [instanceUrl, setInstanceUrl] = useState("https://");
  const [orgType, setOrgType] = useState("sandbox");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !instanceUrl) return;
    onSubmit({ name, instanceUrl, orgType, status: "disconnected" });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Org Name</Label>
        <Input
          id="name"
          data-testid="input-org-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Dev Sandbox"
          required
        />
      </div>
      <div>
        <Label htmlFor="instanceUrl">Instance URL</Label>
        <Input
          id="instanceUrl"
          data-testid="input-instance-url"
          value={instanceUrl}
          onChange={(e) => setInstanceUrl(e.target.value)}
          placeholder="https://mycompany--sandbox.sandbox.my.salesforce.com"
          required
        />
      </div>
      <div>
        <Label>Org Type</Label>
        <Select value={orgType} onValueChange={setOrgType}>
          <SelectTrigger data-testid="select-org-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sandbox">Sandbox</SelectItem>
            <SelectItem value="developer">Developer Edition</SelectItem>
            <SelectItem value="production">Production</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button
        type="submit"
        className="w-full"
        disabled={isPending || !name}
        data-testid="button-submit-org"
      >
        {isPending ? "Adding..." : "Add Org"}
      </Button>
    </form>
  );
}

function ConnectForm({
  org,
  onSubmit,
  isPending,
}: {
  org: SfOrg;
  onSubmit: (data: { clientId: string; clientSecret: string; instanceUrl: string }) => void;
  isPending: boolean;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId || !clientSecret) return;
    onSubmit({ clientId, clientSecret, instanceUrl: org.instanceUrl });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="clientId">Consumer Key (Client ID)</Label>
        <Input
          id="clientId"
          data-testid="input-client-id"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="3MVG9..."
          required
        />
      </div>
      <div>
        <Label htmlFor="clientSecret">Consumer Secret</Label>
        <Input
          id="clientSecret"
          data-testid="input-client-secret"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder="Enter consumer secret"
          required
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Your credentials are used only for the OAuth flow and are not stored permanently.
      </p>
      <Button
        type="submit"
        className="w-full"
        disabled={isPending || !clientId || !clientSecret}
        data-testid="button-submit-connect"
      >
        {isPending ? "Connecting..." : "Authenticate with Salesforce"}
      </Button>
    </form>
  );
}

function OrgTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    sandbox: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    developer: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    production: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${
        colors[type] || colors.sandbox
      }`}
    >
      {type}
    </span>
  );
}
