import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TenantProvider } from "@/lib/tenant";
import TrafficOpportunity from "@/pages/traffic-opportunity";
import KorridorReport from "@/pages/korridor-report";
import Standort from "@/pages/standort";
import Tour from "@/pages/tour";
import NotFound from "@/pages/not-found";

// Old shared links (tabs, regions, sections, embeds) keep opening the full analysis view.
const ANALYSIS_PARAMS = ["tab", "region", "strecke", "korridor", "standorte", "embed"];
function Home() {
  const params = new URLSearchParams(window.location.search);
  return ANALYSIS_PARAMS.some((p) => params.has(p)) ? <TrafficOpportunity /> : <Standort />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/traffic-opportunity" component={Home} />
      <Route path="/analyse" component={TrafficOpportunity} />
      <Route path="/korridor-report" component={KorridorReport} />
      <Route path="/tour" component={Tour} />
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
