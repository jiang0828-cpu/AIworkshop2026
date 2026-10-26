/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Prisma, PrismaClient } from "@prisma/client";
import { isCloudflareD1Runtime } from "./db";
import { prismaModels } from "./prisma-models";
import { atomic } from "./strategy/service";

type Statement = { sql: string; values: Array<string | number | null> };
export type SyncRow = { table: string; data: Record<string, string | number | null> };
// Keep metadata as a static generated module. Both Prisma clients expose DMMF
// during local development, but edge runtimes intentionally reject Prisma.dmmf.
const models = prismaModels;
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const scalar = (value: unknown): string | number | null => {
  if (value === null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "boolean") return Number(value);
  if (typeof value === "number" && Number.isFinite(value) || typeof value === "string") return value as string | number;
  throw new Error("数据库字段格式无效");
};

// D1 has no interactive Prisma transactions. Stage the existing scalar restore
// operations, including defaults, and commit them together in one D1 batch.
export async function writeTransaction<T>(db: PrismaClient, operation: (tx: Prisma.TransactionClient) => Promise<T>, forceBatch = false, capture?: (rows: SyncRow[]) => void): Promise<T> {
  if (!forceBatch && !isCloudflareD1Runtime()) return db.$transaction(operation, { timeout: 600000 });
  const statements: Statement[] = [];
  const inserted = new Map<string, any[]>(), cleared = new Set<string>();
  const delegates: Record<string, any> = {};
  const captured = new Map<string, SyncRow>();
  for (const model of models) {
    const key = model.name[0].toLowerCase() + model.name.slice(1);
    const actual = (db as any)[key];
    const fields = model.fields.filter((field) => field.kind !== "object");
    const fieldNames = new Set(fields.map((field) => field.name));
    const whereSql = (where: any, values: Statement["values"], alias = model.name): string => Object.entries(where || {}).map(([name, value]) => {
      if (fieldNames.has(name)) {
        if (value === null) return `${quote(alias)}.${quote(name)} IS NULL`;
        if (value && typeof value === "object" && "in" in value) {
          const items = (value as any).in as unknown[];
          if (!items.length) return "0";
          values.push(...items.map(scalar));
          return `${quote(alias)}.${quote(name)} IN (${items.map(() => "?").join(",")})`;
        }
        values.push(scalar(value)); return `${quote(alias)}.${quote(name)}=?`;
      }
      const relation = model.fields.find((field) => field.name === name && field.kind === "object");
      if (relation && relation.relationFromFields?.length) {
        const target = models.find((item) => item.name === relation.type)!;
        const nested = value as Record<string, unknown>;
        const terms = Object.entries(nested).map(([field, entry]) => {
          if (!target.fields.some((item) => item.name === field && item.kind !== "object")) throw new Error("导入关联条件无效");
          values.push(scalar(entry)); return `${quote(target.name)}.${quote(field)}=?`;
        });
        return `EXISTS (SELECT 1 FROM ${quote(target.name)} WHERE ${quote(target.name)}.${quote(relation.relationToFields![0])}=${quote(alias)}.${quote(relation.relationFromFields[0])} AND ${terms.join(" AND ")})`;
      }
      throw new Error("导入查询条件无效");
    }).join(" AND ") || "1";
    const update = async ({ where, data }: any) => {
      const payload = { ...data };
      if (fields.some((field) => field.isUpdatedAt) || fieldNames.has("updatedAt")) payload.updatedAt ??= new Date();
      const entries = Object.entries(payload).filter(([, value]) => value !== undefined);
      if (!entries.every(([field]) => fieldNames.has(field))) throw new Error("导入含未知字段");
      if (entries.length) {
        const values = entries.map(([, value]) => scalar(value));
        const condition = whereSql(where, values);
        statements.push({ sql: `UPDATE ${quote(model.name)} SET ${entries.map(([field]) => `${quote(field)}=?`).join(",")} WHERE ${condition}`, values });
      }
      if (capture) {
        const current = [...captured.values()].find(row => row.table === model.name && Object.entries(where).every(([key, value]) => row.data[key] === value));
        const previous = current?.data || await actual.findFirst({ where });
        if (!previous) throw new Error("同步记录不存在");
        const full = Object.fromEntries(fields.map(field => [field.name, scalar(payload[field.name] !== undefined ? payload[field.name] : previous[field.name])]));
        captured.set(`${model.name}:${full.id || full.profileId}`, { table: model.name, data: full });
      }
      return payload;
    };
    delegates[key] = {
      create: async ({ data }: any) => {
        const payload = { ...data };
        for (const field of fields) if (payload[field.name] === undefined) {
          if (field.isUpdatedAt) payload[field.name] = new Date();
          else if (field.hasDefaultValue) {
            const fallback = field.default;
            if (fallback && typeof fallback === "object" && "name" in fallback) {
              const fallbackName = (fallback as { name?: string }).name;
              if (fallbackName === "now") payload[field.name] = new Date();
              else if (["cuid", "uuid"].includes(fallbackName || "")) payload[field.name] = crypto.randomUUID();
              else throw new Error("导入字段默认值不受支持");
            } else payload[field.name] = fallback;
          } else if (!field.isRequired) payload[field.name] = null;
          else throw new Error(`导入缺少 ${model.name}.${field.name}`);
        }
        const entries = Object.entries(payload).filter(([, value]) => value !== undefined);
        if (!entries.every(([field]) => fieldNames.has(field))) throw new Error("导入含未知字段");
        statements.push({ sql: `INSERT INTO ${quote(model.name)} (${entries.map(([field]) => quote(field)).join(",")}) VALUES (${entries.map(() => "?").join(",")})`, values: entries.map(([, value]) => scalar(value)) });
        inserted.set(key, [...(inserted.get(key) || []), payload]);
        if (capture) captured.set(`${model.name}:${payload.id || payload.profileId}`, { table: model.name, data: Object.fromEntries(entries.map(([field, value]) => [field, scalar(value)])) });
        return payload;
      },
      deleteMany: async ({ where }: any = {}) => {
        const values: Statement["values"] = [];
        statements.push({ sql: `DELETE FROM ${quote(model.name)} WHERE ${whereSql(where, values)}`, values });
        if (Object.keys(where || {}).every((name) => name === "profileId")) { cleared.add(key); inserted.set(key, []); }
        return { count: 0 };
      },
      update,
      findMany: async (args: any = {}) => {
        if (!cleared.has(key)) return actual.findMany(args);
        return (inserted.get(key) || []).filter((item) => Object.entries(args.where || {}).every(([field, value]) => item[field] === value));
      },
      upsert: async ({ where, create, update: data }: any) => {
        const flat = Object.fromEntries(Object.entries(where).flatMap(([field, value]) => fieldNames.has(field) ? [[field, value]] : Object.entries(value as object)));
        const existing = cleared.has(key) ? (inserted.get(key) || []).find((item) => Object.entries(flat).every(([field, value]) => item[field] === value)) : await actual.findFirst({ where: flat });
        if (!existing) return delegates[key].create({ data: create });
        await update({ where: { id: existing.id }, data }); return { ...existing, ...data };
      },
    };
  }
  const result = await operation(delegates as Prisma.TransactionClient);
  if (capture) capture([...captured.values()]);
  else await atomic(db, statements);
  return result;
}
