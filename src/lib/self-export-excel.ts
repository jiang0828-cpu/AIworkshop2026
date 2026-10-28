import ExcelJS from "exceljs";
import { selfSections } from "./self-transfer";
import type { SelfExportRow } from "./self-export";

export function selfExcelWorkbook(rows: SelfExportRow[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AI 工作台";
  for (const name of [...Object.values(selfSections), "历史版本"]) {
    const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = [
      { header: "场景", key: "scene", width: 18 }, { header: "条目", key: "title", width: 35 },
      { header: "字段", key: "field", width: 25 }, { header: "内容", key: "value", width: 85 },
    ];
    for (const row of rows.filter(row => row.section === name)) {
      // Excel limits each cell to 32,767 UTF-16 units. Keep long text in numbered continuation rows.
      let remainder = row.value, part = 0;
      do {
        let end = Math.min(remainder.length, 32000);
        if (end < remainder.length && /[\uD800-\uDBFF]/.test(remainder[end - 1])) end--;
        sheet.addRow({ scene: row.scene, title: row.title, field: `${row.field}${part ? `（续 ${part}）` : ""}`, value: remainder.slice(0, end) });
        remainder = remainder.slice(end); part++;
      } while (remainder);
    }
    sheet.eachRow((row, index) => {
      row.alignment = { vertical: "top", wrapText: true };
      row.font = { name: "Microsoft YaHei", size: 11, color: { argb: "FF202B25" } };
      if (index === 1) {
        row.height = 25;
        row.font = { ...row.font, bold: true, color: { argb: "FFFFFFFF" } };
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5E7867" } };
      }
    });
    sheet.autoFilter = { from: "A1", to: `D${Math.max(1, sheet.rowCount)}` };
  }
  return workbook;
}

export async function selfExcelBlob(rows: SelfExportRow[]) {
  const buffer = await selfExcelWorkbook(rows).xlsx.writeBuffer();
  return new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
