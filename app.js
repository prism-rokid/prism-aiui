export default {
  onLaunch() {
    const now = new Date();
    const pad = (value) => (value < 10 ? `0${value}` : String(value));
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    console.log('[PrismAIUI]', JSON.stringify({ time, event: 'app.launch' }));
  },
  globalData: {
    designWidth: 480,
    designHeight: 352,
    viewportWidth: 480,
    viewportHeight: 352,
    designScale: 1
  }
};
