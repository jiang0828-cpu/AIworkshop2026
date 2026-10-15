import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";

const migration = readFileSync(path.resolve("cloudflare/migrations/0014_delivery_codes.sql"), "utf8");
let db: DatabaseSync;
const createdAt = Date.parse("2026-10-14T16:05:00Z");
const insert = (type: "Project" | "Action", id: string, code: string | null = null) => {
  db.prepare(`INSERT INTO "${type}" (id,createdAt,recordCode) VALUES (?,?,?)`).run(id, createdAt, code);
  return db.prepare(`SELECT recordCode FROM "${type}" WHERE id=?`).get(id)?.recordCode;
};
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE Project(id TEXT PRIMARY KEY,createdAt DATETIME,name TEXT); CREATE TABLE Action(id TEXT PRIMARY KEY,createdAt DATETIME,projectId TEXT,dueDate DATETIME); CREATE TABLE Milestone(id TEXT PRIMARY KEY,projectId TEXT,deadline DATETIME)");
});
afterEach(() => db.close());

describe("项目任务独立编号及交付日期增量迁移", () => {
  it("保留原ID，按上海创建日期分类型补齐唯一编号", () => {
    db.prepare("INSERT INTO Project(id,createdAt) VALUES (?,?),(?,?)").run("p1", createdAt, "p2", createdAt);
    db.prepare("INSERT INTO Action(id,createdAt) VALUES (?,?)").run("t1", createdAt);
    db.exec(migration);
    expect(db.prepare("SELECT id,recordCode FROM Project ORDER BY id").all()).toEqual([{ id: "p1", recordCode: "20261015A01" }, { id: "p2", recordCode: "20261015A02" }]);
    expect(db.prepare("SELECT recordCode FROM Action").get()?.recordCode).toBe("20261015B01");
    expect(insert("Project", "p3")).toBe("20261015A03");
    expect(insert("Action", "t2")).toBe("20261015B02");
  });
  it("原子分配流水，删除后不复用编号，日期与名称编辑不改号", () => {
    db.exec(migration);
    expect(insert("Project", "p1")).toBe("20261015A01");
    db.exec("DELETE FROM Project");
    expect(insert("Project", "p2")).toBe("20261015A02");
    db.prepare("UPDATE Project SET deadline=?,name=? WHERE id=?").run(Date.parse("2027-01-01"), "Renamed", "p2");
    expect(db.prepare("SELECT recordCode FROM Project").get()?.recordCode).toBe("20261015A02");
  });
  it("备份原编号可恢复，后续创建避开已恢复编号，重复编号拒绝写入", () => {
    db.exec(migration);
    expect(insert("Action", "restored", "20261015B129")).toBe("20261015B129");
    expect(insert("Action", "new")).toBe("20261015B130");
    expect(() => insert("Action", "duplicate", "20261015B129")).toThrow();
    db.exec("BEGIN"); insert("Action", "rollback"); db.exec("ROLLBACK");
    expect(insert("Action", "after-rollback")).toBe("20261015B131");
  });
  it("兼容字符串创建时间，午夜按上海日期编号", () => {
    db.exec(migration);
    db.prepare("INSERT INTO Project(id,createdAt) VALUES (?,?)").run("iso", "2026-10-14 16:00:00");
    expect(db.prepare("SELECT recordCode FROM Project").get()?.recordCode).toBe("20261015A01");
  });
  it("只用已记录的最晚任务或里程碑日期补齐项目交付时间", () => {
    db.prepare("INSERT INTO Project(id,createdAt) VALUES (?,?),(?,?)").run("known",createdAt,"unknown",createdAt);
    db.prepare("INSERT INTO Milestone VALUES (?,?,?)").run("m","known",Date.parse("2026-11-15"));
    db.prepare("INSERT INTO Action(id,createdAt,projectId,dueDate) VALUES (?,?,?,?)").run("a",createdAt,"known",Date.parse("2026-10-15"));
    db.exec(migration);
    expect(db.prepare("SELECT deadline FROM Project WHERE id='known'").get()?.deadline).toBe(Date.parse("2026-11-15"));
    expect(db.prepare("SELECT deadline FROM Project WHERE id='unknown'").get()?.deadline).toBeNull();
    const before = db.prepare("SELECT id,recordCode,deadline FROM Project ORDER BY id").all();
    db.exec(migration.slice(migration.indexOf("-- Number allocation")));
    expect(db.prepare("SELECT id,recordCode,deadline FROM Project ORDER BY id").all()).toEqual(before);
  });
});
