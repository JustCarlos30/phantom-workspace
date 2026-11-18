import 'virtual:phantom-styles';
import '../src/stories/catalog.css';
import { catalogDecorator, beforeStory } from '../src/stories/decorators';

export default {
  tags: ['autodocs'],
  decorators: [catalogDecorator],
  beforeEach: beforeStory,
  afterEach: context => { document.documentElement.dataset.catalogRendered = context.id; },
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'todo' },
    controls: { expanded: true },
    docs: { story: { inline: false, height: '760px' } },
    options: { storySort: { order: ['Catálogo', 'Fundamentos', 'Primitivas', 'Identidad', 'Navegación', 'Actividad', 'Conversaciones', 'Herramientas', 'Phantom', 'Git', 'Contenido', 'Ajustes', 'Voz', 'Fondos'] } },
  },
};
