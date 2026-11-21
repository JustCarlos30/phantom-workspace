"""Resident offline ASR worker. Bounded JSON lines over owned stdio; no microphone."""
import argparse
import base64
import json
import os
import re
import sys
import time

import numpy as np
from faster_whisper import WhisperModel
from faster_whisper.vad import VadOptions, get_speech_timestamps

# Load the sibling helper even when this file is imported by path, not run as a script.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voice_text  # noqa: E402

RATE = 16000
PAUSE_MS = 500
SPEECH_PAD_MS = 100
VAD_THRESHOLD = 0.5
CONTEXT_CHARS = voice_text.CONTEXT_CHARS
# Partials are re-decoded every push and replaced on confirmation: favour speed.
PARTIAL_BEAM_SIZE = 1
CONFIRMED_BEAM_SIZE = 2
STABLE_SECONDS = 6
MAX_SECONDS = 25
STABLE_TAIL_SECONDS = 1.5
# Skip re-decoding the partial until this much new audio arrived (laptop GPU budget).
MIN_NEW_SECONDS = 0.5
# Sanity bound on the cumulative transcript, not on dictation length (hours of speech).
MAX_TEXT = 1_000_000


class Dictation:
    def __init__(self, model, language="es", vocabulary="", pause_ms=PAUSE_MS, vad_threshold=VAD_THRESHOLD,
                 profile="", corrections=None, fillers="keep"):
        self.model = model
        self.profile = profile
        self.corrections = corrections or {}
        self.fillers = fillers
        self.language = None if language == "auto" else language
        self.vocabulary = vocabulary
        self.pause_ms = pause_ms
        self.vad_threshold = vad_threshold
        self.reset()

    def reset(self):
        self.audio = np.zeros(0, dtype=np.float32)
        self.confirmed = ""
        self.partial = ""
        self.decoded = 0

    def push(self, pcm=b"", final=False):
        if len(pcm) > RATE * 4 or len(pcm) % 2:
            raise ValueError("Invalid PCM16 chunk")
        samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
        self.audio = np.concatenate((self.audio, samples))
        started = time.monotonic()
        options = VadOptions(threshold=self.vad_threshold, min_silence_duration_ms=self.pause_ms,
                             speech_pad_ms=SPEECH_PAD_MS)
        speech = get_speech_timestamps(self.audio, options) if self.audio.size else []
        if speech:
            ended = final or self.audio.size - speech[-1]["end"] >= RATE * self.pause_ms // 1000
            if not ended and self.partial and self.audio.size - self.decoded < RATE * MIN_NEW_SECONDS:
                return self._result(started)
            self.decoded = self.audio.size
            context = self.confirmed
            if len(context) > CONTEXT_CHARS:
                start = context.find(" ", len(context) - CONTEXT_CHARS)
                context = context[start + 1:] if start >= 0 else ""
            segments = list(self.model.transcribe(self.audio, language=self.language, beam_size=CONFIRMED_BEAM_SIZE if ended else PARTIAL_BEAM_SIZE,
                condition_on_previous_text=False, vad_filter=True, vad_parameters=options,
                initial_prompt=voice_text.build_prompt(self.profile, self.vocabulary, context))[0])
            # Drop low-confidence segments (noise hallucinations) from text only; cuts use all segments.
            joined = lambda items: " ".join(s.text.strip() for s in items if voice_text.keep_segment(
                s.text, getattr(s, "no_speech_prob", 0.0), getattr(s, "avg_logprob", 0.0), getattr(s, "compression_ratio", 1.0)))
            self.partial = joined(segments).strip()
            if ended:
                self.confirmed = " ".join(filter(None, (self.confirmed, self.partial)))
                self.partial = ""
                self.audio = self.audio[max(speech[-1]["end"], self.audio.size - RATE):]
                self.decoded = 0
            elif self.audio.size >= RATE * STABLE_SECONDS:
                # Commit only complete decoded segments; retain their uncommitted audio.
                stable = [s for s in segments if s.end <= self.audio.size / RATE - STABLE_TAIL_SECONDS]
                if stable:
                    self.confirmed = " ".join(filter(None, (self.confirmed,
                        joined(stable))))
                    self.partial = joined(segments[len(stable):])
                    self.audio = self.audio[int(stable[-1].end * RATE):]
                    self.decoded = 0
                elif self.audio.size >= RATE * MAX_SECONDS:
                    # Continuous speech with no usable boundary: force a cut instead of failing.
                    # Keep the last segment when there are several (it may be unfinished).
                    forced = segments[:-1] or segments
                    self.confirmed = " ".join(filter(None, (self.confirmed,
                        joined(forced))))
                    self.partial = joined(segments[len(forced):])
                    self.audio = self.audio[int(forced[-1].end * RATE):] if len(forced) < len(segments) \
                        else self.audio[-RATE:]
                    self.decoded = 0
        else:
            self.partial = ""
            # Retain a little silence so the next speech onset is not clipped.
            self.audio = self.audio[-RATE:]
            self.decoded = 0
        if final:
            self.audio = np.zeros(0, dtype=np.float32)
            self.decoded = 0
        return self._result(started)

    def _result(self, started):
        # Raw ASR text stays untouched in self.confirmed (it feeds the next prompt);
        # corrections and filler removal apply only to what the user sees.
        confirmed = voice_text.postprocess(self.confirmed, self.corrections, self.fillers)
        partial = voice_text.postprocess(self.partial, self.corrections, self.fillers)
        text = " ".join(filter(None, (confirmed, partial)))
        if len(text) > MAX_TEXT:
            raise ValueError("Transcript exceeds %d characters" % MAX_TEXT)
        return {"text": text, "confirmed": confirmed, "partial": partial,
                "inferenceMs": round((time.monotonic() - started) * 1000)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--language", default="es")
    parser.add_argument("--vocabulary", default="")
    parser.add_argument("--pause-ms", type=int, default=PAUSE_MS)
    parser.add_argument("--vad-threshold", type=float, default=VAD_THRESHOLD)
    parser.add_argument("--profile", default="")
    parser.add_argument("--corrections", default="")
    parser.add_argument("--fillers", default="keep")
    args = parser.parse_args()
    if not re.fullmatch(r"auto|[a-z]{2,3}", args.language):
        parser.error("Idioma del dictado inválido")
    if len(args.vocabulary) > 500 or any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in args.vocabulary):
        parser.error("Vocabulario inválido: máximo 500 caracteres sin controles")
    if not 300 <= args.pause_ms <= 2000 or not 0.2 <= args.vad_threshold <= 0.8:
        parser.error("Pausa (300-2000 ms) o sensibilidad VAD (0.2-0.8) fuera de rango")
    if len(args.profile) > voice_text.MAX_PROFILE or any(ord(c) < 32 or 127 <= ord(c) <= 159 for c in args.profile):
        parser.error("Perfil inválido: máximo %d caracteres sin controles" % voice_text.MAX_PROFILE)
    if args.fillers not in voice_text.FILLER_MODES:
        parser.error("Modo de muletillas inválido")
    try:
        corrections = voice_text.parse_corrections(args.corrections)
    except ValueError as error:
        parser.error(str(error))
    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type,
                         cpu_threads=4, num_workers=1, local_files_only=True)
    # Exercise CUDA kernels before declaring readiness, not on the user's first phrase.
    list(model.transcribe(np.zeros(RATE, dtype=np.float32), beam_size=1)[0])
    state = Dictation(model, args.language, args.vocabulary, args.pause_ms, args.vad_threshold,
                      args.profile, corrections, args.fillers)
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        request = json.loads(line)
        try:
            if request["type"] == "reset":
                state.reset()
                result = {"text": "", "confirmed": "", "partial": ""}
            else:
                pcm = base64.b64decode(request.get("audioBase64", ""), validate=True)
                result = state.push(pcm, final=request["type"] == "finish")
            print(json.dumps({"id": request["id"], "result": result}, ensure_ascii=False), flush=True)
        except Exception as error:
            print(json.dumps({"id": request["id"], "error": str(error)}), flush=True)


if __name__ == "__main__":
    main()
