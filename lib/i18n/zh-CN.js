// Simplified Chinese source pack. Values mirror the original product copy
// verbatim; every other locale pack must keep the same keys and {placeholders}.

export default {
  // Shared
  'common.appName': '棱镜面板',
  'common.notConnected': '未连接',
  'common.loading': '正在加载···',

  // Bottom menu buttons
  'menu.stopTask': '停止任务',
  'menu.hideMenu': '隐藏菜单',
  'menu.voiceInput': '语音输入',
  'menu.doneSpeaking': '说完了',
  'menu.retry': '重试',
  'menu.approve': '审批',
  'menu.stop': '停止',
  'menu.send': '发送',
  'menu.undoInput': '撤销输入',
  'menu.restore': '恢复',

  // Settings / control panel
  'controls.title.modelReasoning': '模型与推理',
  'controls.title.reasoning': '推理',
  'controls.title.permission': '权限',
  'controls.title.actions': '会话操作',
  'controls.modelPrefix': '模型 {label}',
  'controls.reasoningPrefix': '推理 {label}',
  'controls.submitted': '设置已提交',
  'controls.submitFailed': '设置失败：{error}',
  'controls.noSession': '当前没有可控制的会话',
  'controls.noSettings': '当前没有可用设置',


  // Approval panel
  'approval.requestDefault': 'Agent 请求批准操作',
  'approval.unavailable': '审批请求不可用',
  'approval.submitted': '审批请求已提交',
  'approval.failed': '审批失败：{error}',

  // Voice input
  'voice.listeningHint': '正在收音，单击停止',
  'voice.recognizingHint': '正在识别',
  'voice.inputFailed': '语音输入失败，请重试',
  'voice.notHeard': '没有听清，请重新输入',
  'voice.cannotStart': '无法开始语音输入',
  'voice.unsupported': '当前设备不支持语音识别',
  'voice.undone': '已撤销输入',
  'voice.restored': '已恢复刚才的输入',
  'voice.nothingToSend': '没有可发送的内容',
  'voice.agentUnavailable': 'Agent 当前不可用',
  'voice.sendFailed': '发送失败：{error}',
  'voice.stopSent': '停止请求已发送',
  'voice.stopFailed': '停止失败：{error}',
  'voice.error.startTimeout': '启动语音输入超时',
  'voice.error.sessionUnsupported': '当前设备不支持新版语音识别',
  'voice.error.recorderUnsupported': '当前设备不支持录音',
  'voice.error.pcmUnsupported': '当前设备不支持 16kHz PCM 语音识别',
  'voice.error.recognitionFailed': '语音识别失败',
  'voice.error.micFailed': '麦克风录音失败',
  'voice.error.resultTimeout': '等待语音识别结果超时',
  'voice.error.stopTimeout': '停止录音超时',
  'voice.error.notStarted': '录音尚未启动',

  // Conversation screen
  'chat.welcome': '连接远程服务后，可在眼镜上继续查看和控制 Agent 会话。',
  'chat.sending': '发送中',
  'chat.sendFailedStatus': '发送失败',
  'chat.noMessages': '当前线程暂无消息',
  'chat.agentReplying': 'Agent 正在回复',
  'chat.processedMeta': '{name} · 已处理 {duration}',
  'chat.replyFailed': 'Agent 回复失败，请稍后重试',
  'chat.reconnected': 'Agent 已重新连接',
  'chat.planPrefix': '当前步骤｜',
  'chat.unreadPrefix': ' 条新消息｜',
  'chat.hintExitAgain': '再次按返回键退出应用',
  'chat.hintMain': '长按语音输入 / 单击展开菜单',
  'chat.hintInbox': '单击进入',
  'chat.hintMenu': '单击执行当前项 · 长按关闭菜单',
  'chat.ariaContextUsage': '上下文用量',
  'chat.ariaChatProgress': '对话滚动进度',
  'chat.ariaInboxProgress': '新消息滚动进度',

  // Inbox list
  'inbox.today': '今天',
  'inbox.yesterday': '昨天',
  'inbox.earlier': '更早之前',
  'inbox.untitledThread': '未命名线程',
  'inbox.untitledConversation': '未命名会话',
  'inbox.noRecentMessages': '暂无最近消息',

  // Connection / sync state
  'sync.noAgentAvailable': '无可用 Agent',
  'sync.remoteComputer': '远程电脑',
  'sync.offline': '当前无网络，Agent 连接已断开',
  'sync.agentUnavailableRetry': 'Agent 当前不可用，稍后自动重试',
  'sync.conversationGone': '会话已不存在',

  // Stream frame feedback
  'stream.operationFailed': '操作失败：{error}',
  'stream.retryHint': '请重试',
  'stream.bodyLoadFailed': '正文加载失败：{error}',
  'stream.sendRetry': '发送失败，请稍后重试',

  // Remote API error mapping
  'api.error.unauthorized': '登录状态已失效',
  'api.error.permissionDenied': '没有权限访问当前 Agent',
  'api.error.hostOffline': '当前无网络，Agent 连接已断开',
  'api.error.pluginUnavailable': 'Agent 插件暂不可用',
  'api.error.conversationUnavailable': '会话当前不可用，请稍后重试',
  'api.error.conversationStartFailed': '会话创建失败，请重试',
  'api.error.draftStale': '桌面草稿已失效，请重新发送',
  'api.error.controlTargetStale': '控制目标已过期，请刷新后重试',
  'api.error.invalidParameter': '当前会话或请求参数不可用',
  'api.error.baseUrlMissing': '请配置 Prism API 地址',
  'api.error.networkFailed': '网络连接失败',

  // Compact display labels
  'label.reasoning.high': '高',
  'label.reasoning.medium': '中',
  'label.reasoning.low': '低',
  'label.permission.fullAccess': '完全访问',
  'label.permission.autoApprove': '替我审批',
  'label.permission.requestApproval': '请求批准',
  'label.permission.custom': '自定义',
  'label.project.uncategorized': '未分类项目',
  'label.time.justNow': '刚刚',
  'label.time.minutesAgo': '{n}分钟前',
  'label.time.hoursAgo': '{n}小时前',
  'label.time.yesterday': '昨天',
  'label.time.daysAgo': '{n}天前',
  'label.time.date': '{m}月{d}日',

  // Boot / connection guide
  'boot.slowLoadRetry': '消息加载较慢，正在后台重试',
  'boot.deviceAuthFailed': '无法获取设备授权',
  'boot.guideTitle': '请先在桌面端建立连接',
  'boot.guideHint': '下载地址：prism.rokid.com',
  'boot.connectingAgent': '正在连接远程 Agent…',

  // Desktop widgets
  'widget.syncing': '正在同步',
  'widget.syncFailed': '暂时无法同步状态',
  'widget.noConversations': '暂无最近会话',
  'widget.working': '工作中',
  'widget.unread': '未读'
};
