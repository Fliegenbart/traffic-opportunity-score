import { useEffect, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ArrowLeft, ArrowRight, BookOpen, Check, RotateCcw, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { availableTutorialStep, readTutorialState, SITE_STEP, TUTORIAL_STEPS, TUTORIAL_STORAGE_KEY, type TutorialState, type TutorialTab } from "@/lib/traffic-tutorial";
import "./traffic-tutorial.css";

export default function TrafficTutorial({ hasSite, onTabChange, autoStart = true }: {
  hasSite: boolean; onTabChange: (tab: TutorialTab) => void; autoStart?: boolean;
}) {
  const [state, setState] = useState<TutorialState>(() => {
    try { return readTutorialState(localStorage.getItem(TUTORIAL_STORAGE_KEY), autoStart); }
    catch { return readTutorialState(null, autoStart); }
  });
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 1023px)").matches);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stepIndex = availableTutorialStep(state.step, hasSite);
  const step = TUTORIAL_STEPS[stepIndex];
  const last = stepIndex === TUTORIAL_STEPS.length - 1;
  const waitingForSite = stepIndex === SITE_STEP && !hasSite;
  const close = () => setState((current) => ({ ...current, enabled: false }));

  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [stepIndex, state.enabled]);

  useEffect(() => {
    try { localStorage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(state)); } catch { /* The tutorial also works when browser storage is blocked. */ }
  }, [state]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!state.enabled) return;
    if (state.step !== stepIndex) setState((current) => ({ ...current, step: stepIndex }));
    if (step.tab) onTabChange(step.tab);
  }, [state.enabled, state.step, stepIndex, step.tab, onTabChange]);

  useEffect(() => {
    if (!state.enabled) { setTarget(null); return; }
    let scrolled = false;
    const findTarget = () => {
      const element = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      setTarget(element);
      if (element && !scrolled) {
        scrolled = true;
        if (element instanceof HTMLDetailsElement) element.open = true;
        if (step.id === "overview") window.scrollTo({ top: 0, behavior: "instant" });
        else {
          element.scrollIntoView({ behavior: "instant", block: "start", inline: "nearest" });
          window.scrollBy(0, -24);
        }
      }
    };
    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [state.enabled, step.id, step.target]);

  useEffect(() => {
    if (!state.enabled || !target) return;
    target.setAttribute("data-tour-active", "true");
    return () => target.removeAttribute("data-tour-active");
  }, [state.enabled, target]);

  useEffect(() => {
    if (!state.enabled) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [state.enabled]);

  const anchor = useMemo(() => ({ current: {
    contextElement: target ?? undefined,
    getBoundingClientRect: () => mobile || !target
      ? new DOMRect(window.innerWidth / 2, window.innerHeight - 16, 0, 0)
      : target.getBoundingClientRect(),
  } }), [target, mobile]);

  return <>
    <div className="traffic-tutorial-toggle" data-tour="tutorial-control">
      <BookOpen size={16} aria-hidden="true" />
      <label htmlFor="traffic-tutorial-switch">Tutorial</label>
      <Switch ref={toggleRef} id="traffic-tutorial-switch" className="data-[state=checked]:bg-[#c6f24e] data-[state=unchecked]:bg-white/20" checked={state.enabled} onCheckedChange={(enabled) => setState((current) => ({ ...current, enabled }))} aria-label="Tutorial ein- oder ausschalten" />
    </div>
    <Popover.Root open={state.enabled} onOpenChange={(enabled) => { if (!enabled) close(); }} modal={false}>
      <Popover.Anchor virtualRef={anchor} />
      <Popover.Portal>
        <Popover.Content className="traffic-tutorial-popover" side={mobile || !target ? "top" : stepIndex === 0 ? "bottom" : "right"} align={mobile || !target ? "center" : "start"} sideOffset={12} collisionPadding={12} sticky="always"
          aria-labelledby="traffic-tutorial-title" aria-describedby="traffic-tutorial-description"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => { event.preventDefault(); if (document.activeElement === document.body || document.activeElement?.closest(".traffic-tutorial-popover")) toggleRef.current?.focus({ preventScroll: true }); }}
          onInteractOutside={(event) => event.preventDefault()}>
          <div className="traffic-tutorial-heading">
            <p className="traffic-tutorial-progress">Tutorial · {stepIndex + 1} von {TUTORIAL_STEPS.length}</p>
            <Tooltip><TooltipTrigger asChild><button type="button" className="traffic-tutorial-icon" aria-label="Tutorial ausschalten" onClick={close}><X size={18} /></button></TooltipTrigger><TooltipContent>Tutorial ausschalten</TooltipContent></Tooltip>
          </div>
          <div className="traffic-tutorial-body" ref={bodyRef}>
          <div aria-live="polite" aria-atomic="true">
            <h2 id="traffic-tutorial-title">{step.title}</h2>
            <p id="traffic-tutorial-description">{step.text}</p>
            {step.caution && <p className="traffic-tutorial-caution">{step.caution}</p>}
          </div>
          {waitingForSite && <p className="traffic-tutorial-task" role="status">Wähle einen Standort aus, um fortzufahren. Du kannst die Ortssuche und die Karte direkt benutzen.</p>}
          {!target && !waitingForSite && <p className="traffic-tutorial-task" role="status">Der Bereich ist gerade nicht sichtbar. Du kannst weitergehen oder die Führung später fortsetzen.</p>}
          </div>
          <div className="traffic-tutorial-footer">
            <Tooltip><TooltipTrigger asChild><button type="button" className="traffic-tutorial-icon" aria-label="Tutorial von vorne beginnen" disabled={stepIndex === 0} onClick={() => setState({ enabled: true, step: 0 })}><RotateCcw size={16} /></button></TooltipTrigger><TooltipContent>Von vorne beginnen</TooltipContent></Tooltip>
            <div className="traffic-tutorial-navigation">
              <button type="button" className="traffic-tutorial-back" disabled={stepIndex === 0} onClick={() => setState({ enabled: true, step: stepIndex - 1 })}><ArrowLeft size={15} /> Zurück</button>
              <button type="button" className="traffic-tutorial-next" disabled={waitingForSite} onClick={() => setState(last ? { enabled: false, step: 0 } : { enabled: true, step: stepIndex + 1 })}>{last ? <>Fertig <Check size={15} /></> : <>Weiter <ArrowRight size={15} /></>}</button>
            </div>
          </div>
          {!mobile && target && <Popover.Arrow className="traffic-tutorial-arrow" width={14} height={7} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </>;
}
