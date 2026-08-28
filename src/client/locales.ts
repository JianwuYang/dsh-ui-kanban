/**
 * 插件自己的轻量 i18n：zh/en 两本字典 + 订阅 harness `ctx.locale` 的 `useT`。
 * 不依赖 @deepseek-ai 客户端包的类型系统（方案 B）：注册时把 locale face
 * 的 getSnapshot/subscribe 绑定到模块单例，组件里 useT() 走 useSyncExternalStore，
 * 语言切换自动重渲染；无 locale 服务时回退中文。
 * @module dsh-kanban/client/locales
 */

import { useSyncExternalStore } from 'react'

/* ---------------- harness LocaleFace 的最小结构 ---------------- */

export interface LocaleSnapshotLike { active: string }
export interface LocaleFaceLike {
  getSnapshot(): LocaleSnapshotLike
  subscribe(fn: () => void): () => void
}

let face: LocaleFaceLike | undefined
// 绑定包装（face.subscribe 是原型方法，不能把未绑定的引用直接交给 useSyncExternalStore）
let localeSubscribe: ((fn: () => void) => () => void) | undefined
let localeGetSnapshot: (() => LocaleSnapshotLike) | undefined

/** 注册时绑定 harness 的 locale 服务（不存在时保持 undefined → 回退中文）。 */
export function bindLocale(value: unknown): void {
  const candidate = value as LocaleFaceLike | undefined
  if (candidate && typeof candidate.getSnapshot === 'function' && typeof candidate.subscribe === 'function') {
    face = candidate
    localeSubscribe = (fn) => candidate.subscribe(fn)
    localeGetSnapshot = () => candidate.getSnapshot()
  }
}

/* ---------------- 字典 ---------------- */

export const zh = {
  // 通用
  close: '关闭', cancel: '取消', ok: '确定', confirm: '确认', copy: '复制', copied: '已复制',
  // 看板应用
  appBrand: '看板', sync: '同步', syncing: '同步中…', newIssue: '新建', gitlab: 'GitLab', settings: '设置',
  closePanel: '关闭', newIssueAria: '新建 issue', gitlabAria: 'GitLab 工作区', switchProjectAria: '切换项目（工作区）',
  notConfiguredTitle: '尚未连接 Jira', notConfiguredHint: '请先在设置里配置 Jira 连接，再同步。', openSettings: '打开设置',
  noSyncTitle: '还没有同步', noSyncHint: '点击「同步」拉取 Jira 里的 issue。', autoSyncingTitle: '正在同步…', autoSyncingHint: '正在自动从 Jira 拉取最新 issue。',
  syncDone: '同步完成：{total} 个 issue（新增 {added}，更新 {updated}）', syncFailed: '同步失败',
  startSync: '开始同步', assigneeSelf: '经办人是我', reporterSelf: '报告人是我', syncSelfHint: '两项为「或」关系：满足任一即入选',
  previewQuery: '预览查询', previewResult: '预览结果', resultCount: '共 {n} 条', resultEmpty: '没有匹配的 issue', resultMore: '还有 {n} 条…',
  configJiraFirst: '请先在设置里配置 Jira 连接', settingsSaved: '设置已保存', switchFailed: '切换失败', loadFailed: '加载失败',
  issuesCount: '{n} issues', syncedAt: '同步于 {time}',
  // 分组列表
  searchPlaceholder: '搜索 key / 摘要 / 负责人…', searchClear: '清除搜索', searchAria: '搜索',
  emptyGroup: '暂无 issue', noMatchGroup: '无匹配的 issue', openCardAria: '打开 {key} {summary}',
  switchBranchTitle: '切换分支', switchBranchPick: '多个合并请求关联了该 issue，选择要切换的分支：',
  branchSwitched: '已切换到 {branch}', branchSwitchFailed: '切换分支失败',
  // 设置
  settingsTitle: '设置', tabJira: 'Jira', tabGitlab: 'GitLab',
  fieldBaseUrl: 'Base URL', fieldApiToken: 'API Token', fieldProjectKey: 'Project Key', fieldJql: 'JQL 过滤',
  tokenPlaceholder: '(已保存的 token 留空则不变)', projectKeyPlaceholder: 'PROJ', jqlPlaceholder: '(留空 = 全部)',
  fieldProjectPath: '项目路径', projectPathPlaceholder: 'group/repo', trustSelfSigned: '信任自签名证书',
  mrLinkSection: 'MR ↔ 议题关联', mrLinkAutoLabel: '自动识别 MR 描述里的议题引用',
  mrLinkKeywordsLabel: '关闭关键词', mrLinkKeywordsPlaceholder: 'closes, fix, resolve',
  mrLinkKeywordsHint: '逗号分隔；留空 = 用 GitLab 官方词表（close/closes/fix/fixes/resolve/resolves 及其变形）',
  mrLinkMentionsLabel: '普通 #编号 提及也算关联（仅关联、不关闭）',
  testConnection: '测试连接', save: '保存', saveFailed: '保存失败',
  testOk: '连接成功：{user}', testFail: '失败：{error}', testing: '测试中…',
  // 新建 issue
  createIssueTitle: '新建 issue', summaryLabel: '摘要', summaryRequired: '摘要必填',
  summaryPlaceholder: '一句话说清楚要做什么', issueTypeLabel: '问题类型', selectType: '选择类型', select: '选择',
  create: '创建', creating: '创建中…', createFailed: '创建失败', loadMetaFailed: '加载元数据失败', retry: '重试',
  assigneePlaceholder: '搜索用户…', multiPlaceholder: '回车添加新值，或从建议中选择',
  assign: '分配', assigning: '分配中…', assignIssueTitle: '分配 issue', assigneeLabel: '负责人',
  assignCommentLabel: '评论（可选）', assignCommentPlaceholder: '分配时顺带留言…',
  assignedToast: '已分配给 {name}', assignFailed: '分配失败',
  // GitLab 工作区
  gitlabTitle: 'GitLab 工作区', tabIssues: '议题', tabMrs: '合并请求',
  stateAll: '全部', stateOpened: '开放', stateClosed: '已关闭', stateMerged: '已合并',
  createFromJira: '从 Jira 创建议题', createMr: '创建合并请求', searchGitlab: '搜索…', refresh: '刷新', openGitlab: '打开 GitLab',
  noIssues: '暂无议题', noIssuesHint: '换个状态过滤试试，或从 Jira 创建一个。',
  noMrs: '暂无合并请求', noMrsHint: '换个状态过滤试试，或创建一个合并请求。',
  linkJira: '链接 Jira', linkMr: '关联 MR', unlinkAria: '取消链接 {key}', copyAria: '复制 {key}',
  closeIssueTitle: '关闭议题', closeIssueMsg: '关闭议题 !{iid}？', closeMrTitle: '关闭合并请求', closeMrMsg: '关闭 MR !{iid}？',
  gitlabIssueCreated: '已创建 GitLab 议题', jiraLinked: '已链接 Jira', linked: '已关联', mrCreated: '已创建合并请求',
  closeFailed: '关闭失败', linkFailed: '链接失败', unlinkFailed: '取消链接失败', mrCreateFailed: '创建 MR 失败',
  createIssueFromJiraTitle: '从 Jira 创建议题',
  selectJiraHint: '选择要合并到一个 GitLab 议题的 Jira 事项，标题和描述会自动生成：',
  noJiraHint: '没有可用的 Jira 事项（先在板上同步）。',
  titleLabel: '标题', titleAutoPlaceholder: '由所选 Jira 事项自动生成', descriptionLabel: '描述',
  createCount: '创建（{n}）', linkJiraTitle: '链接 Jira · !{iid}',
  linkJiraHint: '选择要链接到该议题的 Jira 事项：', link: '链接', linking: '链接中…', linkCount: '链接（{n}）',
  createMrTitle: '创建合并请求', sourceModeAria: '源分支方式', existingBranch: '现有分支', newBranch: '新建分支',
  sourceBranch: '源分支', selectBranch: '选择分支', newBranchName: '新分支名',
  newBranchHint: '留空使用建议名（由关联议题或标题自动生成）', targetBranch: '目标分支',
  mrTitleLabel: '标题（可选）', mrTitlePlaceholder: '留空使用源分支名', linkedIssuesLabel: '关联议题（可选）',
  noLinkedIssues: '没有可关联的议题', filterJiraPlaceholder: '筛选 Jira 事项…', filterIssuesPlaceholder: '筛选议题…',
  selectedCount: '已选 {n}', noMatch: '无匹配', newBranchFallback: 'new-branch',
  linkIssueToMrTitle: '关联议题 !{iid} 到合并请求', selectMrHint: '选择要关联的合并请求：', linkAction: '关联',
  branchRequired: '请选择源分支',
  // issue 详情
  statusChip: '状态: {name}', typeChip: '类型: {name}', priorityChip: '优先级: {name}', assigneeChip: '负责人: {name}', reporterChip: '报告人: {name}', linkChip: '链接',
  transitionsLabel: '流转（点击目标状态移动 issue）', commentsLabel: '评论（{n}）', attachmentsLabel: '附件（{n}）',
  noComments: '暂无评论', commentPlaceholder: '写评论…（可粘贴图片）', commentAria: '评论内容',
  imageBtn: '图片', uploading: '上传中…', pasteHint: '粘贴或选择图片，自动上传并插入引用', comment: '评论',
  uploadFailed: '上传失败', commentFailed: '评论失败', removeAttachAria: '移除附件 {name}',
  delete: '删除', deleteIssueTitle: '删除 issue', deleteIssueMsg: '删除 {key}？此操作不可撤销。', deleteFailed: '删除失败',
  openInJira: '在 Jira 中打开', sendToSession: '丢进会话分析', sending: '发送中…',
  sendTitle: '发送到会话分析',
  sendMsg: '把 {key}（含 {n} 张图片）交给会话中的 AI 分析（只分析、不修改）。选择发送位置：',
  sendMsgNoImg: '把 {key} 交给会话中的 AI 分析（只分析、不修改）。选择发送位置：',
  sendCurrent: '当前会话', sendNew: '在当前工作区新建会话',
  sentToast: '已发送到当前会话（附 {n} 张图片）', sentToastNoImg: '已发送到当前会话', sendFailed: '发送失败',
  refreshDetail: '刷新', prevImage: '上一张', nextImage: '下一张', unknownAuthor: '未知',
  descriptionLabel2: '描述',
  // toolview（聊天里的工具结果）
  tvNoCache: '暂无缓存数据——先让模型运行 kanban-sync 同步 Jira。', tvEmptyCol: '空',
  tvTransitions: '可用流转（用 kanban-move <key> <id> 移动）', tvComments: '评论 {n} 条。',
  tvProjects: 'Kanban projects', tvNoProjects: '没有项目——在工作区配置 Jira/GitLab host+token 后同步。',
  tvSyncTitle: 'Sync complete', tvStatTotal: 'issues 总数', tvStatAdded: '新增', tvStatUpdated: '更新',
  tvLastSync: '最近同步：{time}', tvFallback: '(无内容)',
  // 配置卡片
  cardDesc: '看板插件公共配置', unsaved: '未保存', readOnlyNote: '当前设置文档只读（memory 模式或只读 provider）',
  cardSaveFailed: '保存失败，草稿已保留，请修正后重试', discard: '放弃', saving: '保存中…',
  overridden: '已覆盖', reset: '重置', resetAria: '重置 {label}',
  cardNotMounted: '配置卡片未挂载', cardNotMountedBody: '设置服务（settingsScope）未提供；web profile（dsh-web-app）自带该服务，请用 dsh web 启动。',
  cardNotExposed: '配置命名空间 dsh-kanban 未对 Web 暴露', cardNotExposedBody: 'harness 的 Web 网关只向设置面板暴露白名单内的 settings 命名空间（WEB_SETTINGS_NAMESPACES）。host 半边不受影响：kanban-* 工具仍实时读取配置。',
  cardNotExposedRemedy: '要让本卡片可编辑：在 harness 的 WEB_SETTINGS_NAMESPACES 里加一行 dsh-kanban 后重建/重启 harness。',
  cardLoading: '正在读取配置…', cardLoadingBody: '命名空间数据到达后本卡片会自动切换为可编辑状态。',
  fieldGlobalJiraUrl: '全局 Jira 地址 (baseUrl)', fieldGlobalJiraUrlHint: '所有工作区在未覆盖时继承。',
  fieldGlobalJiraToken: '全局 Jira API Token', fieldGlobalJiraTokenHint: '密钥仅 host 侧保存；留空则保留现有 token，输入新值则更新。',
  fieldGlobalGitlabUrl: '全局 GitLab 地址 (baseUrl)', fieldGlobalGitlabUrlHint: '所有工作区在未覆盖时继承。',
  fieldGlobalGitlabToken: '全局 GitLab API Token', fieldGlobalGitlabTokenHint: '密钥仅 host 侧保存；留空则保留现有 token，输入新值则更新。',
  fieldDataDir: '本地缓存目录', fieldDataDirHint: '留空用默认 ~/.dsh/kanban（环境变量 KANBAN_DATA_DIR 优先）。',
  fieldAllowSelfSigned: '信任自签名证书', fieldAllowSelfSignedHint: 'GitLab 私服/自签名 TLS 时信任证书（默认开启）。',
  fieldVerbose: '打印调试日志', fieldVerboseHint: '开启后插件输出诊断日志。',
  // 会话入口
  headerButtonAria: '打开 dsh-kanban 看板',
  // 丢进会话分析的提示词
  sendPrompt: '请分析 Jira 问题 {key}。请先调用 kanban-issue 工具查看该问题的最新详情（描述、评论、附件）。附件会带有下载 URL，但如果你无法查看图片内容（当前模型不支持图像输入），请明确说明这一限制，并基于可获得的文本信息分析；分析这个问题是什么情况、可能的原因与影响，并给出处理建议。只做分析和建议，不要修改任何内容。',
  sendPromptWithImages: '请分析 Jira 问题 {key}。请先调用 kanban-issue 工具查看该问题的最新详情（描述、评论）。相关图片已作为附件随本条消息附上，请结合图片内容一起分析；分析这个问题是什么情况、可能的原因与影响，并给出处理建议。只做分析和建议，不要修改任何内容。',
} as const

export type TKey = keyof typeof zh

export const en: Record<TKey, string> = {
  close: 'Close', cancel: 'Cancel', ok: 'OK', confirm: 'Confirm', copy: 'Copy', copied: 'Copied',
  appBrand: 'Kanban', sync: 'Sync', syncing: 'Syncing…', newIssue: 'New', gitlab: 'GitLab', settings: 'Settings',
  closePanel: 'Close', newIssueAria: 'New issue', gitlabAria: 'GitLab workspace', switchProjectAria: 'Switch project (workspace)',
  notConfiguredTitle: 'Jira not connected', notConfiguredHint: 'Configure the Jira connection in settings, then sync.', openSettings: 'Open settings',
  noSyncTitle: 'Nothing synced yet', noSyncHint: 'Click "Sync" to pull issues from Jira.', autoSyncingTitle: 'Syncing…', autoSyncingHint: 'Pulling the latest issues from Jira automatically.',
  syncDone: 'Synced {total} issues ({added} added, {updated} updated)', syncFailed: 'Sync failed',
  startSync: 'Start sync', assigneeSelf: 'I am the assignee', reporterSelf: 'I am the reporter', syncSelfHint: 'OR semantics: matching either role includes the issue',
  previewQuery: 'Preview query', previewResult: 'Preview', resultCount: '{n} issues', resultEmpty: 'No matching issues', resultMore: '… and {n} more',
  configJiraFirst: 'Configure the Jira connection in settings first', settingsSaved: 'Settings saved', switchFailed: 'Failed to switch', loadFailed: 'Failed to load',
  issuesCount: '{n} issues', syncedAt: 'Synced {time}',
  searchPlaceholder: 'Search key / summary / assignee…', searchClear: 'Clear search', searchAria: 'Search',
  emptyGroup: 'No issues', noMatchGroup: 'No matching issues', openCardAria: 'Open {key} {summary}',
  switchBranchTitle: 'Switch branch', switchBranchPick: 'Multiple merge requests reference this issue — pick a branch to switch to:',
  branchSwitched: 'Switched to {branch}', branchSwitchFailed: 'Failed to switch branch',
  settingsTitle: 'Settings', tabJira: 'Jira', tabGitlab: 'GitLab',
  fieldBaseUrl: 'Base URL', fieldApiToken: 'API Token', fieldProjectKey: 'Project Key', fieldJql: 'JQL filter',
  tokenPlaceholder: '(leave blank to keep the saved token)', projectKeyPlaceholder: 'PROJ', jqlPlaceholder: '(blank = all)',
  fieldProjectPath: 'Project path', projectPathPlaceholder: 'group/repo', trustSelfSigned: 'Trust self-signed certificates',
  mrLinkSection: 'MR ↔ issue links', mrLinkAutoLabel: 'Auto-derive issue links from MR descriptions',
  mrLinkKeywordsLabel: 'Closing keywords', mrLinkKeywordsPlaceholder: 'closes, fix, resolve',
  mrLinkKeywordsHint: 'Comma-separated; blank = GitLab official list (close/closes/fix/fixes/resolve/resolves and variants)',
  mrLinkMentionsLabel: 'Plain #number mentions count as links (no closing)',
  testConnection: 'Test connection', save: 'Save', saveFailed: 'Failed to save',
  testOk: 'Connected: {user}', testFail: 'Failed: {error}', testing: 'Testing…',
  createIssueTitle: 'New issue', summaryLabel: 'Summary', summaryRequired: 'Summary is required',
  summaryPlaceholder: 'What needs to be done, in one line', issueTypeLabel: 'Issue type', selectType: 'Select type', select: 'Select',
  create: 'Create', creating: 'Creating…', createFailed: 'Failed to create', loadMetaFailed: 'Failed to load metadata', retry: 'Retry',
  assigneePlaceholder: 'Search users…', multiPlaceholder: 'Enter to add a new value, or pick a suggestion',
  assign: 'Assign', assigning: 'Assigning…', assignIssueTitle: 'Assign issue', assigneeLabel: 'Assignee',
  assignCommentLabel: 'Comment (optional)', assignCommentPlaceholder: 'Leave a message with the assignment…',
  assignedToast: 'Assigned to {name}', assignFailed: 'Failed to assign',
  gitlabTitle: 'GitLab workspace', tabIssues: 'Issues', tabMrs: 'Merge requests',
  stateAll: 'All', stateOpened: 'Open', stateClosed: 'Closed', stateMerged: 'Merged',
  createFromJira: 'New issue from Jira', createMr: 'New merge request', searchGitlab: 'Search…', refresh: 'Refresh', openGitlab: 'Open GitLab',
  noIssues: 'No issues', noIssuesHint: 'Try a different state filter, or create one from Jira.',
  noMrs: 'No merge requests', noMrsHint: 'Try a different state filter, or create a merge request.',
  linkJira: 'Link Jira', linkMr: 'Link MR', unlinkAria: 'Unlink {key}', copyAria: 'Copy {key}',
  closeIssueTitle: 'Close issue', closeIssueMsg: 'Close issue !{iid}?', closeMrTitle: 'Close merge request', closeMrMsg: 'Close MR !{iid}?',
  gitlabIssueCreated: 'GitLab issue created', jiraLinked: 'Jira linked', linked: 'Linked', mrCreated: 'Merge request created',
  closeFailed: 'Failed to close', linkFailed: 'Failed to link', unlinkFailed: 'Failed to unlink', mrCreateFailed: 'Failed to create MR',
  createIssueFromJiraTitle: 'New issue from Jira',
  selectJiraHint: 'Select Jira issues to merge into one GitLab issue — the title and description are generated automatically:',
  noJiraHint: 'No Jira issues available (sync the board first).',
  titleLabel: 'Title', titleAutoPlaceholder: 'Auto-generated from the selected Jira issues', descriptionLabel: 'Description',
  createCount: 'Create ({n})', linkJiraTitle: 'Link Jira · !{iid}',
  linkJiraHint: 'Select Jira issues to link to this issue:', link: 'Link', linking: 'Linking…', linkCount: 'Link ({n})',
  createMrTitle: 'New merge request', sourceModeAria: 'Source branch mode', existingBranch: 'Existing branch', newBranch: 'New branch',
  sourceBranch: 'Source branch', selectBranch: 'Select branch', newBranchName: 'New branch name',
  newBranchHint: 'Leave blank to use the suggested name (from linked issues or the title)', targetBranch: 'Target branch',
  mrTitleLabel: 'Title (optional)', mrTitlePlaceholder: 'Leave blank to use the source branch name', linkedIssuesLabel: 'Linked issues (optional)',
  noLinkedIssues: 'No issues available to link', filterJiraPlaceholder: 'Filter Jira issues…', filterIssuesPlaceholder: 'Filter issues…',
  selectedCount: '{n} selected', noMatch: 'No match', newBranchFallback: 'new-branch',
  linkIssueToMrTitle: 'Link issue !{iid} to a merge request', selectMrHint: 'Select a merge request:', linkAction: 'Link',
  branchRequired: 'Please select a source branch',
  statusChip: 'Status: {name}', typeChip: 'Type: {name}', priorityChip: 'Priority: {name}', assigneeChip: 'Assignee: {name}', reporterChip: 'Reporter: {name}', linkChip: 'Link',
  transitionsLabel: 'Transitions (click a target status to move the issue)', commentsLabel: 'Comments ({n})', attachmentsLabel: 'Attachments ({n})',
  noComments: 'No comments', commentPlaceholder: 'Write a comment… (paste images)', commentAria: 'Comment content',
  imageBtn: 'Image', uploading: 'Uploading…', pasteHint: 'Paste or choose an image — it is uploaded and inserted as a reference', comment: 'Comment',
  uploadFailed: 'Failed to upload', commentFailed: 'Failed to comment', removeAttachAria: 'Remove attachment {name}',
  delete: 'Delete', deleteIssueTitle: 'Delete issue', deleteIssueMsg: 'Delete {key}? This cannot be undone.', deleteFailed: 'Failed to delete',
  openInJira: 'Open in Jira', sendToSession: 'Send to session', sending: 'Sending…',
  sendTitle: 'Send to session for analysis',
  sendMsg: 'Send {key} ({n} images) to the session AI for analysis (analyze only, no modifications). Where to:',
  sendMsgNoImg: 'Send {key} to the session AI for analysis (analyze only, no modifications). Where to:',
  sendCurrent: 'Current session', sendNew: 'New session in current workspace',
  sentToast: 'Sent to the current session ({n} images attached)', sentToastNoImg: 'Sent to the current session', sendFailed: 'Failed to send',
  refreshDetail: 'Refresh', prevImage: 'Previous', nextImage: 'Next', unknownAuthor: 'Unknown',
  descriptionLabel2: 'Description',
  tvNoCache: 'No cached data — have the model run kanban-sync first.', tvEmptyCol: 'Empty',
  tvTransitions: 'Available transitions (move with kanban-move <key> <id>)', tvComments: '{n} comments.',
  tvProjects: 'Kanban projects', tvNoProjects: 'No projects — configure the Jira/GitLab host+token for the workspace, then sync.',
  tvSyncTitle: 'Sync complete', tvStatTotal: 'Total issues', tvStatAdded: 'Added', tvStatUpdated: 'Updated',
  tvLastSync: 'Last synced: {time}', tvFallback: '(no content)',
  cardDesc: 'Kanban plugin settings', unsaved: 'Unsaved', readOnlyNote: 'The settings document is read-only (memory mode or read-only provider)',
  cardSaveFailed: 'Save failed — draft kept, fix and retry', discard: 'Discard', saving: 'Saving…',
  overridden: 'Overridden', reset: 'Reset', resetAria: 'Reset {label}',
  cardNotMounted: 'Config card not mounted', cardNotMountedBody: 'The settings service (settingsScope) is not available; the web profile (dsh-web-app) provides it — start with dsh web.',
  cardNotExposed: 'Settings namespace dsh-kanban is not exposed to the web', cardNotExposedBody: 'The harness web gateway only exposes allowlisted settings namespaces (WEB_SETTINGS_NAMESPACES) to the settings panel. The host half is unaffected: kanban-* tools keep reading the config live.',
  cardNotExposedRemedy: 'To make this card editable: add dsh-kanban to WEB_SETTINGS_NAMESPACES in the harness, rebuild and restart.',
  cardLoading: 'Reading config…', cardLoadingBody: 'The card switches to editable once the namespace data arrives.',
  fieldGlobalJiraUrl: 'Global Jira baseUrl', fieldGlobalJiraUrlHint: 'Inherited by every workspace unless overridden.',
  fieldGlobalJiraToken: 'Global Jira API token', fieldGlobalJiraTokenHint: 'Secret is host-side only; leave blank to keep it, type a new value to update.',
  fieldGlobalGitlabUrl: 'Global GitLab baseUrl', fieldGlobalGitlabUrlHint: 'Inherited by every workspace unless overridden.',
  fieldGlobalGitlabToken: 'Global GitLab API token', fieldGlobalGitlabTokenHint: 'Secret is host-side only; leave blank to keep it, type a new value to update.',
  fieldDataDir: 'Local cache directory', fieldDataDirHint: 'Blank uses ~/.dsh/kanban (env KANBAN_DATA_DIR wins).',
  fieldAllowSelfSigned: 'Trust self-signed certificates', fieldAllowSelfSignedHint: 'Trust certificates for private GitLab / self-signed TLS (default on).',
  fieldVerbose: 'Verbose logs', fieldVerboseHint: 'Print plugin diagnostics when enabled.',
  headerButtonAria: 'Open dsh-kanban board',
  sendPrompt: 'Analyze the Jira issue {key}. First call the kanban-issue tool to see the latest details (description, comments, attachments). Attachments come with download URLs, but if you cannot view image content (the current model does not support image input), say so explicitly and base your analysis on the available text; analyze what this issue is about, the likely causes and impact, and give recommendations. Analyze and recommend only — do not modify anything.',
  sendPromptWithImages: 'Analyze the Jira issue {key}. First call the kanban-issue tool to see the latest details (description, comments). The related images are attached to this message — analyze them together with the text; analyze what this issue is about, the likely causes and impact, and give recommendations. Analyze and recommend only — do not modify anything.',
}

/* ---------------- 翻译入口 ---------------- */

const FALLBACK: LocaleSnapshotLike = { active: 'zh' }
const noopSubscribe = (): (() => void) => () => {}

function currentLocale(): string {
  try {
    return face?.getSnapshot().active ?? 'zh'
  } catch {
    return 'zh'
  }
}

/** 当前语言下的翻译函数（模板 {name} 插值；缺 key 回退英文）。 */
export function t(key: TKey, params?: Record<string, string | number>): string {
  const dict = currentLocale() === 'en' ? en : zh
  const template: string = dict[key] ?? en[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (m, name: string) => String(params[name] ?? m))
}

/** 组件内使用：订阅 locale 变化（语言切换自动重渲染）并返回翻译函数。 */
export function useT(): typeof t {
  useSyncExternalStore(
    localeSubscribe ?? noopSubscribe,
    localeGetSnapshot ?? (() => FALLBACK),
  )
  return t
}
