/* eslint-disable @typescript-eslint/no-unused-expressions */
async (page) => {
  await page.unroute('**/api/execution-plan*');
  await page.goto(new URL('/?section=goals&tab=planning&planId=execution-verification-1791277742097', page.url()).href);
  await page.setViewportSize({ width: 1280, height: 900 });
  const panel = page.locator('#execution-plan');
  await panel.waitFor({ state: 'visible' });
  if (!(await panel.evaluate(element => element.open))) await panel.locator(':scope > summary').click();
  await page.getByLabel('规划历史').selectOption('execution-verification-1791277742097');
  await panel.getByText('确认范围：', { exact: false }).waitFor();
  const real = await page.request.get(new URL('/api/execution-plan?id=execution-verification-1791277742097', page.url()).href);
  const saved = await real.json();
  if (saved.status !== 'ready' || saved.mapping.length) throw new Error('Real plan must remain an unconfirmed draft');
  await page.screenshot({ path: 'output/playwright/execution/desktop-real-draft.png', fullPage: true });
  const layouts = [];
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.screenshot({ path: `output/playwright/execution/mobile-${width}.png`, fullPage: true });
    const size = await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth }));
    layouts.push(size); if (size.scroll > width) throw new Error(`Page overflow at ${width}px: ${size.scroll}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const scenes = saved.context.scenes;
  const context = { scenes, sources: [{ id: 'overallVision:browser-vision', recordId: 'browser-vision', type: 'overallVision', title: '浏览器测试愿景', content: '{}', blocked: false }], fingerprint: 'browser-test', missing: [] };
  const date = saved.input.capacity.startDate;
  const common = { sceneId: scenes[0].id, sources: ['overallVision:browser-vision'], reason: '测试资料依据', priority: 1, selected: true, deferred: false, deferReason: '', mode: 'new', matchId: null, matchReason: '', updateFields: [] };
  const draft = { summary: '浏览器隔离测试规划', coverage: scenes.map(scene => ({ sceneId: scene.id, status: 'planned', reason: '覆盖说明' })),
    goals: [{ ...common, key: 'g', title: '测试目标', visionId: 'browser-vision', description: '可验证目标', metric: '一个成果', horizon: '1年', deadline: null, parentKey: null }],
    projects: [{ ...common, key: 'p', goalKey: 'g', title: '测试项目', description: '交付一份报告', metric: '可审阅报告', budget: '零支出', budgetAmount: 0, boundary: '不超时', risk: '进度延误', stopCondition: '超时暂停', capabilities: ['分析'], resources: ['现有资料'], milestones: [{ title: '报告初稿', metric: '可审阅', deadline: null }] }],
    tasks: [{ ...common, key: 't', projectKey: 'p', title: '测试任务', standard: '完成报告', executor: 'AI', estimatedHours: 1, dueDate: date, dependencies: [], conditions: [] }] };
  let plan = null, requests = [], failSave = true;
  await page.route('**/api/execution-plan*', async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: request.url().includes('?id=') ? plan : { plans: plan ? [{ id: plan.id, status: plan.status, revision: plan.revision, updatedAt: plan.updatedAt }] : [], signals: [] } });
    const body = request.postDataJSON(); requests.push(body.action);
    if (body.action === 'preview') return route.fulfill({ json: context });
    if (body.action === 'create') plan = { id: body.id, input: body.input, revision: 1, status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), context, draft: null, review: null, issues: [], resolutions: [], logs: [], mapping: [], error: '', confirmable: false };
    if (body.action === 'stage') {
      if (body.stage === 'generate') { plan.draft = structuredClone(draft); plan.revision++; }
      else { plan.status = 'ready'; plan.review = { summary: '测试复核通过', issues: [] }; plan.confirmable = true; }
    }
    if (body.action === 'save') {
      if (failSave) { failSave = false; return route.fulfill({ status: 400, json: { error: '模拟保存失败，输入保留' } }); }
      plan.draft = body.draft; plan.input.capacity = body.capacity; plan.revision++; plan.status = 'draft'; plan.review = null; plan.confirmable = false;
    }
    if (body.action === 'confirm') { plan.status = 'confirmed'; plan.mapping = [{ key: 't', id: 'browser-action', type: 'action', deferred: false, cleared: false, mode: 'new' }]; }
    if (body.action === 'select-tasks') return route.fulfill({ json: { saved: 1 } });
    await route.fulfill({ json: plan });
  });
  await page.getByRole('button', { name: '新规划', exact: true }).click();
  await page.getByLabel('每周可用小时（未知留空）').fill('8');
  await page.getByLabel('90天金额上限（未知留空）').fill('0');
  await page.getByLabel('周二', { exact: true }).check();
  await page.getByRole('button', { name: '预览规划资料', exact: true }).click();
  await page.getByRole('button', { name: '确认发送并生成规划', exact: true }).click();
  await panel.getByText('浏览器隔离测试规划', { exact: true }).waitFor();
  await panel.locator('summary').filter({ hasText: '测试目标' }).click();
  const name = panel.getByLabel('名称', { exact: true }).first();
  await name.fill('编辑后的测试目标');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '模拟保存失败' }).waitFor();
  if (await name.inputValue() !== '编辑后的测试目标') throw new Error('Failed save lost input');
  await page.getByRole('button', { name: '认识自己', exact: true }).click();
  await page.getByRole('dialog', { name: '未保存的修改' }).waitFor();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByRole('button', { name: 'DeepSeek校验价值与边界', exact: true }).click();
  await page.getByRole('button', { name: '人工确认保存（不启动）', exact: true }).click();
  await page.getByRole('button', { name: '确认保存，不启动任务', exact: true }).click();
  await page.getByText('选择首批任务', { exact: true }).waitFor();
  await page.getByRole('checkbox', { name: '测试任务 · AI · 1小时' }).check();
  await page.getByRole('button', { name: '加入每日计划（不启动）', exact: true }).click();
  if (requests.filter(action => action === 'confirm').length !== 1 || requests.some(action => action === 'start')) throw new Error('Confirmation/start isolation failed');
  await page.reload();
  await page.getByText('选择首批任务', { exact: true }).waitFor();
  await page.screenshot({ path: 'output/playwright/execution/isolated-confirmed-flow.png', fullPage: true });
  console.log(JSON.stringify({ layouts, requests, syntheticFlowPassed: true, realPlanUnconfirmed: saved.status === 'ready', refreshRecovered: true, failedSavePreservedInput: true, unsavedNavigationGuard: true }));
}
