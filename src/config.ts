// 网络配置：国内可用的信令（MQTT over WSS）与 STUN/TURN
export const CONFIG = {
  // 依次尝试，第一个能连上的作为信令通道；也作为 P2P 失败时的中继兜底
  brokers: [
    'wss://broker-cn.emqx.io:8084/mqtt',
    'wss://broker.emqx.io:8084/mqtt',
  ],
  // v2 使用 32 位输入序号，隔离仍在使用旧输入协议的页面。
  topicPrefix: 'scanfb/v2',
  iceServers: [
    { urls: ['stun:stun.miwifi.com:3478', 'stun:stun.chat.bilibili.com:3478'] },
    // 有自建 coturn 时在这里加上，可显著提高 4G 下的直连成功率：
    // { urls: 'turn:your.server:3478', username: 'user', credential: 'pass' },
  ] as RTCIceServer[],
  // 超过该时间 P2P 仍未建立，则改走 MQTT 中继
  p2pTimeoutMs: 6000,
  maxPerTeam: 4,
  // 观战人数上限：每个观战者都要单独收发快照，主机带宽有限
  maxWatchers: 12,
};
