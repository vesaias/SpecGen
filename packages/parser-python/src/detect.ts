import type { DetectInput, DetectResult } from "@specgen/core";

/**
 * Detect a Python project. Confidence is the max of the satisfied signals:
 *   - pyproject.toml present      → 0.8
 *   - requirements.txt present    → 0.7
 *   - setup.py present            → 0.7
 *   - ≥3 *.py files anywhere      → 0.6
 *
 * Walks are capped so detection stays cheap even on huge repos. Standard
 * Python noise dirs (`__pycache__`, `venv`, `.venv`) are ignored along with
 * the usual repo noise (`node_modules`, `.git`, `dist`, `build`).
 */
export async function detectPython(input: DetectInput): Promise<DetectResult> {
  const { fs } = input;
  let confidence = 0;

  if (await fs.exists("pyproject.toml")) confidence = Math.max(confidence, 0.8);
  if (await fs.exists("requirements.txt")) confidence = Math.max(confidence, 0.7);
  if (await fs.exists("setup.py")) confidence = Math.max(confidence, 0.7);

  // Count *.py files, early-exit at the threshold.
  let pyCount = 0;
  try {
    for await (const entry of fs.walk("", {
      ignore: ["__pycache__", "venv", ".venv", "node_modules", ".git", "dist", "build"],
    })) {
      if (entry.isDirectory) continue;
      if (entry.path.endsWith(".py")) pyCount++;
      if (pyCount >= 3) break;
    }
  } catch {
    // Filesystem error: leave the count at whatever we got
  }
  if (pyCount >= 3) confidence = Math.max(confidence, 0.6);

  return { confidence, subDirs: [] };
}
