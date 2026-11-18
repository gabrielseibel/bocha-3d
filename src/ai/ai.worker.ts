/// <reference lib="webworker" />
import { runPlan, type PlanRequest } from './planner';

// A IA roda num Web Worker para que dezenas de simulações não travem a animação.
self.onmessage = (e: MessageEvent<PlanRequest>) => {
  const { id, ...req } = e.data;
  const plan = runPlan(req);
  (self as unknown as Worker).postMessage({ id, plan });
};
