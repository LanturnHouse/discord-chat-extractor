import { act } from '@testing-library/react';
import { expect, vi } from 'vitest';
import type { Locale } from '@/app/i18n';
import { appStore } from '@/app/state/store';
import type { DiscordClient } from '@/lib/discord/client';
import { createMockClient, MOCK_ME } from '@/lib/discord/mock';
import type { Snowflake } from '@/lib/discord/types';

/** Boots the app singleton (the store components read) on a zero-latency demo client; English unless told otherwise. */
export async function bootApp(options: { locale?: Locale; client?: DiscordClient } = {}): Promise<DiscordClient> {
  const client = options.client ?? createMockClient({ latencyMs: 0 });
  appStore.setState(appStore.getInitialState(), true);
  await appStore.getState().initWithClient(client, MOCK_ME);
  appStore.setState({ locale: options.locale ?? 'en' });
  return client;
}

/** Lets every pending promise chain of the store (mock latency 0) finish, inside `act`. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

/** Makes `getGuildChannels` wait until `release()` is called, so the loading state can be inspected. */
export function gateGuildChannels(client: DiscordClient): { release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = client.getGuildChannels.bind(client);
  vi.spyOn(client, 'getGuildChannels').mockImplementation(async (guildId: Snowflake, signal?: AbortSignal) => {
    await gate;
    return original(guildId, signal);
  });
  return { release };
}

/** Components must render without React warnings (keys, nesting, act...): spy on the console and assert at the end of a test. */
export function trackConsole(): { expectQuiet: () => void; restore: () => void } {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  return {
    expectQuiet() {
      expect(error.mock.calls, 'console.error').toEqual([]);
      expect(warn.mock.calls, 'console.warn').toEqual([]);
    },
    restore() {
      error.mockRestore();
      warn.mockRestore();
    },
  };
}
