/**
 * qt-widget-tree — pins Qt (PySide6 / PyQt6 / PyQt5) as a first-class, cursor-free-drivable toolkit. Qt powers a tier-1
 * slice of the desktop (OBS, VLC, Telegram, KeePass, qBittorrent, Wireshark, the entire KDE stack), yet the suite — which
 * pins WinForms, WPF, WinUI, UWP, Electron/Chromium, and Java — had NO Qt regression. Qt exposes its widgets to UIA via a
 * version-fragile bridge (its sibling QML/Qt-Quick path already fails to expose in some builds), so an untested Qt is a
 * silent-regression hazard: a future Qt that drops the bridge (as QML does) would go unnoticed.
 *
 * Proof: spawn a real Qt QWidget window (QPushButton.setAccessibleName('theQtButton') + a QLineEdit + a QCheckBox), attach
 * + snapshot(maxDepth:30), assert the Button/Edit/CheckBox surface as actionable refs through UIA, and that a cursor-free
 * Element.setValue round-trips on the QLineEdit. The Qt process is killed + window closed in finally. SKIPS cleanly (exit 0)
 * when no Qt python runtime is present — exactly the compile-or-skip discipline of jab-java-tree / wpf-hwndwrapper-input.
 *
 * bun test is broken repo-wide for FFI — runnable harness (spawns a real Qt window):
 * Run: bun run example/qt-widget-tree.integration.test.ts
 */
import { existsSync } from 'node:fs';

import { type RefNode, closeWindow, snapshot, skry, windowProcessId } from 'skry';
import User32 from '@bun-win32/user32';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const QT_MODULES = ['PySide6', 'PyQt6', 'PyQt5'] as const;

// The first Qt module a candidate python can import (the widgets API is identical across all three), or null.
function qtModuleFor(exe: string): string | null {
  for (const qtModule of QT_MODULES) {
    try {
      if (Bun.spawnSync([exe, '-c', `import ${qtModule}`], { stdout: 'ignore', stderr: 'ignore' }).success) return qtModule;
    } catch {
      // a non-existent exe throws ENOENT — treat as "not this one" and keep probing
    }
  }
  return null;
}

// A Bun-spawnable python that has a Qt binding. A Windows Store python is reached through an App Execution Alias whose
// path is NOT Bun-spawnable (a zero-byte reparse point), so when no plain python on PATH has Qt, resolve the real exe
// under sys.base_prefix (via `cmd /c python`, which DOES honor the alias) and spawn that directly.
async function findQtPython(scriptDir: string): Promise<{ exe: string; qtModule: string } | null> {
  for (const exe of [Bun.which('python3'), Bun.which('python')].filter((candidate): candidate is string => typeof candidate === 'string' && !/WindowsApps/i.test(candidate))) {
    const qtModule = qtModuleFor(exe);
    if (qtModule !== null) return { exe, qtModule };
  }
  const baseScript = `${scriptDir}/base_prefix.py`;
  await Bun.write(baseScript, 'import sys; sys.stdout.write(sys.base_prefix)');
  let prefix = '';
  try {
    prefix = Bun.spawnSync(['cmd', '/c', 'python', baseScript], { stdout: 'pipe', stderr: 'ignore' }).stdout.toString().trim();
  } catch {
    // no python alias at all
  }
  if (prefix.length > 0)
    for (const name of ['python3.13.exe', 'python3.12.exe', 'python3.11.exe', 'python.exe', 'python3.exe']) {
      const exe = `${prefix}\\${name}`;
      if (existsSync(exe)) {
        const qtModule = qtModuleFor(exe);
        if (qtModule !== null) return { exe, qtModule };
      }
    }
  return null;
}

function flatten(node: RefNode, out: RefNode[] = []): RefNode[] {
  out.push(node);
  for (const child of node.children) flatten(child, out);
  return out;
}

const TITLE = `Qt Widget Probe ${process.pid}`;
const dir = `${Bun.env.TEMP ?? 'C:/Windows/Temp'}/uia_qt_${process.pid}`;

skry.initialize();
let qtProcess: ReturnType<typeof Bun.spawn> | null = null;
let hWnd = 0n;
try {
  const python = await findQtPython(dir);
  if (python === null) {
    console.log('  skip(live): no Qt python runtime (PySide6 / PyQt6 / PyQt5)');
  } else {
    console.log(`  Qt runtime: ${python.qtModule}`);
    // A minimal Qt QWidget: a labeled push button, a line edit, and a check box. app.exec() blocks the python thread on
    // the Qt event loop, so the window stays alive until the process is killed. The widgets API is shared across all three
    // bindings, so the only per-binding line is the import.
    const script = `${dir}/qt_window.py`;
    await Bun.write(
      script,
      `from ${python.qtModule}.QtWidgets import QApplication, QWidget, QPushButton, QLineEdit, QCheckBox, QVBoxLayout, QLabel\n` +
        `import sys\n` +
        `app = QApplication(sys.argv)\n` +
        `w = QWidget(); w.setWindowTitle(${JSON.stringify(TITLE)})\n` +
        `layout = QVBoxLayout(w); layout.addWidget(QLabel("A Label:"))\n` +
        `button = QPushButton("Click Me Qt"); button.setAccessibleName("theQtButton"); layout.addWidget(button)\n` +
        `edit = QLineEdit("initial"); edit.setAccessibleName("theQtEdit"); layout.addWidget(edit)\n` +
        `check = QCheckBox("Enable Qt Thing"); layout.addWidget(check)\n` +
        `w.resize(420, 200); w.show()\n` +
        `app.exec()\n`,
    );
    qtProcess = Bun.spawn([python.exe, script], { stdout: 'ignore', stderr: 'ignore' });
    const titleBuffer = Buffer.from(`${TITLE}\0`, 'utf16le');
    for (let i = 0; i < 60 && hWnd === 0n; i++) {
      await Bun.sleep(250);
      hWnd = User32.FindWindowW(null, titleBuffer.ptr!);
    }
    if (hWnd === 0n) {
      console.log('  skip(live): Qt window did not appear');
    } else {
      await Bun.sleep(800); // let Qt build its accessibility tree
      const window = skry.attach(hWnd);
      const snap = snapshot(window, { maxDepth: 30 });
      try {
        const nodes = flatten(snap.tree);
        console.log(`  UIA snapshot: ${flatten(snap.tree).length} nodes, ${snap.marks.length} actionable refs`);
        const button = nodes.find((node) => node.ref !== undefined && node.role === 'Button' && node.name === 'theQtButton');
        const edit = nodes.find((node) => node.ref !== undefined && node.role === 'Edit');
        const check = nodes.find((node) => node.ref !== undefined && node.role === 'CheckBox' && node.name === 'Enable Qt Thing');
        assert(button !== undefined, 'the QPushButton surfaces as an actionable Button ref named "theQtButton" (Qt UIA bridge alive)');
        assert(edit !== undefined, 'the QLineEdit surfaces as an actionable Edit ref');
        assert(check !== undefined, 'the QCheckBox surfaces as an actionable CheckBox ref named "Enable Qt Thing"');
        if (edit?.ref !== undefined) {
          const element = snap.resolve(edit.ref);
          element?.setValue('qt-roundtrip-7421');
          await Bun.sleep(150);
          const readBack = element?.value ?? '';
          assert(readBack.includes('qt-roundtrip-7421'), `the QLineEdit round-trips a cursor-free ValuePattern setValue ("${readBack.trim().slice(0, 40)}")`);
        }
      } finally {
        snap.dispose();
        window.dispose();
      }
    }
  }
} finally {
  const pid = hWnd !== 0n ? windowProcessId(hWnd) : 0;
  if (hWnd !== 0n) closeWindow(hWnd);
  if (pid) Bun.spawnSync(['taskkill', '/F', '/PID', String(pid)]);
  qtProcess?.kill();
  await Bun.$`cmd /c rmdir /s /q ${dir}`.quiet().catch(() => {});
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — Qt widgets read + driven cursor-free via UIA (the toolkit is pinned against a bridge regression).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
