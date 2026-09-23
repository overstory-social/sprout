// The engine's own messages, and what each passes a handler (the spec's
// Events and Names › Reserved names).
//
// This is the one list of them: the checker binds a handler's parameters
// from it, and a message declaration is refused when it takes one of
// these names, from a world or a library alike.

/** An engine message: its name, and what it passes in the order the engine passes them. */
export interface EngineMessage {
  readonly name: string;
  /** `integer` is `elapsed`; the rest are objects. */
  readonly parameters: readonly { readonly name: string; readonly binds: 'object' | 'integer' }[];
}

export const ENGINE_MESSAGES: readonly EngineMessage[] = [
  { name: 'entered', parameters: [object_('item'), object_('from')] },
  { name: 'left', parameters: [object_('item'), object_('to')] },
  { name: 'moved', parameters: [object_('from'), object_('to')] },
  { name: 'arrived', parameters: [object_('actor'), object_('from')] },
  { name: 'departed', parameters: [object_('actor'), object_('to')] },
  { name: 'spawned', parameters: [object_('from')] },
  { name: 'tick', parameters: [{ name: 'elapsed', binds: 'integer' }] },
  { name: 'woke', parameters: [{ name: 'elapsed', binds: 'integer' }] },
];

function object_(name: string): { readonly name: string; readonly binds: 'object' } {
  return { name, binds: 'object' };
}

/** One of the engine's messages by name, or null for an authored one. */
export function engineMessage(name: string): EngineMessage | null {
  return ENGINE_MESSAGES.find((message) => message.name === name) ?? null;
}
