import { defineConfig } from 'vite';

export default defineConfig({
  // 部署在域名子路径时用环境变量覆盖，如挂到 example.com/roam/ 下：
  //   VITE_BASE=/roam/ pnpm build
  // 必须带首尾斜杠；不设置则按根路径部署（默认 "/"）
  base: process.env.VITE_BASE ?? '/',
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) {
            return 'three';
          }
        },
      },
    },
  },
});
