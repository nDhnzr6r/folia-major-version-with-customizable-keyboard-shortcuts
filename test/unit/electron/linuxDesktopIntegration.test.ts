import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// test/unit/electron/linuxDesktopIntegration.test.ts
// Tests Linux desktop entry metadata, WM_CLASS / app_id alignment, and packaging configuration.

describe('linuxDesktopIntegration', () => {
  const rootDir = path.resolve(__dirname, '../../../');
  const packageJsonPath = path.join(rootDir, 'package.json');
  const mainCjsPath = path.join(rootDir, 'electron/main.cjs');
  const linuxDesktopTemplatePath = path.join(rootDir, 'packaging/linux/folia-custom-shortcuts.desktop');

  it('declares desktopName and syncDesktopName in package.json matching executableName', () => {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    expect(pkg.desktopName).toBe('folia-custom-shortcuts.desktop');
    expect(pkg.build?.linux?.executableName).toBe('folia-custom-shortcuts');
    expect(pkg.build?.linux?.syncDesktopName).toBe(true);
    expect(pkg.build?.linux?.desktop?.entry?.StartupWMClass).toBe('folia-custom-shortcuts');
  });

  it('leaves Linux desktop identity to package.json desktopName instead of electron/main.cjs', () => {
    // Electron applies package.json desktopName at startup; a second setDesktopName call would drift from it.
    const mainContent = fs.readFileSync(mainCjsPath, 'utf8');

    expect(mainContent).not.toContain('app.setDesktopName(');
  });

  it('aligns StartupWMClass to folia-custom-shortcuts in portable linux desktop entry', () => {
    const content = fs.readFileSync(linuxDesktopTemplatePath, 'utf8');

    expect(content).toMatch(/^StartupWMClass=folia-custom-shortcuts$/m);
  });
});
