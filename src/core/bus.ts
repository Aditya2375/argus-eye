// Tiny typed event bus used across the console.
export type Handler<T = unknown> = (payload: T) => void;

export class Bus {
  private map = new Map<string, Set<Handler<never>>>();

  on<T>(event: string, fn: Handler<T>): () => void {
    let set = this.map.get(event);
    if (!set) { set = new Set(); this.map.set(event, set); }
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  emit<T>(event: string, payload?: T): void {
    const set = this.map.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try { (fn as Handler<T>)(payload as T); } catch (err) { console.error(`[bus:${event}]`, err); }
    }
  }
}

export const bus = new Bus();
