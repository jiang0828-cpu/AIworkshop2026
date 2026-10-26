import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { PROFILE_ID } from "../db";
import { writeTransaction } from "../database-writes";

const moveSchema = z.object({
  actionId: z.string().min(1).max(150),
  projectId: z.string().min(1).max(150),
  fromProjectId: z.string().nullable(),
  fromParentId: z.string().nullable(),
}).strict();

// Called under the shared daily lock, so queue operations cannot race this move.
export async function moveAction(db: PrismaClient, input: unknown) {
  const body = moveSchema.parse(input);
  return writeTransaction(db, async tx => {
    const where = { profileId: PROFILE_ID };
    const [project] = await tx.project.findMany({ where: { ...where, id: body.projectId } });
    const rows = await tx.action.findMany({ where });
    const source = rows.find(row => row.id === body.actionId);
    if (!project || !source) throw new Error("任务或项目不存在，或不属于当前档案");
    if (source.projectId === project.id && source.parentId === null && source.goalId === project.goalId) return { moved: 0 };
    if (source.projectId !== body.fromProjectId || source.parentId !== body.fromParentId)
      throw new Error("任务所属关系已变化，请刷新后重新拖动");

    const moving = [source], seen = new Set([source.id]);
    for (let index = 0; index < moving.length; index++) {
      for (const child of rows.filter(row => row.parentId === moving[index].id)) {
        if (seen.has(child.id)) throw new Error("任务层级存在循环，请先修正所属关系");
        seen.add(child.id); moving.push(child);
      }
    }
    for (const row of moving) {
      await tx.action.update({ where: { id: row.id }, data: {
        projectId: project.id, goalId: project.goalId,
        ...(row.id === source.id ? { parentId: null } : {}),
      } });
    }
    return { moved: moving.length };
  });
}
