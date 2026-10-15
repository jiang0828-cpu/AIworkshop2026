export const selfSections = { profile: "个人档案", values: "我的愿景", skills: "我的能力", resources: "我的资源", experiences: "项目及经历" };
export type SelfSection = keyof typeof selfSections;
export const sectionCollections: Record<SelfSection, string[]> = { profile: [], values: ["valueRules"], skills: ["evidences"], resources: ["resources", "constraints", "assumptions"], experiences: ["experiences"] };
export function inSelfSection(record: { kind: string; payload: string }, section: SelfSection) {
  if (section === "profile" && record.kind === "profileScene") return true;
  if (section === "values" && ["overallVision", "vision"].includes(record.kind)) return true;
  if (section === "skills" && record.kind === "skill") return true;
  const types: Record<SelfSection, string[]> = { profile: [], values: ["valueRule"], skills: ["evidence"], resources: ["resource", "constraint", "assumption"], experiences: ["experience"] };
  return record.kind === "tag" && types[section].includes(JSON.parse(record.payload).subjectType);
}
