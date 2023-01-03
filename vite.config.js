import { defineConfig } from 'vite';
import vitePluginImp from 'vite-plugin-imp';
import reactRefresh from '@vitejs/plugin-react-refresh';
// const ESLintPlugin = require('eslint-webpack-plugin');

const path = require('path');

export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
    esbuild: {
        // jsxFragment: 'Fragment'
        // jsxInject: `import React from 'react'`
    },
    // 预构建, 默认node_modules 加入
    // https://cn.vitejs.dev/config/dep-optimization-options.html#optimizedeps-entries
    optimizeDeps: {
        // 排除预构建包
        // exclude: ['react', 'react-dom', 'lodash-es'],
        // include: ['react', 'react-dom', 'lodash'],
    },
    plugins: [
        reactRefresh(),
        vitePluginImp({
            libList: [
                {
                    libName: 'antd',
                    libDirectory: 'es',
                    style: name => `antd/es/${name}/style`,
                },
            ],
        }),
    ],
    css: {
        preprocessorOptions: {
            less: {
                javascriptEnabled: true,
            },
        },
    },
    server: {
        // open: '/index.html'
    },
});
