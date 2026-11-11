"""Phantom local ASR: files only, CPU/int8, no microphone or runtime downloads.

Installed as a stable copy in <stateHome>/voice-runtime/engines/<id>/.
Only --prepare (called by setup-voice.mjs) downloads an official multilingual
Systran/faster-whisper-{base,tiny} model; normal transcription is offline.
"""

import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?")
    parser.add_argument("output_dir", nargs="?")
    parser.add_argument("--model", required=True)
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--cache-dir")
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--language", default=None)
    args = parser.parse_args()
    os.umask(0o077)
    # Do not import a project module or inspect a user's working directory.
    from faster_whisper import WhisperModel, download_model

    if args.prepare:
        if args.model not in ("base", "tiny", "small") or not args.cache_dir:
            parser.error("--prepare requires --model base|tiny|small and --cache-dir")
        repo = "Systran/faster-whisper-" + args.model
        # Verify the decoder API too, not just model loading. No microphone.
        import tempfile
        import wave
        from faster_whisper.audio import decode_audio
        Path(args.cache_dir).mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=args.cache_dir) as temporary:
            wav = str(Path(temporary) / "decoder-check.wav")
            with wave.open(wav, "wb") as stream:
                stream.setnchannels(1)
                stream.setsampwidth(2)
                stream.setframerate(16000)
                stream.writeframes(b"\x00\x00" * 16000)
            decode_audio(wav)
        model_path = download_model(repo, cache_dir=args.cache_dir)
        model = WhisperModel(model_path, device=args.device, compute_type=args.compute_type,
                             cpu_threads=4, local_files_only=True)
        import numpy as np
        list(model.transcribe(np.zeros(16000, dtype=np.float32), beam_size=1)[0])
        print(json.dumps({"modelPath": str(Path(model_path).resolve()),
                          "repo": repo, "revision": Path(model_path).name,
                          "fasterWhisperVersion": importlib.metadata.version("faster-whisper")}))
        return

    if not args.input or not args.output_dir:
        parser.error("input and output_dir are required")
    source = Path(args.input).resolve(strict=True)
    output = Path(args.output_dir).resolve(strict=True)
    model_path = Path(args.model).resolve(strict=True)
    if not source.is_file() or source.stat().st_size > 10 * 1024 * 1024:
        parser.error("input must be a file no larger than 10 MiB")
    if not output.is_dir() or not model_path.is_dir():
        parser.error("output/model directory unavailable; run npm run setup:voice")
    # Local path + local_files_only forbids implicit model downloads on dictation.
    model = WhisperModel(str(model_path), device=args.device, compute_type=args.compute_type,
                         cpu_threads=4, num_workers=1, local_files_only=True)
    segments, _info = model.transcribe(str(source), language=args.language,
                                      beam_size=5, vad_filter=True,
                                      condition_on_previous_text=False)
    text_parts = []
    for segment in segments:
        if segment.end > 120:
            raise ValueError("Audio exceeds 120 seconds")
        text_parts.append(segment.text.strip())
        if sum(map(len, text_parts)) > 32768:
            raise ValueError("Transcript exceeds 32768 characters")
    text = " ".join(text_parts).strip()
    if not text:
        raise ValueError("No speech detected")
    destination = output / "transcript.txt"
    # Adapter always gives us a fresh private temporary output directory.
    with destination.open("x", encoding="utf-8") as stream:
        stream.write(text + "\n")
    print(json.dumps({"provider": "local", "engine": "faster-whisper",
                      "characters": len(text)}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Local transcription failed: " + str(error), file=sys.stderr)
        sys.exit(1)
