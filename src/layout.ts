import type { Card, Viewport } from "../shared/types";
import type { CanvasObject } from "../shared/types";
import { boardPath, request } from "./api";
type Change<T> = Partial<T> & { id: string };
/** Changes remain queued until acknowledged; geometry and content writes are serialized. */
export class LayoutSaver {
  private cards = new Map<string, Change<Card>>();
  private objects = new Map<string, Change<CanvasObject>>();
  private edits = new Map<string, Change<CanvasObject>>();
  private viewport?: Viewport;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  constructor(
    private id: string,
    private report: (state: "saved" | "saving" | "error") => void,
  ) {}
  card(change: Change<Card>) {
    this.cards.set(change.id, { ...this.cards.get(change.id), ...change });
    this.schedule();
  }
  object(change: Change<CanvasObject>) {
    this.objects.set(change.id, { ...this.objects.get(change.id), ...change });
    this.schedule();
  }
  edit(change: Change<CanvasObject>) {
    this.edits.set(change.id, { ...this.edits.get(change.id), ...change });
    this.schedule();
  }
  view(viewport: Viewport) {
    this.viewport = viewport;
    this.schedule();
  }
  private schedule() {
    this.report("saving");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, 300);
  }
  get dirty() {
    return (
      this.cards.size > 0 ||
      this.objects.size > 0 ||
      this.edits.size > 0 ||
      !!this.viewport ||
      !!this.running
    );
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) {
      await this.running;
      return this.flush();
    }
    const cards = [...this.cards.values()],
      objects = [...this.objects.values()],
      edits = [...this.edits.values()],
      viewport = this.viewport;
    if (!cards.length && !objects.length && !edits.length && !viewport) return;
    this.cards.clear();
    this.objects.clear();
    this.edits.clear();
    this.viewport = undefined;
    this.report("saving");
    this.running = (async () => {
      try {
        for (const [kind, changes] of [
          ["cards", cards],
          ["objects", objects],
        ] as const) {
          for (let i = 0; i < changes.length; i += 500)
            await request(`${boardPath(this.id)}/${kind}`, "PUT", {
              [kind]: changes.slice(i, i + 500),
            });
        }
        for (const { id, ...edit } of edits)
          await request(
            `${boardPath(this.id)}/objects/${encodeURIComponent(id)}`,
            "PATCH",
            edit,
          );
        if (viewport) await request(boardPath(this.id), "PATCH", { viewport });
      } catch (error) {
        cards.forEach((c) =>
          this.cards.set(c.id, { ...c, ...this.cards.get(c.id) }),
        );
        objects.forEach((o) =>
          this.objects.set(o.id, { ...o, ...this.objects.get(o.id) }),
        );
        edits.forEach((o) =>
          this.edits.set(o.id, { ...o, ...this.edits.get(o.id) }),
        );
        this.viewport ??= viewport;
        this.report("error");
        throw error;
      } finally {
        this.running = undefined;
      }
    })();
    await this.running;
    if (this.dirty) return this.flush();
    this.report("saved");
  }
}
