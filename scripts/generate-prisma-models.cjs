/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const dmmf = require("@prisma/client").Prisma.dmmf.datamodel.models;
const models = dmmf.map(({ name, fields }) => ({
  name,
  fields: fields.map(({ name: fieldName, kind, type, relationName, relationFromFields, relationToFields, isRequired, hasDefaultValue, default: defaultValue, isUpdatedAt }) => ({
    name: fieldName, kind, type, relationName, relationFromFields, relationToFields, isRequired, hasDefaultValue, default: defaultValue, isUpdatedAt,
  })),
}));
const content = `/* Generated from prisma/schema.prisma. Do not edit by hand. */
export type PrismaModelField = { name: string; kind: "scalar" | "object"; type: string; relationName?: string; relationFromFields?: string[]; relationToFields?: string[]; isRequired?: boolean; hasDefaultValue?: boolean; default?: unknown; isUpdatedAt?: boolean };
export type PrismaModelMeta = { name: string; fields: PrismaModelField[] };
export const prismaModels: PrismaModelMeta[] = ${JSON.stringify(models)};
`;
fs.writeFileSync("src/lib/prisma-models.ts", content);
