export type NestedRecord = { id: string; parentId?: string | null; goalId?: string | null; projectId?: string | null };

export function recordAncestors<T extends NestedRecord>(row: NestedRecord, rows: T[]): T[] {
  const byId = new Map(rows.map(item => [item.id, item])), result: T[] = [], seen = new Set([row.id]);
  let parent = byId.get(row.parentId || '');
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id); result.unshift(parent); parent = byId.get(parent.parentId || '');
  }
  return result;
}

export function sameContainer(a: NestedRecord, b: NestedRecord, type: 'project' | 'action') {
  return (a.goalId || null) === (b.goalId || null) && (type === 'project' || (a.projectId || null) === (b.projectId || null));
}

export function recordParentCandidates<T extends NestedRecord>(child: NestedRecord, rows: T[], type: 'project' | 'action') {
  return rows.filter(parent => parent.id !== child.id && sameContainer(child, parent, type) && !recordAncestors(parent, rows).some(row => row.id === child.id));
}

export function visibleParents(rows: NestedRecord[], included: Set<string>) {
  const parents = new Map<string, string | null>();
  for (const row of rows) if (included.has(row.id)) parents.set(row.id, row.parentId && included.has(row.parentId) ? row.parentId : null);
  // Break corrupt legacy cycles for display without changing saved data.
  for (const id of parents.keys()) {
    const seen = new Set<string>(); let cursor: string | null = id;
    while (cursor) {
      if (seen.has(cursor)) { parents.set(cursor, null); break; }
      seen.add(cursor); cursor = parents.get(cursor) || null;
    }
  }
  return parents;
}
