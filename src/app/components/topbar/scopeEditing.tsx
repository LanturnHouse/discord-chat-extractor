import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useAppStore } from '@/app/state';
import type { Snowflake } from '@/lib/discord/types';
import type { ScopeFields } from './scopeFields';

/** Asks the selection list to open (its popover and the settings of one row); `nonce` makes a repeated request for the same row a new one. */
export interface ChannelFocusRequest {
  channelId: Snowflake;
  nonce: number;
}

/**
 * What the scope inputs hold while it cannot be exported yet, shared by the parts of the top bar that must agree on it.
 * The stores only ever receive valid scopes, so input that is not valid yet lives here: it outlives the popover it was typed
 * in, makes the Download button refuse to start, and marks the row of the channel it belongs to.
 */
export interface ScopeEditing {
  /** The default settings' inputs (null = they show what is stored). */
  globalDraft: ScopeFields | null;
  setGlobalDraft(draft: ScopeFields | null): void;
  /** Per channel, only for channels that have settings of their own. */
  channelDrafts: Readonly<Record<Snowflake, ScopeFields>>;
  setChannelDraft(channelId: Snowflake, draft: ScopeFields | null): void;
  focusRequest: ChannelFocusRequest | null;
  /** The Download button refused to start because of this channel's settings: open them. */
  requestChannelFocus(channelId: Snowflake): void;
}

const ScopeEditingContext = createContext<ScopeEditing | null>(null);

export function useScopeEditing(): ScopeEditing {
  const value = useContext(ScopeEditingContext);
  if (value === null) throw new Error('useScopeEditing must be used inside <ScopeEditingProvider> (the TopBar provides it).');
  return value;
}

/** The drafts whose channel still has an override; the very same object when none has to go. */
function keepOwned(drafts: Record<Snowflake, ScopeFields>, overrides: Readonly<Record<Snowflake, unknown>>): Record<Snowflake, ScopeFields> {
  const kept = Object.entries(drafts).filter(([channelId]) => Object.hasOwn(overrides, channelId));
  return kept.length === Object.keys(drafts).length ? drafts : Object.fromEntries(kept);
}

export function ScopeEditingProvider({ children }: { children: ReactNode }): ReactElement {
  const overrides = useAppStore((state) => state.exportOverrides);
  const [globalDraft, setGlobalDraft] = useState<ScopeFields | null>(null);
  const [drafts, setDrafts] = useState<Record<Snowflake, ScopeFields>>({});
  const [focusRequest, setFocusRequest] = useState<ChannelFocusRequest | null>(null);

  // A channel that left the selection (or went back to the default settings) takes its draft with it, so selecting it again starts clean.
  useEffect(() => {
    setDrafts((current) => keepOwned(current, overrides));
  }, [overrides]);
  const channelDrafts = useMemo(() => keepOwned(drafts, overrides), [drafts, overrides]);

  const setChannelDraft = useCallback((channelId: Snowflake, draft: ScopeFields | null) => {
    setDrafts((current) => {
      if (draft !== null) return { ...current, [channelId]: draft };
      if (!Object.hasOwn(current, channelId)) return current;
      const next = { ...current };
      delete next[channelId];
      return next;
    });
  }, []);
  const requestChannelFocus = useCallback((channelId: Snowflake) => {
    setFocusRequest((current) => ({ channelId, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  const value = useMemo<ScopeEditing>(
    () => ({ globalDraft, setGlobalDraft, channelDrafts, setChannelDraft, focusRequest, requestChannelFocus }),
    [globalDraft, channelDrafts, setChannelDraft, focusRequest, requestChannelFocus],
  );
  return <ScopeEditingContext.Provider value={value}>{children}</ScopeEditingContext.Provider>;
}
