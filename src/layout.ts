import type { Card, Viewport } from "../shared/types";
import { boardPath, request } from "./api";

type Change = Partial<Card> & Pick<Card, "id">;
/** Keep edits until acknowledged; serialize requests so older responses cannot overwrite newer moves. */
export class LayoutSaver {
  private cards = new Map<string, Change>();
  private viewport?: Viewport;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  constructor(
    private id: string,
    private report: (state: "saved" | "saving" | "error") => void,
  ) {}
  card(change: Change) {
    this.cards.set(change.id, { ...this.cards.get(change.id), ...change });
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
    return this.cards.size > 0 || !!this.viewport || !!this.running;
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) {
      await this.running;
      return this.flush();
    }
    const cards = [...this.cards.values()];
    const viewport = this.viewport;
    if (!cards.length && !viewport) return;
    this.cards.clear();
    this.viewport = undefined;
    this.report("saving");
    this.running = (async () => {
      try {
        for (let i = 0; i < cards.length; i += 500)
          await request(`${boardPath(this.id)}/cards`, "PUT", {
            cards: cards.slice(i, i + 500),
          });
        if (viewport) await request(boardPath(this.id), "PATCH", { viewport });
      } catch (error) {
        cards.forEach((card) =>
          this.cards.set(card.id, { ...card, ...this.cards.get(card.id) }),
        );
        this.viewport ??= viewport;
        this.report("error");
        throw error;
      } finally {
        this.running = undefined;
      }
    })();
    await this.running;
    if (this.cards.size || this.viewport) return this.flush();
    this.report("saved");
  }
}
