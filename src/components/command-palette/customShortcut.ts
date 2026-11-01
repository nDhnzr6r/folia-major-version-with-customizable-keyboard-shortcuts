import { CUSTOM_SHORTCUT_SLOTS, type CustomShortcutBinding } from '../../stores/useInteractionSettingsStore';
import { isGlobalShortcutKey, toGlobalShortcutAccelerator } from './globalShortcuts/globalShortcutRules';
import type { CommandPaletteCommand } from './types';

// src/components/command-palette/customShortcut.ts
// The shortcuts the listener defines themselves, running commands inside the app. Each is a
// combination of modifiers and one key, like the system-wide shortcuts, but it only fires while the
// app has the keyboard.
//
// Everything here is a single judgement asked by two callers — the settings picker, to decide what
// it may offer, and the keyboard dispatcher, to decide what may fire. Splitting them would let a
// binding that the picker refuses still fire from a value already in storage.

/** The palette's own entries, which are not in the registry to be found. */
const BUILT_IN_HOTKEYS: ReadonlyArray<{ key: string; ctrl?: boolean }> = [
    { key: 's' },
    { key: 'k', ctrl: true },
];

const hotkeyAccelerator = (hotkey: { key: string; alt?: boolean; ctrl?: boolean }): string => toGlobalShortcutAccelerator(
    hotkey.key.toLowerCase(),
    [
        ...(hotkey.ctrl ? ['control'] as const : []),
        ...(hotkey.alt ? ['alt'] as const : []),
    ],
);

/**
 * Every combination that already opens something. Computed rather than listed, so a hotkey added to
 * the registry tomorrow is reserved the same day — which is the whole point of checking at all.
 */
export const collectReservedShortcutStrokes = (commands: CommandPaletteCommand[]): Set<string> => {
    const strokes = new Set<string>(BUILT_IN_HOTKEYS.map(hotkeyAccelerator));
    for (const command of commands) {
        if (command.openHotkey) {
            strokes.add(hotkeyAccelerator(command.openHotkey));
        }
    }
    return strokes;
};

/**
 * Whether this command works wherever the palette happens to be.
 *
 * A custom shortcut fires from anywhere, so a command that needs particular surroundings must not
 * be bindable to one — the listener would define a key that does nothing half the time. That fact
 * is declared on the command itself, so this is a read rather than a probe.
 */
export const isScopeIndependentCommand = (command: CommandPaletteCommand): boolean => !command.scope;

export type CustomShortcutRefusal = 'needs-modifier' | 'unsupported-key' | 'reserved' | 'duplicate';

/** Why `key` with `modifiers` cannot go in `slot`, or null when it can. */
export const refuseCustomShortcutChord = (
    key: string,
    modifiers: ReadonlyArray<CustomShortcutBinding['modifiers'][number]>,
    slot: number,
    bindings: ReadonlyArray<CustomShortcutBinding>,
    commands: CommandPaletteCommand[],
): CustomShortcutRefusal | null => {
    if (!isGlobalShortcutKey(key)) {
        return 'unsupported-key';
    }
    if (modifiers.length === 0) {
        return 'needs-modifier';
    }
    const accelerator = toGlobalShortcutAccelerator(key, modifiers);
    if (collectReservedShortcutStrokes(commands).has(accelerator)) {
        return 'reserved';
    }
    const taken = bindings.some((binding, index) => index !== slot && binding.key
        && toGlobalShortcutAccelerator(binding.key, binding.modifiers) === accelerator);
    return taken ? 'duplicate' : null;
};

export type ActiveCustomShortcut = {
    slot: number;
    accelerator: string;
    command: CommandPaletteCommand;
};

/**
 * The bindings that actually run: both halves set, a combination the picker would take, and a
 * command that works anywhere and is still in the registry. A slot whose combination repeats an
 * earlier slot's stays quiet rather than fighting it.
 */
export const resolveActiveCustomShortcuts = (
    bindings: ReadonlyArray<CustomShortcutBinding>,
    commands: CommandPaletteCommand[],
): ActiveCustomShortcut[] => {
    const reserved = collectReservedShortcutStrokes(commands);
    const active: ActiveCustomShortcut[] = [];
    const seen = new Set<string>();
    bindings.slice(0, CUSTOM_SHORTCUT_SLOTS).forEach((binding, slot) => {
        const { key, commandId } = binding;
        if (!key || !commandId || !isGlobalShortcutKey(key) || binding.modifiers.length === 0) {
            return;
        }
        const accelerator = toGlobalShortcutAccelerator(key, binding.modifiers);
        if (reserved.has(accelerator) || seen.has(accelerator)) {
            return;
        }
        const command = commands.find(entry => entry.id === commandId);
        if (!command || !isScopeIndependentCommand(command)) {
            return;
        }
        seen.add(accelerator);
        active.push({ slot, accelerator, command });
    });
    return active;
};

/** The command a pressed accelerator runs, or null when no current binding has it. */
export const commandForCustomShortcut = (
    active: ReadonlyArray<ActiveCustomShortcut>,
    accelerator: string,
): CommandPaletteCommand | null => active.find(shortcut => shortcut.accelerator === accelerator)?.command ?? null;
