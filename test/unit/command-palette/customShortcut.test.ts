import { describe, expect, it } from 'vitest';
import { COMMAND_PALETTE_COMMANDS } from '../../../src/components/command-palette/commandRegistry';
import {
    collectReservedShortcutStrokes,
    commandForCustomShortcut,
    isScopeIndependentCommand,
    refuseCustomShortcutChord,
    resolveActiveCustomShortcuts,
    shortcutAccelerator,
} from '../../../src/components/command-palette/customShortcut';
import type { CommandPaletteCommand } from '../../../src/components/command-palette/types';
import type { ShortcutBinding } from '../../../src/stores/useInteractionSettingsStore';

// test/unit/command-palette/customShortcut.test.ts
// 自定义快捷键的规则：组合键不能撞上已有快捷键、只能绑在任何界面都可用的命令上、
// 存进去的值不算数——每次都重新判定。后两条是防御性的：一个「当时合法、后来被占用」
// 的绑定必须自己安静下来，而不是和新主人打架。

const commandWith = (overrides: Partial<CommandPaletteCommand>): CommandPaletteCommand => ({
    id: 'test-command',
    group: 'playback',
    title: 'Test',
    description: 'Test',
    keywords: [],
    execute: () => true,
    ...overrides,
});

const binding = (overrides: Partial<ShortcutBinding> = {}): ShortcutBinding => ({
    key: null,
    modifiers: ['alt'],
    commandId: null,
    ...overrides,
});

describe('reserved strokes', () => {
    it('includes the palette entries that are not in the registry to be found', () => {
        const strokes = collectReservedShortcutStrokes(COMMAND_PALETTE_COMMANDS);
        expect(strokes.has('S')).toBe(true);
        expect(strokes.has('Control+K')).toBe(true);
        // 应用自己占着的组合：切歌与开发者面板。
        expect(strokes.has('Control+Left')).toBe(true);
        expect(strokes.has('Alt+Shift+D')).toBe(true);
    });

    it('is computed from the registry, so a new hotkey reserves itself', () => {
        const strokes = collectReservedShortcutStrokes([
            commandWith({ id: 'a', openHotkey: { key: 'p', ctrl: true } }),
            commandWith({ id: 'b', openHotkey: { key: 'j', alt: true } }),
        ]);
        expect(strokes.has('Control+P')).toBe(true);
        expect(strokes.has('Alt+J')).toBe(true);
    });
});

describe('which commands may be bound', () => {
    it('excludes the ones that need particular surroundings', () => {
        const bindable = COMMAND_PALETTE_COMMANDS.filter(isScopeIndependentCommand).map(command => command.id);
        expect(bindable).not.toContain('panel-cover');
        expect(bindable).not.toContain('playback-equalizer');
        expect(bindable).not.toContain('filter-view');
    });

    it('keeps the ones that work anywhere, state gating included', () => {
        const bindable = COMMAND_PALETTE_COMMANDS.filter(isScopeIndependentCommand).map(command => command.id);
        // 因为暂时不可用（私人 FM 开着、队列是空的）而被收起的命令仍然可以绑：
        // 设置面板选的是「以后按这个键做什么」，不是「此刻能不能做」。
        expect(bindable).toContain('playback-shuffle');
        expect(bindable).toContain('playback-next');
        expect(bindable).toContain('navigate-home');
        // 控制面板那几个动作正是加进来给这个绑定用的。
        expect(bindable).toContain('playback-like');
        expect(bindable).toContain('playback-mute');
    });
});

describe('refusing a combination', () => {
    const bindings = [binding({ key: 'j', commandId: 'one' })];

    it('takes a combination with a modifier and a key on the list', () => {
        expect(refuseCustomShortcutChord('space', ['alt', 'shift'], 1, bindings, COMMAND_PALETTE_COMMANDS)).toBeNull();
        expect(refuseCustomShortcutChord('f4', ['control'], 1, bindings, COMMAND_PALETTE_COMMANDS)).toBeNull();
    });

    it('needs Ctrl, Alt or Win, and a key on the list', () => {
        expect(refuseCustomShortcutChord('j', [], 1, bindings, COMMAND_PALETTE_COMMANDS)).toBe('needs-modifier');
        expect(refuseCustomShortcutChord('j', ['shift'], 1, bindings, COMMAND_PALETTE_COMMANDS)).toBe('needs-modifier');
        expect(refuseCustomShortcutChord('escape', ['alt'], 1, bindings, COMMAND_PALETTE_COMMANDS)).toBe('unsupported-key');
    });

    it('refuses what the command palette already owns', () => {
        expect(refuseCustomShortcutChord('k', ['control'], 1, bindings, COMMAND_PALETTE_COMMANDS)).toBe('reserved');
        expect(refuseCustomShortcutChord('s', ['control', 'alt'], 1, bindings, COMMAND_PALETTE_COMMANDS)).toBeNull();
    });

    it('refuses a combination another slot holds, but only with the same modifiers', () => {
        expect(refuseCustomShortcutChord('j', ['alt'], 1, bindings, COMMAND_PALETTE_COMMANDS)).toBe('duplicate');
        expect(refuseCustomShortcutChord('j', ['control'], 1, bindings, COMMAND_PALETTE_COMMANDS)).toBeNull();
        expect(refuseCustomShortcutChord('j', ['alt'], 0, bindings, COMMAND_PALETTE_COMMANDS)).toBeNull();
    });
});

describe('resolving stored bindings', () => {
    const commands = [
        commandWith({ id: 'global-one' }),
        commandWith({ id: 'player-only', scope: 'player-surface' }),
    ];

    it('resolves the bindings that may run, with the modifiers in the shown order', () => {
        const active = resolveActiveCustomShortcuts([
            binding({ key: 'j', commandId: 'global-one' }),
            binding({ key: 'k', modifiers: ['shift', 'control'], commandId: 'global-one' }),
        ], commands);
        expect(active.map(entry => entry.accelerator)).toEqual(['Alt+J', 'Control+Shift+K']);
    });

    it('runs nothing when either half is missing, or for Shift alone', () => {
        expect(resolveActiveCustomShortcuts([binding({ key: 'j' })], commands)).toEqual([]);
        expect(resolveActiveCustomShortcuts([binding({ commandId: 'global-one' })], commands)).toEqual([]);
        expect(resolveActiveCustomShortcuts([binding({ key: 'j', modifiers: ['shift'], commandId: 'global-one' })], commands)).toEqual([]);
    });

    it('goes quiet once the combination is claimed by something else', () => {
        const withClaim = [...commands, commandWith({ id: 'claimer', openHotkey: { key: 'j', alt: true } })];
        expect(resolveActiveCustomShortcuts([binding({ key: 'j', commandId: 'global-one' })], withClaim)).toEqual([]);
    });

    it('goes quiet once the command grows a scope, or leaves the registry', () => {
        expect(resolveActiveCustomShortcuts([binding({ key: 'j', commandId: 'player-only' })], commands)).toEqual([]);
        expect(resolveActiveCustomShortcuts([binding({ key: 'j', commandId: 'gone' })], commands)).toEqual([]);
    });

    it('keeps only the first of two slots with the same combination', () => {
        const active = resolveActiveCustomShortcuts([
            binding({ key: 'j', commandId: 'global-one' }),
            binding({ key: 'j', commandId: 'global-one' }),
        ], commands);
        expect(active).toHaveLength(1);
        expect(active[0].slot).toBe(0);
    });

    it('finds the command for a pressed combination', () => {
        const active = resolveActiveCustomShortcuts(
            [binding({ key: 'space', modifiers: ['shift', 'alt'], commandId: 'global-one' })],
            commands,
        );
        expect(commandForCustomShortcut(active, 'Alt+Shift+Space')?.id).toBe('global-one');
        expect(commandForCustomShortcut(active, 'Alt+Space')).toBeNull();
    });

    it('builds the pressed accelerator in the same form the bindings use', () => {
        // 回归：派发以前拿 readGlobalShortcutChord 的小写 id（alt+j）去比加速器名（Alt+J），永远不相等。
        const event = { key: 'J', code: 'KeyJ', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false };
        expect(shortcutAccelerator(event)).toBe('Alt+J');
        const active = resolveActiveCustomShortcuts([binding({ key: 'j', commandId: 'global-one' })], commands);
        expect(commandForCustomShortcut(active, shortcutAccelerator(event))?.id).toBe('global-one');
    });
});
