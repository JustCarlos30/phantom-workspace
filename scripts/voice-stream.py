"""Resident offline ASR worker. Bounded JSON lines over owned stdio; no microphone."""
import argparse
import base64
import json
import sys
import time

import numpy as np
from faster_whisper import WhisperModel
from faster_whisper.vad import VadOptions, get_speech_timestamps

RATE = 16000


class Dictation:
    def __init__(self, model):
        self.model = model
        self.reset()

    def reset(self):
        self.audio = np.zeros(0, dtype=np.float32)
        self.confirmed = ""
        self.partial = ""

    def push(self, pcm=b"", final=False):
        if len(pcm) > RATE * 4 or len(pcm) % 2:
            raise ValueError("Invalid PCM16 chunk")
        samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
        self.audio = np.concatenate((self.audio, samples))
        started = time.monotonic()
        speech = get_speech_timestamps(self.audio, VadOptions(min_silence_duration_ms=500,
                                           speech_pad_ms=100)) if self.audio.size else []
        if speech:
            ended = final or self.audio.size - speech[-1]["end"] >= RATE // 2
            segments = list(self.model.transcribe(self.audio, language="es", beam_size=1,
                condition_on_previous_text=False, vad_filter=True,
                initial_prompt="Dictado técnico en español con términos en inglés: Phantom, OpenCode, Git, worktree, endpoint, API, terminal.")[0])
            self.partial = " ".join(s.text.strip() for s in segments).strip()
            if ended:
                self.confirmed = " ".join(filter(None, (self.confirmed, self.partial)))
                self.partial = ""
                self.audio = np.zeros(0, dtype=np.float32)
            elif self.audio.size >= RATE * 15:
                # Commit only complete decoded segments; retain their uncommitted audio.
                stable = [s for s in segments if s.end <= self.audio.size / RATE - 2]
                if stable:
                    self.confirmed = " ".join(filter(None, (self.confirmed,
                        " ".join(s.text.strip() for s in stable))))
                    self.partial = " ".join(s.text.strip() for s in segments[len(stable):])
                    self.audio = self.audio[int(stable[-1].end * RATE):]
                elif self.audio.size >= RATE * 25:
                    raise ValueError("No stable speech boundary; stop and retry a shorter phrase")
        else:
            self.partial = ""
            # Retain a little silence so the next speech onset is not clipped.
            self.audio = self.audio[-RATE // 2:]
        text = " ".join(filter(None, (self.confirmed, self.partial)))
        if len(text) > 32768:
            raise ValueError("Transcript exceeds 32768 characters")
        return {"text": text, "confirmed": self.confirmed, "partial": self.partial,
                "inferenceMs": round((time.monotonic() - started) * 1000)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--compute-type", default="int8")
    args = parser.parse_args()
    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type,
                         cpu_threads=4, num_workers=1, local_files_only=True)
    # Exercise CUDA kernels before declaring readiness, not on the user's first phrase.
    list(model.transcribe(np.zeros(RATE, dtype=np.float32), beam_size=1)[0])
    state = Dictation(model)
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
