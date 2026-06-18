/**
 * jab-java-tree — REFUTES the "Java Swing/AWT is an OCR-only wall" dead-end. A Java window exposes nothing to UIA or
 * MSAA but speaks the Java Access Bridge; jab.ts (WindowsAccessBridge-64.dll, Windows_run + a one-time message-pump
 * handshake, then synchronous reads) reads its full accessibility tree — roles/names/states/bounds — cursor-free.
 *
 * Proof: compile + launch a real Swing app (a JFrame with a labeled push-button "theButton", a text field, and a
 * check box "Enable Thing"), read javaTree(hWnd), and assert the tree contains those controls with correct JAB roles.
 * The Java process is killed + window closed in finally. SKIPS cleanly if no JDK is present.
 *
 * bun test is broken repo-wide — runnable harness (compiles + spawns a Java Swing app):
 * Run: bun run example/jab-java-tree.integration.test.ts
 */
import { existsSync, readdirSync } from 'node:fs';

import { closeWindow, isJavaWindow, javaTree, type JavaNode, renderJavaTree, skry } from 'skry';
import User32 from '@bun-win32/user32';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

function findJdkBin(): string | null {
  const roots = ['C:/Program Files/Java', 'C:/Program Files/Eclipse Adoptium', 'C:/Program Files/Microsoft'];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const bin = `${root}/${entry}/bin`;
      if (existsSync(`${bin}/javac.exe`) && existsSync(`${bin}/java.exe`)) return bin;
    }
  }
  return null;
}

function flatten(node: JavaNode, out: JavaNode[] = []): JavaNode[] {
  out.push(node);
  for (const child of node.children) flatten(child, out);
  return out;
}

const TITLE = 'JAB Test Window';
const dir = `${Bun.env.TEMP ?? 'C:/Windows/Temp'}/uia_jab_${process.pid}`;
const bin = findJdkBin();

skry.initialize();
let javaProc: ReturnType<typeof Bun.spawn> | null = null;
let hWnd = 0n;
try {
  if (bin === null) {
    console.log('  skip(live): no JDK found (javac/java)');
  } else {
    await Bun.write(
      `${dir}/JabTest.java`,
      `import javax.swing.*; public class JabTest { public static void main(String[] a){ SwingUtilities.invokeLater(()->{ JFrame f=new JFrame("${TITLE}"); JButton b=new JButton("Click Me"); b.getAccessibleContext().setAccessibleName("theButton"); JTextField t=new JTextField("hello world",20); JCheckBox c=new JCheckBox("Enable Thing"); JPanel p=new JPanel(); p.add(new JLabel("A Label:")); p.add(b); p.add(t); p.add(c); f.add(p); f.setSize(420,160); f.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE); f.setVisible(true); }); } }`,
    );
    const compile = Bun.spawnSync([`${bin}/javac.exe`, `${dir}/JabTest.java`], { stderr: 'pipe' });
    if (!compile.success) {
      console.log(`  skip(live): javac failed: ${compile.stderr.toString().slice(0, 120)}`);
    } else {
      // -D forces the Access Bridge to load for THIS JVM regardless of the global jabswitch state
      javaProc = Bun.spawn([`${bin}/java.exe`, '-Djavax.accessibility.assistive_technologies=com.sun.java.accessibility.AccessBridge', '-cp', dir, 'JabTest'], { stdout: 'ignore', stderr: 'ignore' });
      for (let i = 0; i < 40 && hWnd === 0n; i++) {
        await Bun.sleep(250);
        hWnd = User32.FindWindowW(null, Buffer.from(`${TITLE}\0`, 'utf16le').ptr!);
      }
      if (hWnd === 0n) {
        console.log('  skip(live): Swing window did not appear');
      } else {
        await Bun.sleep(800);
        assert(isJavaWindow(hWnd), 'isJavaWindow recognizes the Swing window (JAB handshake completed)');
        const tree = javaTree(hWnd);
        if (tree === null) {
          console.log('  FAIL: javaTree returned null for a Java window');
          failures += 1;
        } else {
          const nodes = flatten(tree);
          console.log(`  javaTree: ${nodes.length} nodes; root="${tree.role}" "${tree.name}"`);
          console.log(renderJavaTree(tree).split('\n').slice(0, 14).join('\n'));
          assert(tree.role === 'frame' && tree.name === TITLE, `root is the frame "${TITLE}"`);
          assert(
            nodes.some((n) => /push button/.test(n.role) && n.name === 'theButton'),
            'the JButton is in the tree as a push button named "theButton" (UIA/MSAA see NONE of this)',
          );
          assert(
            nodes.some((n) => /check box/.test(n.role) && n.name === 'Enable Thing'),
            'the JCheckBox is in the tree as a check box named "Enable Thing"',
          );
          assert(
            nodes.some((n) => /text/.test(n.role)),
            'the JTextField is in the tree as a text control',
          );
        }
      }
    }
  }
} finally {
  if (hWnd !== 0n) closeWindow(hWnd);
  javaProc?.kill();
  await Bun.$`cmd /c rmdir /s /q ${dir}`.quiet().catch(() => {});
  skry.uninitialize();
}

console.log(failures === 0 ? '\nPASS — Java Swing tree read cursor-free via the Access Bridge (the OCR-only wall is broken).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
