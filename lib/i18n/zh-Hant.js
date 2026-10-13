// Traditional Chinese (zh-Hant) pack, worded for both Taiwan and Hong Kong
// users with region-neutral terms; keeps the same keys and {placeholders}
// as the zh-CN source pack.

export default {
  // Shared
  'common.appName': '棱鏡面板',
  'common.notConnected': '未連接',
  'common.loading': '正在載入···',

  // Bottom menu buttons
  'menu.stopTask': '停止任務',
  'menu.hideMenu': '隱藏選單',
  'menu.voiceInput': '語音輸入',
  'menu.doneSpeaking': '說完了',
  'menu.retry': '重試',
  'menu.approve': '審批',
  'menu.stop': '停止',
  'menu.send': '傳送',
  'menu.undoInput': '撤銷輸入',
  'menu.restore': '恢復',

  // Settings / control panel
  'controls.title.modelReasoning': '模型與推理',
  'controls.title.reasoning': '推理',
  'controls.title.permission': '權限',
  'controls.title.actions': '會話操作',
  'controls.modelPrefix': '模型 {label}',
  'controls.reasoningPrefix': '推理 {label}',
  'controls.submitted': '設定已提交',
  'controls.submitFailed': '設定失敗：{error}',
  'controls.noSession': '目前沒有可控制的會話',
  'controls.noSettings': '目前沒有可用設定',


  // Approval panel
  'approval.requestDefault': 'Agent 請求批准操作',
  'approval.unavailable': '審批請求不可用',
  'approval.submitted': '審批請求已提交',
  'approval.failed': '審批失敗：{error}',

  // Voice input
  'voice.listeningHint': '正在收音，單擊停止',
  'voice.recognizingHint': '正在辨識',
  'voice.inputFailed': '語音輸入失敗，請重試',
  'voice.notHeard': '沒有聽清楚，請重新輸入',
  'voice.cannotStart': '無法開始語音輸入',
  'voice.unsupported': '此裝置不支援語音辨識',
  'voice.undone': '已撤銷輸入',
  'voice.restored': '已恢復剛才的輸入',
  'voice.nothingToSend': '沒有可傳送的內容',
  'voice.agentUnavailable': 'Agent 目前不可用',
  'voice.sent': '已傳送，等待 Agent 回覆',
  'voice.sendFailed': '傳送失敗：{error}',
  'voice.stopSent': '停止請求已傳送',
  'voice.stopFailed': '停止失敗：{error}',
  'voice.error.startTimeout': '啟動語音輸入逾時',
  'voice.error.sessionUnsupported': '此裝置不支援新版語音辨識',
  'voice.error.recorderUnsupported': '此裝置不支援錄音',
  'voice.error.pcmUnsupported': '此裝置不支援 16kHz PCM 語音辨識',
  'voice.error.recognitionFailed': '語音辨識失敗',
  'voice.error.micFailed': '麥克風錄音失敗',
  'voice.error.resultTimeout': '等待語音辨識結果逾時',
  'voice.error.stopTimeout': '停止錄音逾時',
  'voice.error.notStarted': '錄音尚未啟動',

  // Conversation screen
  'chat.welcome': '連接遠端服務後，可在眼鏡上繼續查看和控制 Agent 會話。',
  'chat.sending': '傳送中',
  'chat.sendFailedStatus': '傳送失敗',
  'chat.noMessages': '目前對話串暫無訊息',
  'chat.agentReplying': 'Agent 正在回覆',
  'chat.processedMeta': '{name} · 已處理 {duration}',
  'chat.replyFailed': 'Agent 回覆失敗，請稍後重試',
  'chat.reconnected': 'Agent 已重新連接',
  'chat.planPrefix': '目前步驟｜',
  'chat.unreadPrefix': ' 則新訊息｜',
  'chat.hintExitAgain': '再按一次返回鍵退出應用',
  'chat.hintMain': '長按語音輸入 / 單擊展開選單',
  'chat.hintInbox': '單擊進入',
  'chat.hintMenu': '單擊執行目前項目 · 長按關閉選單',
  'chat.ariaContextUsage': '上下文用量',
  'chat.ariaChatProgress': '對話捲動進度',
  'chat.ariaInboxProgress': '新訊息捲動進度',

  // Inbox list
  'inbox.today': '今天',
  'inbox.yesterday': '昨天',
  'inbox.earlier': '更早之前',
  'inbox.untitledThread': '未命名對話串',
  'inbox.untitledConversation': '未命名會話',
  'inbox.noRecentMessages': '暫無最近訊息',

  // Connection / sync state
  'sync.noAgentAvailable': '無可用 Agent',
  'sync.remoteComputer': '遠端電腦',
  'sync.offline': '目前離線，Agent 連接已中斷',
  'sync.agentUnavailableRetry': 'Agent 目前不可用，稍後自動重試',
  'sync.conversationGone': '會話已不存在',

  // Stream frame feedback
  'stream.operationFailed': '操作失敗：{error}',
  'stream.retryHint': '請重試',
  'stream.bodyLoadFailed': '正文載入失敗：{error}',
  'stream.sendRetry': '傳送失敗，請稍後重試',

  // Remote API error mapping
  'api.error.unauthorized': '登入狀態已失效',
  'api.error.permissionDenied': '沒有權限存取此 Agent',
  'api.error.hostOffline': '目前離線，Agent 連接已中斷',
  'api.error.pluginUnavailable': 'Agent 外掛暫不可用',
  'api.error.conversationUnavailable': '會話目前不可用，請稍後重試',
  'api.error.conversationStartFailed': '會話建立失敗，請重試',
  'api.error.draftStale': '桌面草稿已失效，請重新傳送',
  'api.error.controlTargetStale': '控制目標已過期，請重新整理後重試',
  'api.error.invalidParameter': '目前會話或請求參數不可用',
  'api.error.baseUrlMissing': '請設定 Prism API 地址',
  'api.error.networkFailed': '連接失敗',

  // Compact display labels
  'label.reasoning.high': '高',
  'label.reasoning.medium': '中',
  'label.reasoning.low': '低',
  'label.permission.fullAccess': '完全存取',
  'label.permission.autoApprove': '代我審批',
  'label.permission.requestApproval': '請求批准',
  'label.permission.custom': '自訂',
  'label.project.uncategorized': '未分類項目',
  'label.time.justNow': '剛剛',
  'label.time.minutesAgo': '{n}分鐘前',
  'label.time.hoursAgo': '{n}小時前',
  'label.time.yesterday': '昨天',
  'label.time.daysAgo': '{n}天前',
  'label.time.date': '{m}月{d}日',

  // Boot / connection guide
  'boot.slowLoadRetry': '訊息載入較慢，正在背景重試',
  'boot.deviceAuthFailed': '無法取得裝置授權',
  'boot.guideTitle': '請先在桌面端建立連接',
  'boot.guideHint': '下載地址：prism.rokid.com',
  'boot.connectingAgent': '正在連接遠端 Agent…',

  // Desktop widgets
  'widget.syncing': '正在同步',
  'widget.syncFailed': '暫時無法同步狀態',
  'widget.noConversations': '暫無最近會話',
  'widget.working': '工作中',
  'widget.unread': '未讀'
};
