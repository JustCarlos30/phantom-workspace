import { inspectRepository, productionStyles } from '../scripts/storybook-inventory.mjs';

export default {
  stories: ['../src/stories/**/*.stories.jsx'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: '@storybook/react-vite',
  staticDirs: ['../assets'],
  async viteFinal(config) {
    config.plugins.push({
      name: 'phantom-catalog-inventory',
      resolveId(id) { if (id.startsWith('virtual:phantom-')) return `\0${id}`; },
      async load(id) {
        if (id === '\0virtual:phantom-inventory') { const report = await inspectRepository(); if (report.errors.length) throw new Error(report.errors.join('\n')); return `export default ${JSON.stringify(report)}`; }
        if (id === '\0virtual:phantom-styles') return (await productionStyles()).map(path => `import ${JSON.stringify(path.startsWith('src/') ? `/${path}` : path)};`).join('\n');
      },
    });
    config.plugins.unshift({ name: 'phantom-mobile-css-scope', enforce: 'pre', transform(code, id) { if (id.endsWith('/src/mobile.css')) return code.replace(':root {', '.mobile-app {').replace('* {', '.mobile-app * {').replace('body {', '.mobile-app {'); } });
    return config;
  },
};
