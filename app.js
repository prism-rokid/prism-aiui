export default {
  onLaunch() {
    const now = new Date();
    const pad = (value) => (value < 10 ? `0${value}` : String(value));
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    console.log('[PrismAIUI]', JSON.stringify({ time, event: 'app.launch' }));
  },

  // 原生 Agent Session Card（参考 diagnostic.agentsessioncards）：getAgent()
  // 只在 App 上下文里可用，页面通过 getApp() 调这两个方法驱动卡片。
  delegateCard: null,
  async sendDelegateCard(title, description) {
    const agent = this.getAgent();
    console.log('[PrismDelegate]', JSON.stringify({
      event: 'agent_session.capabilities',
      operations: agent && agent.capabilities && agent.capabilities.operations
    }));
    this.delegateCard = await agent.conversation.sendCard({ title, description });
    return this.delegateCard;
  },
  async updateDelegateCard(title, description) {
    if (!this.delegateCard) throw new Error('NO_DELEGATE_CARD');
    await this.delegateCard.update({ title, description });
  },

  globalData: {
    designWidth: 480,
    designHeight: 352,
    viewportWidth: 480,
    viewportHeight: 352,
    designScale: 1
  }
};
