import { AlignmentType, Document, Footer, PageNumber, Paragraph, TextRun } from "docx";
import type { SelfExportRow } from "./self-export";

export function selfWordDocument(rows: SelfExportRow[]) {
  const font = { ascii: "Calibri", hAnsi: "Calibri", eastAsia: "Microsoft YaHei" };
  const children: Paragraph[] = [new Paragraph({ style: "Title", text: "认识自己" }), new Paragraph({ text: `导出时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）` })];
  let lastSection = "", lastRecord = "";
  for (const row of rows) {
    if (row.section !== lastSection) { children.push(new Paragraph({ style: "Heading1", text: row.section })); lastSection = row.section; lastRecord = ""; }
    const key = JSON.stringify([row.scene, row.recordId || row.title]);
    if (key !== lastRecord) { children.push(new Paragraph({ style: "Heading2", text: `${row.scene} ${row.title}` })); lastRecord = key; }
    const [first, ...rest] = row.value.split(/\r?\n/);
    children.push(new Paragraph({ children: [new TextRun({ text: `${row.field}：`, bold: true }), new TextRun(first)] }));
    children.push(...rest.map(text => new Paragraph({ text })));
  }
  if (!rows.length) children.push(new Paragraph("暂无已保存内容。"));
  return new Document({
    title: "认识自己", creator: "AI 工作台",
    styles: {
      default: {
        document: { run: { font, size: 22, color: "000000", language: { value: "zh-CN", eastAsia: "zh-CN" } }, paragraph: { spacing: { after: 120, line: 300 } } },
        title: { run: { font, size: 38, bold: true }, paragraph: { spacing: { after: 260 } } },
      },
      paragraphStyles: [
        { id: "Heading1", name: "heading 1", basedOn: "Normal", next: "Normal", run: { font, size: 30, bold: true }, paragraph: { spacing: { before: 280, after: 140 }, keepNext: true } },
        { id: "Heading2", name: "heading 2", basedOn: "Normal", next: "Normal", run: { font, size: 24, bold: true }, paragraph: { spacing: { before: 180, after: 100 }, keepNext: true } },
      ],
    },
    sections: [{ properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } }, children, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "第 ", size: 18 }), new TextRun({ children: [PageNumber.CURRENT], size: 18 }), new TextRun({ text: " 页", size: 18 })] })] }) } }],
  });
}

export async function selfWordBlob(rows: SelfExportRow[]) {
  const { Packer } = await import("docx");
  return Packer.toBlob(selfWordDocument(rows));
}
