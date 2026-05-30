import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TenantProvider } from "@/lib/tenant";
import Home from "@/pages/home";
import DepotReadiness from "@/pages/depot-readiness";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={DepotReadiness} />
      <Route path="/tco" component={Home} />
      <Route path="/embed" component={Home} />
      <Route path="/depot-readiness" component={DepotReadiness} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </TenantProvider>
    </QueryClientProvider>
  );
}

export default App;
