// src/stores/useInteractionSettingsStore.ts
// How the listener drives the app rather than what it plays: what the grids' action button does,
// which keys the command palette answers to, the shortcuts they define themselves, and the
// system-wide shortcuts of the desktop app.
//
// Separate from the chrome and playback stores because it is about input, not about what is on
// screen — and because the settings section that shows it is its own section for the same reason.

import { create } from 'zustand';
import { getStoredBoolean, getStoredString, setStoredBoolean } from './storagePrimitives';

/** What the grid action button's leftward slide reaches. */
export type GridActionButtonSlideTarget = 'filter' | 'command-palette';

const SLIDE_TARGET_KEY = 'grid_action_button_slide_target';
const PALETTE_HOTKEY_KEY = 'grid_command_palette_hotkey';
const QUEUE_PALETTE_KEEP_OPEN_KEY = 'queue_palette_keep_open';
// 旧版只有一条自定义快捷键，用的是这两个键。它们只读，用来把老绑定迁移到新数组。
const CUSTOM_SHORTCUT_LETTER_KEY = 'custom_shortcut_letter';
const CUSTOM_SHORTCUT_COMMAND_KEY = 'custom_shortcut_command';
const CUSTOM_SHORTCUT_BINDINGS_KEY = 'custom_shortcut_bindings';
const GLOBAL_SHORTCUT_BINDINGS_KEY = 'global_shortcut_bindings';
const GLOBAL_SHORTCUT_PORTAL_KEY = 'global_shortcut_portal_enabled';

/** How many of each kind of shortcut there are. The settings rows and the registering hook use the same count. */
export const GLOBAL_SHORTCUT_SLOTS = 5;
export const CUSTOM_SHORTCUT_SLOTS = 5;

/** The modifiers a shortcut may hold, in the order they are shown. */
export const GLOBAL_SHORTCUT_MODIFIER_IDS = ['control', 'alt', 'shift', 'meta'] as const;

export type GlobalShortcutModifier = typeof GLOBAL_SHORTCUT_MODIFIER_IDS[number];

/** What a binding gets when it never had modifiers: the trio older versions could only use. */
export const DEFAULT_GLOBAL_SHORTCUT_MODIFIERS: ReadonlyArray<GlobalShortcutModifier> = ['control', 'alt', 'shift'];

/** 旧版的自定义快捷键固定按 Alt，迁移过来的绑定按它补齐。 */
export const DEFAULT_CUSTOM_SHORTCUT_MODIFIERS: ReadonlyArray<GlobalShortcutModifier> = ['alt'];

const MODIFIER_IDS = new Set<string>(GLOBAL_SHORTCUT_MODIFIER_IDS);

/** Kept to the known modifiers, each once, in the shown order; an empty list stays empty. */
const normaliseModifiers = (value: unknown): GlobalShortcutModifier[] => {
    const given = Array.isArray(value) ? new Set(value.filter((id): id is string => typeof id === 'string' && MODIFIER_IDS.has(id))) : new Set<string>();
    return GLOBAL_SHORTCUT_MODIFIER_IDS.filter(id => given.has(id));
};

/**
 * One shortcut binding: the key and the modifiers held with it, and the command it runs. The key
 * may be null while the listener is still filling the binding in. Which values actually run is
 * decided by command-palette/globalShortcuts/globalShortcutRules (system-wide) and
 * command-palette/customShortcut (in the app); this store only keeps the shape.
 */
export type ShortcutBinding = {
    key: string | null;
    modifiers: GlobalShortcutModifier[];
    commandId: string | null;
};

export type GlobalShortcutBinding = ShortcutBinding;

export type CustomShortcutBinding = ShortcutBinding;

/** A key id as stored: a letter, a digit, `f1`–`f24`, or one of the named keys (`space`, `backspace`, …). */
const KEY_ID_PATTERN = /^[a-z0-9]+$/;

const readSlideTarget = (): GridActionButtonSlideTarget => (
    getStoredString(SLIDE_TARGET_KEY, 'filter') === 'command-palette' ? 'command-palette' : 'filter'
);

/** Stored empty means "unset"; a single lower-case letter is the only other legal value. */
const readShortcutLetter = (): string | null => {
    const stored = getStoredString(CUSTOM_SHORTCUT_LETTER_KEY, '').toLowerCase();
    return /^[a-z]$/.test(stored) ? stored : null;
};

/** Always exactly `slots` entries; anything unreadable is an empty slot with the fallback modifiers. */
const readBindings = (
    storageKey: string,
    slots: number,
    fallbackModifiers: ReadonlyArray<GlobalShortcutModifier>,
): ShortcutBinding[] => {
    let stored: unknown = null;
    try {
        stored = JSON.parse(getStoredString(storageKey, 'null'));
    } catch {
        stored = null;
    }
    const entries = Array.isArray(stored) ? stored : [];
    return Array.from({ length: slots }, (_, slot) => {
        const entry = entries[slot] as { key?: unknown; modifiers?: unknown; commandId?: unknown } | null | undefined;
        const key = typeof entry?.key === 'string' && KEY_ID_PATTERN.test(entry.key) ? entry.key : null;
        // A binding stored before the modifiers could be chosen had none written down.
        const modifiers = Array.isArray(entry?.modifiers)
            ? normaliseModifiers(entry?.modifiers)
            : [...fallbackModifiers];
        const commandId = typeof entry?.commandId === 'string' && entry.commandId ? entry.commandId : null;
        return { key, modifiers, commandId };
    });
};

/**
 * 新格式里还没有任何条目时，把旧版那一条 Alt+字母 搬进第一个槽位。旧的两个存储键之后不再写，
 * 迁移过一次就清掉，免得清空新列表后老绑定又冒出来。
 */
const readCustomShortcutBindings = (): ShortcutBinding[] => {
    const bindings = readBindings(CUSTOM_SHORTCUT_BINDINGS_KEY, CUSTOM_SHORTCUT_SLOTS, DEFAULT_CUSTOM_SHORTCUT_MODIFIERS);
    if (bindings.some(binding => binding.key || binding.commandId)) {
        return bindings;
    }
    const letter = readShortcutLetter();
    const commandId = getStoredString(CUSTOM_SHORTCUT_COMMAND_KEY, '') || null;
    if (!letter && !commandId) {
        return bindings;
    }
    return [
        { key: letter, modifiers: [...DEFAULT_CUSTOM_SHORTCUT_MODIFIERS], commandId },
        ...bindings.slice(1),
    ];
};

const writeString = (key: string, value: string | null) => {
    if (typeof window === 'undefined') {
        return;
    }
    if (value) {
        localStorage.setItem(key, value);
    } else {
        localStorage.removeItem(key);
    }
};

/** Only a list with something in it is written; an empty one removes the key. */
const writeBindings = (storageKey: string, bindings: ReadonlyArray<ShortcutBinding>) => (
    writeString(storageKey, bindings.some(binding => binding.key || binding.commandId) ? JSON.stringify(bindings) : null)
);

/** One slot changed, everything else kept. Returns the same list when the slot is out of range. */
const patchBindings = (
    bindings: ReadonlyArray<ShortcutBinding>,
    slots: number,
    slot: number,
    patch: Partial<ShortcutBinding>,
    empty: ShortcutBinding,
): ReadonlyArray<ShortcutBinding> => {
    if (slot < 0 || slot >= slots) {
        return bindings;
    }
    const key = patch.key === undefined ? undefined : (patch.key && KEY_ID_PATTERN.test(patch.key.toLowerCase()) ? patch.key.toLowerCase() : null);
    const modifiers = patch.modifiers === undefined ? undefined : normaliseModifiers(patch.modifiers);
    return bindings.map((binding, index) => (
        index === slot
            ? {
                ...empty,
                ...binding,
                ...patch,
                ...(key === undefined ? {} : { key }),
                ...(modifiers === undefined ? {} : { modifiers }),
            }
            : binding
    ));
};

export type InteractionSettingsState = {
    gridActionButtonSlideTarget: GridActionButtonSlideTarget;
    /**
     * Whether bare `s` on a filtering surface opens the command list instead of being read as
     * filter input. Off by default: typing a letter on a grid has always meant "filter", and the
     * listener who wants the other meaning is the one who should have to ask for it.
     */
    gridCommandPaletteHotkey: boolean;
    /** Keep the queue surface and its query after choosing a song. */
    queuePaletteKeepOpen: boolean;
    /** 应用内的自定义快捷键：每一条都是「组合键 + 命令」。 */
    customShortcutBindings: ShortcutBinding[];
    /** The desktop app's system-wide shortcuts. */
    globalShortcutBindings: ShortcutBinding[];
    /**
     * Native Wayland only: whether the playback commands are handed to the desktop's shortcut
     * portal. Off until the listener asks, because registering makes the desktop show its own
     * prompt or list; the bindings above are not used there, the desktop picks the keys.
     */
    globalShortcutPortalEnabled: boolean;

    setGridActionButtonSlideTarget: (target: GridActionButtonSlideTarget) => void;
    handleToggleGridCommandPaletteHotkey: (enable: boolean) => void;
    setQueuePaletteKeepOpen: (enable: boolean) => void;
    setCustomShortcutBinding: (slot: number, patch: Partial<ShortcutBinding>) => void;
    setGlobalShortcutBinding: (slot: number, patch: Partial<ShortcutBinding>) => void;
    setGlobalShortcutPortalEnabled: (enable: boolean) => void;
};

const EMPTY_BINDING: ShortcutBinding = { key: null, modifiers: [...DEFAULT_GLOBAL_SHORTCUT_MODIFIERS], commandId: null };
const EMPTY_CUSTOM_BINDING: ShortcutBinding = { key: null, modifiers: [...DEFAULT_CUSTOM_SHORTCUT_MODIFIERS], commandId: null };

export const useInteractionSettingsStore = create<InteractionSettingsState>((set) => ({
    gridActionButtonSlideTarget: readSlideTarget(),
    gridCommandPaletteHotkey: getStoredBoolean(PALETTE_HOTKEY_KEY, false),
    queuePaletteKeepOpen: getStoredBoolean(QUEUE_PALETTE_KEEP_OPEN_KEY, false),
    customShortcutBindings: readCustomShortcutBindings(),
    globalShortcutBindings: readBindings(GLOBAL_SHORTCUT_BINDINGS_KEY, GLOBAL_SHORTCUT_SLOTS, DEFAULT_GLOBAL_SHORTCUT_MODIFIERS),
    globalShortcutPortalEnabled: getStoredBoolean(GLOBAL_SHORTCUT_PORTAL_KEY, false),

    setGridActionButtonSlideTarget: (target) => {
        writeString(SLIDE_TARGET_KEY, target);
        set({ gridActionButtonSlideTarget: target });
    },
    handleToggleGridCommandPaletteHotkey: (enable) => {
        setStoredBoolean(PALETTE_HOTKEY_KEY, enable);
        set({ gridCommandPaletteHotkey: enable });
    },
    setQueuePaletteKeepOpen: (enable) => {
        setStoredBoolean(QUEUE_PALETTE_KEEP_OPEN_KEY, enable);
        set({ queuePaletteKeepOpen: enable });
    },
    setCustomShortcutBinding: (slot, patch) => set((state) => {
        const bindings = patchBindings(state.customShortcutBindings, CUSTOM_SHORTCUT_SLOTS, slot, patch, EMPTY_CUSTOM_BINDING);
        if (bindings === state.customShortcutBindings) {
            return state;
        }
        // 迁移已经落到新数组上，旧的两个键不再需要，清掉免得清空列表后老绑定重新出现。
        writeString(CUSTOM_SHORTCUT_LETTER_KEY, null);
        writeString(CUSTOM_SHORTCUT_COMMAND_KEY, null);
        writeBindings(CUSTOM_SHORTCUT_BINDINGS_KEY, bindings);
        return { customShortcutBindings: bindings as ShortcutBinding[] };
    }),
    setGlobalShortcutBinding: (slot, patch) => set((state) => {
        const bindings = patchBindings(state.globalShortcutBindings, GLOBAL_SHORTCUT_SLOTS, slot, patch, EMPTY_BINDING);
        if (bindings === state.globalShortcutBindings) {
            return state;
        }
        writeBindings(GLOBAL_SHORTCUT_BINDINGS_KEY, bindings);
        return { globalShortcutBindings: bindings as ShortcutBinding[] };
    }),
    setGlobalShortcutPortalEnabled: (enable) => {
        setStoredBoolean(GLOBAL_SHORTCUT_PORTAL_KEY, enable);
        set({ globalShortcutPortalEnabled: enable });
    },
}));
