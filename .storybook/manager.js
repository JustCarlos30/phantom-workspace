import { addons } from 'storybook/manager-api';
import { create } from 'storybook/theming';

addons.setConfig({ theme: create({ base: 'dark', brandTitle: 'Phantom · Sistema UI', brandUrl: '?path=/story/catálogo--inventario', colorPrimary: '#f2f0eb', colorSecondary: '#5b9cff', appBg: '#050505', appContentBg: '#0d0d0d', textColor: '#f2f0eb' }), sidebar: { showRoots: true } });
