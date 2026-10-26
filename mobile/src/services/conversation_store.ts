type Update<T> = T | ((previous: T) => T);

export interface ConversationEntry<T> {
  key: string;
  viewId: number;
  sessionId: string | null;
  state: T;
  cancel: (() => void) | null;
  historyRequest: number;
  preserveHistory: boolean;
  preparing: boolean;
  uploads: number;
  setters: Map<keyof T, unknown>;
}

/** Owns in-flight work and drafts independently of the conversation on screen. */
export class ConversationStore<T> {
  private entries = new Map<string, ConversationEntry<T>>();
  private entryId = 0;
  active: ConversationEntry<T>;

  private listeners = new Set<() => void>();
  private revision = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): number => this.revision;

  private notify(): void {
    this.revision++;
    for (const listener of this.listeners) listener();
  }

  constructor(
    private initial: () => T,
    private canEvict: (entry: ConversationEntry<T>) => boolean = () => false,
    private maxIdleEntries = 8,
  ) {
    this.active = this.create(null);
  }

  private create(sessionId: string | null): ConversationEntry<T> {
    const viewId = ++this.entryId;
    const key = sessionId ?? `draft:${viewId}`;
    const entry: ConversationEntry<T> = {
      key,
      viewId,
      sessionId,
      state: this.initial(),
      cancel: null,
      historyRequest: 0,
      preserveHistory: false,
      preparing: false,
      uploads: 0,
      setters: new Map(),
    };
    this.entries.set(key, entry);
    return entry;
  }

  live(entry: ConversationEntry<T>): boolean {
    return this.entries.get(entry.key) === entry;
  }

  select(sessionId: string | null): ConversationEntry<T> {
    this.active =
      (sessionId && this.entries.get(sessionId)) || this.create(sessionId);
    this.entries.delete(this.active.key);
    this.entries.set(this.active.key, this.active);
    this.trimIdle();
    this.notify();
    return this.active;
  }

  private trimIdle(): void {
    const idle = [...this.entries.values()].filter(
      (entry) =>
        entry !== this.active &&
        !entry.cancel &&
        !entry.preparing &&
        entry.uploads === 0 &&
        !entry.preserveHistory &&
        this.canEvict(entry),
    );
    for (const entry of idle.slice(
      0,
      Math.max(0, idle.length - this.maxIdleEntries),
    )) {
      this.entries.delete(entry.key);
    }
  }

  adopt(entry: ConversationEntry<T>, sessionId: string): void {
    if (!this.live(entry) || entry.sessionId === sessionId) return;
    if (this.entries.has(sessionId))
      throw new Error("Conversation already exists.");
    this.entries.delete(entry.key);
    entry.key = sessionId;
    entry.sessionId = sessionId;
    this.entries.set(sessionId, entry);
    if (this.active === entry) this.notify();
  }

  patch(entry: ConversationEntry<T>, changes: Partial<T>): void {
    if (!this.live(entry)) return;
    entry.state = { ...entry.state, ...changes };
    this.trimIdle();
    if (this.active === entry) this.notify();
  }

  setter<K extends keyof T>(
    entry: ConversationEntry<T>,
    field: K,
  ): (value: Update<T[K]>) => void {
    if (!entry.setters.has(field)) {
      entry.setters.set(field, (value: Update<T[K]>) => {
        if (!this.live(entry)) return;
        const next =
          typeof value === "function"
            ? (value as (previous: T[K]) => T[K])(entry.state[field])
            : value;
        const changes: Partial<T> = {};
        changes[field] = next;
        this.patch(entry, changes);
      });
    }
    return entry.setters.get(field) as (value: Update<T[K]>) => void;
  }

  drop(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    this.entries.delete(sessionId);
    entry.cancel?.();
    if (this.active === entry) this.select(null);
  }

  cancelAll(): void {
    for (const entry of this.entries.values()) {
      entry.cancel?.();
      entry.cancel = null;
    }
  }

  reset(): void {
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) entry.cancel?.();
    this.active = this.create(null);
    this.notify();
  }
}

export type HistoryDirection = "older" | "newer" | "latest" | "target";

/** Keep a continuous, deduplicated window; SQL retains everything outside it. */
export function mergeHistoryWindow<T extends { id: string }>(
  current: {
    messages: T[];
    hasOlderHistory: boolean;
    hasNewerHistory: boolean;
  },
  page: { messages: T[]; has_older?: boolean; has_newer?: boolean },
  direction: HistoryDirection,
) {
  if (direction === "latest" || direction === "target") {
    return {
      messages: page.messages,
      hasOlderHistory: Boolean(page.has_older),
      hasNewerHistory: Boolean(page.has_newer),
    };
  }
  const ordered =
    direction === "older"
      ? [...page.messages, ...current.messages]
      : [...current.messages, ...page.messages];
  const messages = [
    ...new Map(ordered.map((message) => [message.id, message])).values(),
  ];
  const trimmed = messages.length > 200;
  return direction === "older"
    ? {
        messages: messages.slice(0, 200),
        hasOlderHistory: Boolean(page.has_older),
        hasNewerHistory: current.hasNewerHistory || trimmed,
      }
    : {
        messages: messages.slice(-200),
        hasOlderHistory: current.hasOlderHistory || trimmed,
        hasNewerHistory: Boolean(page.has_newer),
      };
}
