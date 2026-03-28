import type {
  CompanionEvent,
  CompanionEventMap,
  CompanionEventType,
} from "./events";

type EventHandler<K extends CompanionEventType> = (
  event: CompanionEvent<K>,
) => void;

class CompanionEventBus {
  private readonly target = new EventTarget();

  emit<K extends CompanionEventType>(
    type: K,
    payload: CompanionEventMap[K],
  ): void {
    const event: CompanionEvent<K> = {
      type,
      payload,
      timestamp: Date.now(),
    };

    this.target.dispatchEvent(new CustomEvent(type, { detail: event }));
  }

  subscribe<K extends CompanionEventType>(
    type: K,
    handler: EventHandler<K>,
  ): () => void {
    const listener = (event: Event) => {
      handler((event as CustomEvent<CompanionEvent<K>>).detail);
    };

    this.target.addEventListener(type, listener);

    return () => {
      this.target.removeEventListener(type, listener);
    };
  }
}

export const companionEventBus = new CompanionEventBus();
