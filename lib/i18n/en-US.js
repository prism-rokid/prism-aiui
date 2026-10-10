// English (US) locale pack. Keys, order, and {placeholders} mirror the
// zh-CN source pack.

export default {
  // Shared
  'common.appName': 'Prism Panel',
  'common.notConnected': 'Not connected',
  'common.loading': 'Loading…',

  // Bottom menu buttons
  'menu.stopTask': 'Stop task',
  'menu.hideMenu': 'Hide menu',
  'menu.voiceInput': 'Voice input',
  'menu.doneSpeaking': "I'm done",
  'menu.retry': 'Retry',
  'menu.approve': 'Approve',
  'menu.stop': 'Stop',
  'menu.send': 'Send',
  'menu.undoInput': 'Undo input',
  'menu.restore': 'Restore',

  // Settings / control panel
  'controls.title.modelReasoning': 'Model & reasoning',
  'controls.title.reasoning': 'Reasoning',
  'controls.title.permission': 'Permissions',
  'controls.title.actions': 'Conversation actions',
  'controls.modelPrefix': 'Model {label}',
  'controls.reasoningPrefix': 'Reasoning {label}',
  'controls.submitted': 'Settings submitted',
  'controls.submitFailed': 'Failed to submit: {error}',
  'controls.noSession': 'No conversation to control',
  'controls.noSettings': 'No settings available',


  // Approval panel
  'approval.requestDefault': 'Agent requests approval',
  'approval.unavailable': 'Approval request unavailable',
  'approval.submitted': 'Approval submitted',
  'approval.failed': 'Approval failed: {error}',

  // Voice input
  'voice.listeningHint': 'Listening, tap to stop',
  'voice.recognizingHint': 'Recognizing',
  'voice.inputFailed': 'Voice input failed, try again',
  'voice.notHeard': "Didn't catch that, try again",
  'voice.cannotStart': 'Cannot start voice input',
  'voice.unsupported': 'Speech recognition is not supported on this device',
  'voice.undone': 'Input undone',
  'voice.restored': 'Input restored',
  'voice.nothingToSend': 'Nothing to send',
  'voice.agentUnavailable': 'Agent is unavailable',
  'voice.sent': 'Sent, waiting for Agent reply',
  'voice.sendFailed': 'Failed to send: {error}',
  'voice.stopSent': 'Stop request sent',
  'voice.stopFailed': 'Failed to stop: {error}',
  'voice.error.startTimeout': 'Timed out starting voice input',
  'voice.error.sessionUnsupported': 'New speech recognition is not supported on this device',
  'voice.error.recorderUnsupported': 'Recording is not supported on this device',
  'voice.error.pcmUnsupported': '16kHz PCM speech recognition is not supported on this device',
  'voice.error.recognitionFailed': 'Speech recognition failed',
  'voice.error.micFailed': 'Microphone recording failed',
  'voice.error.resultTimeout': 'Timed out waiting for recognition result',
  'voice.error.stopTimeout': 'Timed out stopping recording',
  'voice.error.notStarted': 'Recording has not started',

  // Conversation screen
  'chat.welcome': 'Connect to the remote service to view and control Agent conversations on your glasses.',
  'chat.sending': 'Sending',
  'chat.sendFailedStatus': 'Send failed',
  'chat.noMessages': 'No messages in this thread yet',
  'chat.agentReplying': 'Agent is replying',
  'chat.processedMeta': '{name} · done in {duration}',
  'chat.replyFailed': 'Agent reply failed, try again later',
  'chat.reconnected': 'Agent reconnected',
  'chat.planPrefix': 'Step | ',
  'chat.unreadPrefix': ' new messages | ',
  'chat.hintExitAgain': 'Press back again to exit',
  'chat.hintMain': 'Hold to talk / tap for menu',
  'chat.hintInbox': 'Tap to open',
  'chat.hintMenu': 'Tap to run · hold to close menu',
  'chat.ariaContextUsage': 'Context usage',
  'chat.ariaChatProgress': 'Conversation scroll progress',
  'chat.ariaInboxProgress': 'New message scroll progress',

  // Inbox list
  'inbox.today': 'Today',
  'inbox.yesterday': 'Yesterday',
  'inbox.earlier': 'Earlier',
  'inbox.untitledThread': 'Untitled thread',
  'inbox.untitledConversation': 'Untitled conversation',
  'inbox.noRecentMessages': 'No recent messages',

  // Connection / sync state
  'sync.noAgentAvailable': 'No Agent available',
  'sync.remoteComputer': 'Remote computer',
  'sync.offline': 'Offline, Agent disconnected',
  'sync.agentUnavailableRetry': 'Agent unavailable, retrying automatically',
  'sync.conversationGone': 'Conversation no longer exists',

  // Stream frame feedback
  'stream.operationFailed': 'Operation failed: {error}',
  'stream.retryHint': 'Please retry',
  'stream.bodyLoadFailed': 'Failed to load content: {error}',
  'stream.sendRetry': 'Send failed, try again later',

  // Remote API error mapping
  'api.error.unauthorized': 'Sign-in expired',
  'api.error.permissionDenied': 'No access to this Agent',
  'api.error.hostOffline': 'Offline, Agent disconnected',
  'api.error.pluginUnavailable': 'Agent plugin temporarily unavailable',
  'api.error.conversationUnavailable': 'Conversation unavailable, try again later',
  'api.error.conversationStartFailed': 'Failed to create conversation, try again',
  'api.error.draftStale': 'Desktop draft expired, send again',
  'api.error.controlTargetStale': 'Control target expired, refresh and retry',
  'api.error.invalidParameter': 'Invalid conversation or request parameters',
  'api.error.baseUrlMissing': 'Set the Prism API address',
  'api.error.networkFailed': 'Network connection failed',

  // Compact display labels
  'label.reasoning.high': 'High',
  'label.reasoning.medium': 'Med',
  'label.reasoning.low': 'Low',
  'label.permission.fullAccess': 'Full access',
  'label.permission.autoApprove': 'Auto-approve',
  'label.permission.requestApproval': 'Approve on request',
  'label.permission.custom': 'Custom',
  'label.project.uncategorized': 'Uncategorized project',
  'label.time.justNow': 'Just now',
  'label.time.minutesAgo': '{n} min ago',
  'label.time.hoursAgo': '{n} hr ago',
  'label.time.yesterday': 'Yesterday',
  'label.time.daysAgo': '{n} d ago',
  'label.time.date': '{m}/{d}',

  // Boot / connection guide
  'boot.slowLoadRetry': 'Still loading, retrying in background',
  'boot.deviceAuthFailed': 'Failed to get device authorization',
  'boot.guideTitle': 'Connect from the desktop app first',
  'boot.guideHint': 'Download at prism.rokid.com',
  'boot.connectingAgent': 'Connecting to remote Agent…',
  'boot.betaExpiredTitle': 'The beta period has ended',
  'boot.betaExpiredHint': 'Please install the official version from the Agent Store',

  // Desktop widgets
  'widget.syncing': 'Syncing',
  'widget.syncFailed': "Can't sync status right now",
  'widget.noConversations': 'No recent conversations',
  'widget.working': 'Working',
  'widget.unread': 'Unread'
};
