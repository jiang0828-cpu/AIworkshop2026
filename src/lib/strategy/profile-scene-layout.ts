export const sceneDetailKeys = [
  "role", "currentState", "support", "focus", "stage", "stageTransition", "currentPriorities", "stageNeeds",
  "currentChallenges", "direction", "successDefinition", "baseline", "available", "limitations", "habits", "boundary",
  "organization", "healthEnergy", "incomeRange", "financialPressure", "familyResponsibilities",
] as const;
export type SceneDetailKey = typeof sceneDetailKeys[number];
export type SceneDetails = Partial<Record<SceneDetailKey, string>>;
export type SceneProfileField = { key: SceneDetailKey; label: string; placeholder: string; suggestions?: readonly string[] };
export type SceneProfileGroup = { title: string; fields: SceneProfileField[] };
type FieldSpec = readonly [SceneDetailKey, string, string];
type Layout = { identity: readonly FieldSpec[]; stageLabel: string; stages: readonly string[]; stageHints: readonly string[]; reality: readonly FieldSpec[] };

// Stable scene slots, rather than editable names or positions, select the form.
const layouts: Record<number, Layout> = {
  6: {
    identity: [["role", "系统管理角色", "负责哪些工具、流程和系统"], ["currentState", "系统运行状态", "目前使用和维护的系统及其状态"], ["support", "协作与支持", "可用的维护支持和协作人员"], ["focus", "当前改进重点", "最需要解决的流程或工具问题"]],
    stageLabel: "当前系统阶段", stages: ["梳理需求", "搭建与试用", "稳定运行", "优化与维护", "迁移与替换", "停用归档"],
    stageHints: ["当前处于搭建、运行还是维护阶段", "哪些变化需要调整系统", "这一阶段优先解决的问题", "需要的工具、时间或支持", "当前的故障、瓶颈和未知项", "下一阶段的系统改进与大致时间", "可验证的运行或改进标准"],
    reality: [["baseline", "工具与流程现状", "目前已具备的系统及实际效果"], ["available", "维护资源", "可用时间、预算、工具和支持"], ["limitations", "系统约束", "权限、兼容、预算和维护限制"], ["habits", "维护与备份习惯", "实际进行检查、更新和备份的节奏"], ["boundary", "数据与运行底线", "不可丢失的数据、必要授权和停止条件"]],
  },
  3: {
    identity: [["role", "健康管理角色", "例如：自己的健康管理者、家人的运动伙伴"], ["currentState", "生活与作息状态", "例如：白天工作、轮班作息、正在恢复规律生活"], ["support", "支持人员与条件", "例如：运动伙伴、适合休息的环境"], ["focus", "当前健康重点", "例如：规律作息、稳定精力、培养运动习惯"]],
    stageLabel: "当前健康阶段", stages: ["了解现状", "调整与恢复", "建立习惯", "稳定保持", "应对生活变化"],
    stageHints: ["描述当前阶段，不确定可以留空", "例如：工作节奏变化后，开始重新安排作息", "这一阶段最优先改善的作息、精力或习惯", "需要哪些休息条件、陪伴或专业支持", "哪些实际困难影响持续调整", "下一阶段希望形成的日常状态及大致时间", "例如：规律记录作息、精力与活动；写自己可观察的改善"],
    reality: [["healthEnergy", "身心与精力现状", "记录影响日常安排的实际状态，不必填写诊断或病历"], ["available", "可用时间与恢复条件", "可安排的休息、运动时段及环境；未知可留空"], ["limitations", "现实限制", "例如：轮班、照护责任、出行条件"], ["habits", "作息与活动习惯", "当前实际睡眠、活动与休息习惯"], ["boundary", "健康底线与活动边界", "哪些安排应避免，什么情况下需要暂停或寻求专业支持"]],
  },
  1: {
    identity: [["role", "财务责任与角色", "例如：管理个人收支、承担家庭部分开销"], ["currentState", "收入与保障状态", "描述来源是否稳定、保障安排是否明确；无需账户信息"], ["support", "财务支持与协作", "例如：共同管理预算的家人、可咨询的专业人员"], ["focus", "当前财务重点", "例如：厘清收支、保障必要开销、积累储备"]],
    stageLabel: "当前财务阶段", stages: ["盘点现状", "稳定收支", "建立保障与储备", "积累与发展", "调整负担", "长期安排"],
    stageHints: ["结合当前收支、储备与责任描述财务阶段", "例如：收入来源或家庭开销发生变化", "这一阶段最需保障或调整的资金事项", "需要的预算空间、信息或专业支持", "影响安排的实际缺口与不确定性", "下一阶段资金安排、需要满足的条件及大致时间", "根据自己的预算、储备和负担判断；金额可用区间"],
    reality: [["incomeRange", "收入与日常收支范围", "可填月度区间及币种；不填写账号或精确资产明细"], ["available", "可配置预算与保障", "当前实际可安排的预算、用途和时间；未知可留空"], ["financialPressure", "负担与财务约束", "需要保障的开销、偿付义务及现金流压力"], ["habits", "消费与储蓄习惯", "描述实际习惯和容易偏离预算的情况"], ["boundary", "财务底线与风险上限", "可承受的支出、损失或负担边界，以及必须保障的基本事项"]],
  },
  0: {
    identity: [["role", "岗位与工作角色", "例如：临床医生、项目负责人、自由职业者"], ["currentState", "工作与职业状态", "例如：在职、求职、转型、经营、休整"], ["organization", "组织与协作关系", "可填写组织类型、团队和主要协作方"], ["focus", "职责与专业重点", "当前承担什么职责，主要交付什么成果"]],
    stageLabel: "当前职业阶段", stages: ["探索与选择", "入门与适应", "成长与积累", "稳定与深化", "转型与调整", "经营与管理", "退出与交接"],
    stageHints: ["结合当前工作事实、经验与职责描述职业阶段", "例如：岗位变化、进入新领域、承担新职责", "这一阶段最重要的工作成果或职业选择", "需要的指导、能力、资源或协作支持", "阻碍交付或职业发展的具体困难", "下一阶段方向、准备事项及大致时间", "用可验证成果、交付质量或职责变化判断"],
    reality: [["baseline", "工作负荷与产出现状", "目前的工作量、主要交付、完成情况"], ["available", "可投入时间与工作条件", "实际可安排的时间、工具和协作条件"], ["limitations", "工作约束", "例如：权限、流程、时间、合同或岗位边界"], ["habits", "工作与协作习惯", "实际的专注、交付、沟通和复盘习惯"], ["boundary", "工作底线与试错边界", "哪些责任不能越界，什么条件下停止或调整"]],
  },
  2: {
    identity: [["familyResponsibilities", "家庭角色与责任", "例如：伴侣、父母、子女；只记录实际承担的责任"], ["currentState", "家庭生活状态", "例如：共同居住、异地、育儿、照护、家庭变化"], ["support", "家庭分工与支持", "谁承担哪些事项，有哪些可商议的支持"], ["focus", "当前家庭重点", "例如：陪伴、沟通、共同安排生活、照护"]],
    stageLabel: "当前家庭阶段", stages: ["建立共同生活", "关系与分工调整", "育儿与成长陪伴", "照护与支持", "稳定相处", "应对家庭变化"],
    stageHints: ["依据实际家庭结构、居住方式和责任填写", "哪些家庭成员、居住或责任变化带来影响", "这一阶段最需要照顾的关系或共同事项", "需要的陪伴、分工、支持或沟通空间", "当前冲突、负担或安排困难", "下一阶段希望形成的相处状态及大致时间", "用协商结果、责任履行和相处体验判断"],
    reality: [["baseline", "相处与沟通现状", "当前实际相处方式、陪伴和沟通情况"], ["available", "陪伴时间与支持条件", "可安排的时间、共同空间与支持渠道"], ["limitations", "家庭现实限制", "例如：异地、工作时间差异、照护安排"], ["habits", "相处与协商习惯", "遇到分歧或生活安排时，通常如何处理"], ["boundary", "关系底线与责任边界", "需要共同尊重的边界、个人空间和责任"]],
  },
  5: {
    identity: [["role", "兴趣与创作角色", "例如：阅读爱好者、写作者、摄影学习者"], ["currentState", "参与与创作状态", "例如：偶尔参与、持续学习、规律创作"], ["support", "同伴与交流渠道", "例如：兴趣社群、创作伙伴、可交流的导师"], ["focus", "当前兴趣方向", "正在投入或希望探索的兴趣、作品与体验"]],
    stageLabel: "当前兴趣阶段", stages: ["探索与体验", "入门与学习", "规律练习", "创作与展示", "深化与交流", "暂停或调整"],
    stageHints: ["结合当前兴趣、练习经验与参与情况填写", "是什么经历或变化带来新的兴趣方向", "这一阶段最想体验、练习或完成什么", "需要的学习资料、反馈、场地或同伴", "影响持续参与的实际困难", "下一阶段想达到的体验或作品状态及大致时间", "例如：持续练习、完成一件作品或获得满意体验"],
    reality: [["baseline", "实践与作品现状", "目前参与、练习和已完成作品的实际情况"], ["available", "可投入时间与条件", "可用时间、预算、设备、场地和资料"], ["limitations", "兴趣投入的限制", "例如：时间冲突、场地、工具或预算条件"], ["habits", "练习与创作习惯", "目前实际的练习、创作和交流节奏"], ["boundary", "投入边界与体验底线", "哪些投入不应挤占重要责任，什么时候调整节奏"]],
  },
  4: {
    identity: [["role", "事项与参与角色", "明确这是什么事项，你承担什么角色"], ["currentState", "当前参与状态", "目前处于准备、参与、推进还是暂停"], ["support", "相关人员与支持", "相关协作方和可用支持条件"], ["focus", "当前关注重点", "这个事项当前最需要关注什么"]],
    stageLabel: "当前事项阶段", stages: ["了解与准备", "启动与尝试", "推进与调整", "稳定保持", "完成与收尾", "暂停"],
    stageHints: ["先说明具体事项，再填写所处阶段", "哪些实际变化影响了这个事项", "这一阶段最需要推进的事项", "需要的信息、协作或资源", "当前最具体的困难和未知项", "下一阶段方向与大致时间", "写可观察或可验证的达成条件"],
    reality: [["baseline", "事项现状", "目前已有的事实、进展与结果"], ["available", "可投入资源", "实际可用的时间、预算、工具和支持"], ["limitations", "现实约束", "影响这个事项的条件与限制"], ["habits", "相关行动习惯", "目前实际如何安排和推进"], ["boundary", "边界与停止条件", "什么不能越界，何时调整或停止"]],
  },
};

export function sceneProfileGroups(slot: number): SceneProfileGroup[] {
  const layout = layouts[slot];
  if (!layout) throw new Error("场景类型无效");
  const fields = (specs: readonly FieldSpec[]) => specs.map(([key, label, placeholder]) => ({ key, label, placeholder }));
  const stageKeys = ["stage", "stageTransition", "currentPriorities", "stageNeeds", "currentChallenges", "direction", "successDefinition"] as const;
  const labels = [layout.stageLabel, "阶段变化背景", "阶段优先事项", "阶段所需支持", "阶段困难", "下一阶段方向与时间", "阶段达成标准"];
  return [
    { title: "当前身份", fields: fields(layout.identity) },
    { title: "人生阶段", fields: stageKeys.map((key, index) => ({ key, label: labels[index], placeholder: layout.stageHints[index], ...(index === 0 ? { suggestions: layout.stages } : {}) })) },
    { title: "现实情况", fields: fields(layout.reality) },
  ];
}
export function validateProfileSceneDetails(details: SceneDetails | undefined, slot: number | undefined) {
  if (!details) return;
  if (slot === undefined) throw new Error("场景类型无效");
  const allowed = new Set(sceneProfileGroups(slot).flatMap(group => group.fields.map(field => field.key)));
  if (Object.keys(details).some(key => !allowed.has(key as SceneDetailKey))) throw new Error("档案参数与所选场景不匹配");
}
