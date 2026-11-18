import { runPlan, type Plan, type PlanRequest } from './planner';

type Req = Omit<PlanRequest, 'id'>;

/** Envia pedidos de jogada para o Web Worker (com fallback na thread principal). */
export class AiClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { req: Req; resolve: (p: Plan) => void }>();

  constructor() {
    try {
      this.worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ id: number; plan: Plan }>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        p.resolve(e.data.plan);
      };
      this.worker.onerror = () => this.fallback();
    } catch {
      this.worker = null;
    }
  }

  private fallback(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      p.resolve(runPlan(p.req));
    }
  }

  plan(req: Req): Promise<Plan> {
    if (!this.worker) return new Promise((resolve) => setTimeout(() => resolve(runPlan(req)), 0));
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, { req, resolve });
      this.worker!.postMessage({ ...req, id });
    });
  }

  /** descarta respostas pendentes (ex.: partida reiniciada) */
  cancelAll(): void {
    this.pending.clear();
  }
}
