import { AlignmentType, Document, Footer, PageNumber, Paragraph, TextRun } from "docx";
import { executionExportTime, executionSummary, type ExecutionDocument, type ExportSection } from "./execution-export";

export function executionWordDocument(document: ExecutionDocument) {
  const font = { ascii: "Calibri", hAnsi: "Calibri", eastAsia: "Microsoft YaHei" };
  const children: Paragraph[] = [
    new Paragraph({ style: "Title", text: document.title }),
    new Paragraph({ text: `导出时间：${executionExportTime(document)}（北京时间）` }),
    new Paragraph({ text: `导出范围：${document.scopeLabel}` }),
    new Paragraph({ text: executionSummary(document) }),
    ...document.filters.map(text => new Paragraph({ text })),
  ];
  const write = (sections: ExportSection[], parent: string) => sections.forEach((section, index) => {
    const number = parent ? `${parent}.${index + 1}` : `${index + 1}`;
    const depth = number.split(".").length;
    const indent = Math.min((depth - 1) * 120, 720);
    children.push(new Paragraph({ style: `Heading${Math.min(depth, 9)}`, text: `${number} ${section.title.replace(/\r?\n/g, " ")}`, indent: { left: indent } }));
    if (section.metadata.length) children.push(new Paragraph({ text: section.metadata.join(" · "), indent: { left: indent }, spacing: { after: 100 } }));
    for (const field of section.fields) {
      const lines = field.value.split(/\r?\n/);
      children.push(new Paragraph({ indent: { left: indent }, children: [
        new TextRun({ text: `${field.label}：`, bold: true }), new TextRun(lines[0]),
      ] }));
      for (const line of lines.slice(1)) children.push(new Paragraph({ text: line, indent: { left: indent } }));
    }
    write(section.children, number);
  });
  write(document.sections, "");
  if (!document.sections.length) children.push(new Paragraph("暂无符合条件的目标、项目或任务。"));
  return new Document({
    title: document.title, creator: "AI 工作台", description: document.scopeLabel,
    styles: {
      default: {
        document: { run: { font, size: 22, color: "000000", language: { value: "zh-CN", eastAsia: "zh-CN" } },
          paragraph: { spacing: { after: 120, line: 300 } } },
        title: { run: { font, size: 38, bold: true, color: "000000" }, paragraph: { spacing: { before: 0, after: 260 }, keepNext: true } },
      },
      paragraphStyles: Array.from({ length: 9 }, (_, index) => ({
        id: `Heading${index + 1}`, name: `heading ${index + 1}`, basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font, size: index === 0 ? 30 : index === 1 ? 26 : 23, bold: true, color: "000000" },
        paragraph: { outlineLevel: index, keepNext: true, keepLines: true, spacing: { before: index < 2 ? 280 : 200, after: 120 } },
      })),
    },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      children,
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
        new TextRun({ text: "第 ", size: 18 }), new TextRun({ children: [PageNumber.CURRENT], size: 18 }),
        new TextRun({ text: " 页", size: 18 }),
      ] })] }) },
    }],
  });
}

export async function executionWordBlob(document: ExecutionDocument) {
  const { Packer } = await import("docx");
  return Packer.toBlob(executionWordDocument(document));
}
