import React from 'react';
import { VoiceActivity, VoiceTranscript, dictationPreview } from '../components/VoiceActivity';
import { VoiceCapture } from '../components/VoiceCapture';
import { VoiceDictation } from '../components/VoiceDictation';
import { VoiceLauncher } from '../components/VoiceProvider';
import { demo } from './decorators';
import { noop, workspace } from './fixtures';
import { Compositor320 } from './Conversations.stories';
import { expect, waitFor, within, userEvent } from 'storybook/test';

export default { title: 'Voz', parameters: { docs: { description: { component: 'UI real. getUserMedia se rechaza localmente antes de solicitar permisos; nivel y transcripción del indicador son datos sintéticos.' } } } };
export const Indicador = { args: { status: 'recording', level: 0.4 }, argTypes: { status: { control: 'select', options: ['requesting', 'recording', 'transcribing'] }, level: { control: { type: 'range', min: 0, max: 1, step: 0.1 } } }, render: args => {
  const voice = { ...args, mode: 'live', live: { confirmed: 'Transcripción sintética.', partial: 'Texto en curso…' }, cancel: noop };
  return <section className="catalog-sample pc" aria-label="Fixture sintético de dictado"><div className="pc-composer" data-dictating><div className="pc-field"><div className="pc-input" data-preview><VoiceTranscript voice={voice} draft="Borrador." /><textarea aria-label="Transcripción sintética" readOnly value={dictationPreview(voice, 'Borrador.')} /></div><div className="pc-controls"><VoiceActivity voice={voice} onFinish={noop} hint="Esc descarta · Enter envía" /></div></div></div></section>;
} };
export const Captura = { render: () => <VoiceCapture {...demo} open initialText="Preparar un borrador sintético con el catálogo." /> };
export const Dictado = { render: () => <VoiceDictation {...demo} target={{ workspaceId: workspace.id, label: 'Sin campo seleccionado', kind: 'none' }} /> };
export const Lanzador = { render: () => <div className="catalog-page"><label>Campo de prueba<input aria-label="Campo de prueba" /></label><VoiceLauncher /><p>Enfoca el campo y usa Ctrl/Cmd + Shift + M.</p></div> };

function SyntheticAudio(Story) {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const media = navigator.mediaDevices, original = media.getUserMedia, sources = [];
    media.getUserMedia = async () => {
      const context = new AudioContext(), oscillator = context.createOscillator(), gain = context.createGain(), output = context.createMediaStreamDestination();
      gain.gain.value = .02;
      oscillator.connect(gain); gain.connect(output); oscillator.start();
      sources.push({ context, oscillator, stream: output.stream });
      await context.resume();
      return output.stream;
    };
    setReady(true);
    return () => {
      media.getUserMedia = original;
      for (const source of sources) { source.stream.getTracks().forEach(track => track.stop()); source.oscillator.stop(); source.context.close(); }
    };
  }, []);
  return ready ? <Story /> : <p role="status">Preparando audio sintético…</p>;
}

const voiceHost = { overrides: {
  'voice.stream.warm': () => ({}),
  'voice.stream.start': () => ({ sessionId: 'synthetic-composer-audio' }),
  'voice.stream.push': () => ({ confirmed: 'Texto sintético para revisar.', partial: 'Continuación en curso…' }),
  'voice.stream.finish': () => ({ confirmed: 'Texto sintético para revisar antes de enviar.' }),
  'voice.stream.cancel': () => ({}),
} };
const startDictation = async canvasElement => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('button', { name: /^Dictar/ }));
  const finish = await canvas.findByRole('button', { name: 'Terminar dictado', exact: true });
  await waitFor(() => expect(finish).toBeEnabled());
  return finish;
};
export const CompositorGrabando = { ...Compositor320, decorators: [SyntheticAudio], parameters: { host: voiceHost, docs: { description: { story: 'ChatCard/PhantomChat y recorder reales; MediaStream generado sin micrófono ni altavoz y ASR sintético. Ancho y superficie se eligen en Controls.' } } }, play: async ({ canvasElement }) => { await startDictation(canvasElement); } };
export const CompositorTranscribiendo = { ...CompositorGrabando, parameters: { ...CompositorGrabando.parameters, host: { overrides: { ...voiceHost.overrides, 'voice.stream.finish': () => new Promise(() => {}) } } }, play: async ({ canvasElement }) => {
  await userEvent.click(await startDictation(canvasElement));
  await within(canvasElement).findByText('Transcribiendo…');
} };
export const CompositorRevision = { ...CompositorGrabando, play: async ({ canvasElement }) => {
  await userEvent.click(await startDictation(canvasElement));
  await waitFor(() => expect(within(canvasElement).getByRole('textbox', { name: /^Mensaje para/ })).toHaveValue('Texto sintético para revisar antes de enviar.'));
} };
export const DockGrabando = { ...CompositorGrabando, args: { ...Compositor320.args, surface: 'dock' } };
export const DockTranscribiendo = { ...CompositorTranscribiendo, args: { ...Compositor320.args, surface: 'dock' } };
export const DockRevision = { ...CompositorRevision, args: { ...Compositor320.args, surface: 'dock' } };
