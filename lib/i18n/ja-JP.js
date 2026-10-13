// 日本語パック。zh-CN 基準パックと同じキー・{プレースホルダ} を維持すること。

export default {
  // 共通
  'common.appName': 'プリズムパネル',
  'common.notConnected': '未接続',
  'common.loading': '読み込み中…',

  // 下部メニューボタン
  'menu.stopTask': 'タスク停止',
  'menu.hideMenu': 'メニュー非表示',
  'menu.voiceInput': '音声入力',
  'menu.doneSpeaking': '話し終えた',
  'menu.retry': 'やり直し',
  'menu.approve': '承認',
  'menu.stop': '停止',
  'menu.send': '送信',
  'menu.undoInput': '入力を取り消す',
  'menu.restore': '復元',

  // 設定 / コントロールパネル
  'controls.title.modelReasoning': 'モデルと推論',
  'controls.title.reasoning': '推論',
  'controls.title.permission': '権限',
  'controls.title.actions': '会話操作',
  'controls.modelPrefix': 'モデル {label}',
  'controls.reasoningPrefix': '推論 {label}',
  'controls.submitted': '設定を送信しました',
  'controls.submitFailed': '設定の送信に失敗しました：{error}',
  'controls.noSession': '操作できる会話がありません',
  'controls.noSettings': '利用できる設定がありません',


  // 承認パネル
  'approval.requestDefault': 'Agent が操作の承認を求めています',
  'approval.unavailable': '承認要求は利用できません',
  'approval.submitted': '承認要求を送信しました',
  'approval.failed': '承認に失敗しました：{error}',

  // 音声入力
  'voice.listeningHint': '録音中、タップで停止',
  'voice.recognizingHint': '認識中',
  'voice.inputFailed': '音声入力に失敗しました。やり直してください',
  'voice.notHeard': '聞き取れませんでした。もう一度入力してください',
  'voice.cannotStart': '音声入力を開始できません',
  'voice.unsupported': 'このデバイスは音声認識に対応していません',
  'voice.undone': '入力を取り消しました',
  'voice.restored': '先ほどの入力を復元しました',
  'voice.nothingToSend': '送信できる内容がありません',
  'voice.agentUnavailable': 'Agent は現在利用できません',
  'voice.sendFailed': '送信に失敗しました：{error}',
  'voice.stopSent': '停止要求を送信しました',
  'voice.stopFailed': '停止に失敗しました：{error}',
  'voice.error.startTimeout': '音声入力の開始がタイムアウトしました',
  'voice.error.sessionUnsupported': 'このデバイスは新しい音声認識に対応していません',
  'voice.error.recorderUnsupported': 'このデバイスは録音に対応していません',
  'voice.error.pcmUnsupported': 'このデバイスは 16kHz PCM 音声認識に対応していません',
  'voice.error.recognitionFailed': '音声認識に失敗しました',
  'voice.error.micFailed': 'マイクでの録音に失敗しました',
  'voice.error.resultTimeout': '音声認識の結果の待機がタイムアウトしました',
  'voice.error.stopTimeout': '録音の停止がタイムアウトしました',
  'voice.error.notStarted': '録音はまだ開始されていません',

  // 会話画面
  'chat.welcome': '接続後、グラスから Agent のセッションを確認・操作できます。',
  'chat.sending': '送信中',
  'chat.sendFailedStatus': '送信失敗',
  'chat.noMessages': 'このスレッドにはメッセージがありません',
  'chat.agentReplying': 'Agent が返信中',
  'chat.processedMeta': '{name} · 完了 {duration}',
  'chat.replyFailed': 'Agent の返信に失敗しました。後でもう一度お試しください',
  'chat.reconnected': 'Agent に再接続しました',
  'chat.planPrefix': '現在のステップ｜',
  'chat.unreadPrefix': ' 件の新着メッセージ｜',
  'chat.hintExitAgain': '戻るボタンをもう一度押すとアプリを終了します',
  'chat.hintMain': '長押しで音声入力 / タップでメニュー表示',
  'chat.hintInbox': 'タップで開く',
  'chat.hintMenu': 'タップでこの項目を実行 · 長押しで閉じる',
  'chat.ariaContextUsage': 'コンテキスト使用量',
  'chat.ariaChatProgress': '会話のスクロール進捗',
  'chat.ariaInboxProgress': '新着メッセージのスクロール進捗',

  // 受信トレイ（スレッド一覧）
  'inbox.today': '今日',
  'inbox.yesterday': '昨日',
  'inbox.earlier': 'それ以前',
  'inbox.untitledThread': '無題のスレッド',
  'inbox.untitledConversation': '無題の会話',
  'inbox.noRecentMessages': '最近のメッセージはありません',

  // 接続 / 同期状態
  'sync.noAgentAvailable': '利用可能な Agent がありません',
  'sync.remoteComputer': 'リモートPC',
  'sync.offline': 'ネットワーク未接続のため、Agent との接続が切断されました',
  'sync.agentUnavailableRetry': 'Agent は現在利用できません。後で自動的に再試行します',
  'sync.conversationGone': '会話は存在しません',

  // ストリームフィードバック
  'stream.operationFailed': '操作に失敗しました：{error}',
  'stream.retryHint': 'もう一度お試しください',
  'stream.bodyLoadFailed': '本文の読み込みに失敗しました：{error}',
  'stream.sendRetry': '送信に失敗しました。後でもう一度お試しください',

  // リモート API エラーマッピング
  'api.error.unauthorized': 'ログイン状態が失効しました',
  'api.error.permissionDenied': 'この Agent にアクセスする権限がありません',
  'api.error.hostOffline': 'ネットワーク未接続のため、Agent との接続が切断されました',
  'api.error.pluginUnavailable': 'Agent プラグインは現在利用できません',
  'api.error.conversationUnavailable': '会話は現在利用できません。後でお試しください',
  'api.error.conversationStartFailed': '会話の作成に失敗しました。もう一度お試しください',
  'api.error.draftStale': 'デスクトップの下書きが失効しました。もう一度送信してください',
  'api.error.controlTargetStale': '制御対象が失効しました。再読み込みしてやり直してください',
  'api.error.invalidParameter': '現在の会話またはリクエストパラメータが利用できません',
  'api.error.baseUrlMissing': 'Prism API アドレスを設定してください',
  'api.error.networkFailed': 'ネットワーク接続に失敗しました',

  // コンパクト表示ラベル
  'label.reasoning.high': '高',
  'label.reasoning.medium': '中',
  'label.reasoning.low': '低',
  'label.permission.fullAccess': '完全許可',
  'label.permission.autoApprove': '自動承認',
  'label.permission.requestApproval': '承認要求',
  'label.permission.custom': 'カスタム',
  'label.project.uncategorized': '未分類プロジェクト',
  'label.time.justNow': 'たった今',
  'label.time.minutesAgo': '{n}分前',
  'label.time.hoursAgo': '{n}時間前',
  'label.time.yesterday': '昨日',
  'label.time.daysAgo': '{n}日前',
  'label.time.date': '{m}月{d}日',

  // 起動 / 接続ガイド
  'boot.slowLoadRetry': 'メッセージの読み込みが遅れています。バックグラウンドで再試行中',
  'boot.deviceAuthFailed': 'デバイスの認証情報を取得できません',
  'boot.guideTitle': 'まずデスクトップで接続してください',
  'boot.guideHint': 'ダウンロード：prism.rokid.com',
  'boot.connectingAgent': 'リモート Agent に接続中…',

  // Desktop widgets
  'widget.syncing': '同期中',
  'widget.syncFailed': '現在同期できません',
  'widget.noConversations': '最近の会話はありません',
  'widget.working': '実行中',
  'widget.unread': '未読'
};
