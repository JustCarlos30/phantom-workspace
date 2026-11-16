import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const script = String.raw`
import sys, types, importlib.util
try:
    import numpy as np
except ModuleNotFoundError:
    sys.exit(77)
class VadOptions:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)
class WhisperModel:
    def __init__(self):
        self.calls = []
        self.text = "nueva frase"
    def transcribe(self, audio, **kwargs):
        self.calls.append(kwargs)
        return iter([types.SimpleNamespace(text=self.text, end=0.2)]), None
speech = []
whisper = types.ModuleType("faster_whisper")
whisper.WhisperModel = WhisperModel
vad = types.ModuleType("faster_whisper.vad")
vad.VadOptions = VadOptions
vad.get_speech_timestamps = lambda audio, options: speech
sys.modules["faster_whisper"] = whisper
sys.modules["faster_whisper.vad"] = vad
spec = importlib.util.spec_from_file_location("voice-stream", sys.argv[1])
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)
model = WhisperModel()
state = engine.Dictation(model)
rate = engine.RATE
case = sys.argv[2]
if case == "tail":
    state.audio = np.arange(rate * 3, dtype=np.float32)
    speech = [{"start": 0, "end": rate * 2}]
    expected = state.audio[rate * 2:].copy()
    result = state.push()
    assert result["confirmed"] == "nueva frase" and result["partial"] == ""
    assert np.array_equal(state.audio, expected)
    state.audio = np.zeros(rate * 3, dtype=np.float32)
    speech = []
    state.push()
    assert state.audio.size == rate
elif case == "beam":
    state.audio = np.zeros(rate, dtype=np.float32)
    speech = [{"start": 0, "end": rate // 2}]
    state.push()
    assert model.calls[-1]["beam_size"] == 1
    state.audio = np.zeros(rate * 2, dtype=np.float32)
    state.push()
    assert model.calls[-1]["beam_size"] == 5
    options = model.calls[-1]["vad_parameters"]
    assert options.threshold == 0.4 and options.min_silence_duration_ms == 800
elif case == "context":
    state.confirmed = "principio " * 40 + "continuidad técnica final"
    state.audio = np.zeros(rate, dtype=np.float32)
    speech = [{"start": 0, "end": rate}]
    state.push()
    prompt = model.calls[-1]["initial_prompt"]
    assert prompt.startswith(engine.TECHNICAL_PROMPT)
    assert prompt.endswith("continuidad técnica final")
    context = prompt[len(engine.TECHNICAL_PROMPT) + 1:]
    assert len(context) <= 200 and context.startswith("principio ")
elif case == "final":
    state.confirmed = "anterior"
    state.audio = np.zeros(rate, dtype=np.float32)
    speech = [{"start": 0, "end": rate}]
    result = state.push(final=True)
    assert state.audio.size == 0
    assert result["text"] == "anterior nueva frase"
    assert result["confirmed"] == result["text"] and result["partial"] == ""
    assert model.calls[-1]["beam_size"] == 5
    assert "inferenceMs" in result
    speech = []
    state.audio = np.zeros(rate, dtype=np.float32)
    assert state.push(final=True)["text"] == result["text"]
    assert state.audio.size == 0
`;

for (const [name, scenario] of [
  ['Confirmar por pausa conserva la cola; sin voz conserva un segundo', 'tail'],
  ['Decodificación usa beam 1 parcial y 5 confirmado con VAD sensible', 'beam'],
  ['El prompt conserva contexto confirmado en límite de palabra', 'context'],
  ['Final devuelve el texto y vacía el audio', 'final'],
]) test(name, t => {
  const result = spawnSync('python3', ['-B', '-c', script, new URL('../scripts/voice-stream.py', import.meta.url).pathname, scenario], { encoding: 'utf8', timeout: 20000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  if (result.error?.code === 'ENOENT' || result.status === 77) return t.skip('python3 o numpy no disponibles');
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
