import { afterEach, describe, expect, it, vi } from 'vitest';
import type { useInteractionSettingsStore as StoreHook } from '@/stores/useInteractionSettingsStore';

// test/unit/stores/customShortcutBindings.test.ts
// How the in-app custom shortcut bindings are stored: always five slots, the old single Alt+letter
// binding moves into the first slot with its modifiers filled in, the old keys are cleared once the
// new list is written, and clearing every slot removes the stored value.

const KEY = 'custom_shortcut_bindings';
const LETTER_KEY = 'custom_shortcut_letter';
const COMMAND_KEY = 'custom_shortcut_command';
const ALT = ['alt'];
let storage: Map<string, string>;

const loadStore = async (initial: Record<string, string> = {}): Promise<typeof StoreHook> => {
    vi.resetModules();
    storage = new Map(Object.entries(initial));
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, String(value)); },
        removeItem: (key: string) => { storage.delete(key); },
    });
    return (await import('@/stores/useInteractionSettingsStore')).useInteractionSettingsStore;
};

const EMPTY = { key: null, modifiers: ALT, commandId: null };

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('custom shortcut bindings', () => {
    it('starts with five empty slots', async () => {
        const store = await loadStore();
        expect(store.getState().customShortcutBindings).toEqual([EMPTY, EMPTY, EMPTY, EMPTY, EMPTY]);
    });

    it('reads malformed or non-array storage as five empty slots', async () => {
        for (const stored of ['{not json', '"p"', '{"key":"p"}', '42']) {
            const store = await loadStore({ [KEY]: stored });
            expect(store.getState().customShortcutBindings, stored).toEqual([EMPTY, EMPTY, EMPTY, EMPTY, EMPTY]);
        }
    });

    it('moves the old single Alt+letter binding into the first slot', async () => {
        const store = await loadStore({ [LETTER_KEY]: 'j', [COMMAND_KEY]: 'navigate-player' });
        expect(store.getState().customShortcutBindings[0]).toEqual({ key: 'j', modifiers: ALT, commandId: 'navigate-player' });
        expect(store.getState().customShortcutBindings).toHaveLength(5);
    });

    it('prefers the new list once it has anything in it', async () => {
        const store = await loadStore({
            [LETTER_KEY]: 'j',
            [COMMAND_KEY]: 'navigate-player',
            [KEY]: JSON.stringify([{ key: 'k', modifiers: ['control'], commandId: 'playback-mute' }]),
        });
        expect(store.getState().customShortcutBindings[0]).toEqual({ key: 'k', modifiers: ['control'], commandId: 'playback-mute' });
    });

    it('keeps legal entries, empties illegal ones, and pads a short list', async () => {
        const store = await loadStore({
            [KEY]: JSON.stringify([
                { key: 'n', modifiers: ['shift', 'nonsense'], commandId: 'playback-next' },
                { key: 'J', commandId: 'playback-toggle' },
                null,
            ]),
        });
        expect(store.getState().customShortcutBindings.slice(0, 3)).toEqual([
            { key: 'n', modifiers: ['shift'], commandId: 'playback-next' },
            { key: null, modifiers: ALT, commandId: 'playback-toggle' },
            EMPTY,
        ]);
        expect(store.getState().customShortcutBindings).toHaveLength(5);
    });

    it('writes the new list, clears the old keys, and removes the value when every slot is empty', async () => {
        const store = await loadStore({ [LETTER_KEY]: 'j', [COMMAND_KEY]: 'navigate-player' });
        store.getState().setCustomShortcutBinding(1, { key: 'K', modifiers: ['control', 'shift'], commandId: 'playback-toggle' });

        expect(storage.has(LETTER_KEY)).toBe(false);
        expect(storage.has(COMMAND_KEY)).toBe(false);
        expect(JSON.parse(storage.get(KEY) ?? 'null')[1]).toEqual({ key: 'k', modifiers: ['control', 'shift'], commandId: 'playback-toggle' });

        store.getState().setCustomShortcutBinding(0, { key: null, commandId: null });
        store.getState().setCustomShortcutBinding(1, { key: null, commandId: null });
        expect(storage.has(KEY)).toBe(false);
        // 旧绑定不会因为清空而重新出现。
        expect((await loadStore({ [LETTER_KEY]: '', [COMMAND_KEY]: '' })).getState().customShortcutBindings[0]).toEqual(EMPTY);
    });

    it('ignores a slot out of range', async () => {
        const store = await loadStore();
        store.getState().setCustomShortcutBinding(9, { key: 'x' });
        expect(store.getState().customShortcutBindings).toEqual([EMPTY, EMPTY, EMPTY, EMPTY, EMPTY]);
    });
});
