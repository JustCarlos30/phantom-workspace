import React from 'react';
import { VoiceActivity, VoiceTranscript, dictationPreview } from '../components/VoiceActivity';
import { VoiceCapture } from '../components/VoiceCapture';
import { VoiceDictation } from '../components/VoiceDictation';
import { VoiceLauncher } from '../components/VoiceProvider';
import { demo } from './decorators';
import { noop, workspace } from './fixtures';

export default { title: 'Voz', parameters: { docs: { description: { component: 'UI real. getUserMedia se rechaza localmente antes de solicitar permisos; nivel y transcripción del indicador son datos sintéticos.' } } } };
export const Indicador = { args: { status: 'recording', level: 0.4 }, argTypes: { status: { control: 'select', options: ['requesting', 'recording', 'transcribing'] }, level: { control: { type: 'range', min: 0, max: 1, step: 0.1 } } }, render: args => {
  const voice = { ...args, mode: 'live', live: { confirmed: 'Transcripción sintética.', partial: 'Texto en curso…' }, cancel: noop };
  return <section className="catalog-sample pc" aria-label="Fixture sintético de dictado"><div className="pc-composer" data-dictating><div className="pc-field"><div className="pc-input" data-preview><VoiceTranscript voice={voice} draft="Borrador." /><textarea aria-label="Transcripción sintética" readOnly value={dictationPreview(voice, 'Borrador.')} /></div><div className="pc-controls"><VoiceActivity voice={voice} onFinish={noop} hint="Esc descarta · Enter envía" /></div></div></div></section>;
} };
export const Captura = { render: () => <VoiceCapture {...demo} open initialText="Preparar un borrador sintético con el catálogo." /> };
export const Dictado = { render: () => <VoiceDictation {...demo} target={{ workspaceId: workspace.id, label: 'Sin campo seleccionado', kind: 'none' }} /> };
export const Lanzador = { render: () => <div className="catalog-page"><label>Campo de prueba<input aria-label="Campo de prueba" /></label><VoiceLauncher /><p>Enfoca el campo y usa Ctrl/Cmd + Shift + M.</p></div> };
