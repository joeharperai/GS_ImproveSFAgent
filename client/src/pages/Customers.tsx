import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Plus, Building, Pencil, Trash2 } from "lucide-react";
import type { Customer, SfOrg } from "@shared/schema";

const INDUSTRIES = [
  "Financial Services",
  "Healthcare",
  "Retail",
  "Technology",
  "Manufacturing",
  "Education",
  "Government",
  "Nonprofit",
  "Other",
];

export default function Customers() {
  const [open, setOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const { toast } = useToast();

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
    queryFn: () => apiRequest("GET", "/api/customers").then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest("POST", "/api/customers", data).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setOpen(false);
      toast({ title: "Customer created" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create customer", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest("PATCH", `/api/customers/${id}`, data).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setEditCustomer(null);
      toast({ title: "Customer updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update customer", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/customers/${id}`).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Customer deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete customer", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SidebarTrigger />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Customers</h1>
            <p className="text-sm text-muted-foreground">
              Manage your customer accounts and their org connections
            </p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-customer" size="sm">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Customer
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add Customer</DialogTitle>
              <DialogDescription>
                Create a new customer account to group Salesforce orgs.
              </DialogDescription>
            </DialogHeader>
            <CustomerForm
              onSubmit={(data) => createMutation.mutate(data)}
              isPending={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editCustomer} onOpenChange={(v) => !v && setEditCustomer(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Customer</DialogTitle>
            <DialogDescription>
              Update customer details.
            </DialogDescription>
          </DialogHeader>
          {editCustomer && (
            <CustomerForm
              initial={editCustomer}
              onSubmit={(data) => updateMutation.mutate({ id: editCustomer.id, data })}
              isPending={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="h-24 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : customers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Building className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium">No customers yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add a customer to start grouping Salesforce orgs
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {customers.map((customer) => (
            <CustomerCard
              key={customer.id}
              customer={customer}
              onEdit={() => setEditCustomer(customer)}
              onDelete={() => deleteMutation.mutate(customer.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CustomerCard({
  customer,
  onEdit,
  onDelete,
}: {
  customer: Customer;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { data: orgs = [] } = useQuery<SfOrg[]>({
    queryKey: [`/api/customers/${customer.id}/orgs`],
    queryFn: () =>
      apiRequest("GET", `/api/customers/${customer.id}/orgs`).then((r) => r.json()),
  });

  const connectedCount = orgs.filter((o) => o.status === "connected").length;

  return (
    <Card data-testid={`card-customer-${customer.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5 min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium truncate">{customer.name}</p>
              {customer.industry && (
                <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 shrink-0">
                  {customer.industry}
                </span>
              )}
            </div>
            {(customer.contactName || customer.contactEmail) && (
              <p className="text-xs text-muted-foreground truncate">
                {customer.contactName}
                {customer.contactName && customer.contactEmail && " · "}
                {customer.contactEmail}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {orgs.length} org{orgs.length !== 1 ? "s" : ""} ({connectedCount} connected)
            </p>
            <p className="text-xs text-muted-foreground">
              Created {new Date(customer.createdAt).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={onEdit}
              data-testid={`button-edit-customer-${customer.id}`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              data-testid={`button-delete-customer-${customer.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CustomerForm({
  initial,
  onSubmit,
  isPending,
}: {
  initial?: Customer;
  onSubmit: (data: any) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [industry, setIndustry] = useState(initial?.industry || "");
  const [contactName, setContactName] = useState(initial?.contactName || "");
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail || "");
  const [notes, setNotes] = useState(initial?.notes || "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    onSubmit({
      name,
      industry: industry || null,
      contactName: contactName || null,
      contactEmail: contactEmail || null,
      notes: notes || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="form-customer">
      <div>
        <Label htmlFor="customer-name">Name</Label>
        <Input
          id="customer-name"
          data-testid="input-customer-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Acme Corp"
          required
        />
      </div>
      <div>
        <Label htmlFor="customer-industry">Industry</Label>
        <Select value={industry} onValueChange={setIndustry}>
          <SelectTrigger data-testid="select-customer-industry">
            <SelectValue placeholder="Select industry (optional)" />
          </SelectTrigger>
          <SelectContent>
            {INDUSTRIES.map((ind) => (
              <SelectItem key={ind} value={ind}>
                {ind}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="customer-contact-name">Contact Name</Label>
        <Input
          id="customer-contact-name"
          data-testid="input-customer-contact-name"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
          placeholder="e.g., John Smith"
        />
      </div>
      <div>
        <Label htmlFor="customer-contact-email">Contact Email</Label>
        <Input
          id="customer-contact-email"
          data-testid="input-customer-contact-email"
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder="e.g., john@acme.com"
        />
      </div>
      <div>
        <Label htmlFor="customer-notes">Notes</Label>
        <Textarea
          id="customer-notes"
          data-testid="input-customer-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes about this customer"
          rows={3}
        />
      </div>
      <Button
        type="submit"
        className="w-full"
        disabled={isPending || !name}
        data-testid="button-submit-customer"
      >
        {isPending ? "Saving..." : initial ? "Update Customer" : "Add Customer"}
      </Button>
    </form>
  );
}
