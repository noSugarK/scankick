import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import os from 'node:os';

// 开发时大屏若用 localhost 打开，二维码需要换成局域网 IP 才能被手机访问
function lanIp(): string {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal && !ni.address.startsWith('169.254.')) return ni.address;
    }
  }
  return '';
}

export default defineConfig(({ command, mode }) => ({
  // 相对路径 + hash 路由：部署到 GitHub Pages 任意仓库名下都能直接用
  base: './',
  // 手机端的屏幕常亮、全屏等能力需要 HTTPS；NO_HTTPS=1 可关闭（本机调试用）
  plugins: command === 'serve' && mode !== 'app' && !process.env.NO_HTTPS ? [basicSsl()] : [],
  define: {
    __DEV_LAN_IP__: JSON.stringify(command === 'serve' ? lanIp() : ''),
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: { target: 'es2020' },
}));
