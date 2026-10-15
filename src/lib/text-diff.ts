export type DiffLine = { type: "same" | "added" | "removed"; text: string };

/** A compact line-oriented LCS diff suitable for Markdown document versions. */
export function diffLines(before: string, after: string): DiffLine[] {
  const left = before.replace(/\r\n/g, "\n").split("\n");
  const right = after.replace(/\r\n/g, "\n").split("\n");
  const rows = left.length + 1;
  const cols = right.length + 1;
  if (rows * cols > 1_000_000) return [{ type: "removed", text: before }, { type: "added", text: after }];

  const table = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let i = 1; i < rows; i++) for (let j = 1; j < cols; j++) table[i][j] = left[i - 1] === right[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1]);

  const result: DiffLine[] = [];
  let i = left.length; let j = right.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && left[i - 1] === right[j - 1]) { result.push({ type: "same", text: left[i - 1] }); i--; j--; }
    else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) { result.push({ type: "added", text: right[j - 1] }); j--; }
    else { result.push({ type: "removed", text: left[i - 1] }); i--; }
  }
  return result.reverse();
}
