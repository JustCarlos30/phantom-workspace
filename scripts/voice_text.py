"""Pure text helpers for dictation: prompt profile, personal corrections, fillers.

No ASR or audio dependencies, so the logic is testable without a model.
"""
import re

# Whisper keeps only the tail of ~223 prompt tokens, so budget characters:
# the recent context must survive and the style profile is trimmed first.
PROMPT_CHARS = 640
CONTEXT_CHARS = 320
MAX_PROFILE = 400
MAX_CORRECTIONS = 4000
MAX_CORRECTION_LINES = 100
FILLER_MODES = ("keep", "remove", "clean")

# Whisper imitates the style of its prompt: informal Mexican Spanish, mixed
# English terms and spoken hesitations are kept when the prompt shows them.
DEFAULT_PROFILE = (
    "Dictado informal en español de México con términos en inglés. "
    "Pues, o sea, wey, neta, chido, no manches, ¿qué onda? Este… eeh… como que… ¿no? "
    "Phantom, OpenCode, Git, worktree, endpoint, API, terminal, makeup, deploy, commit."
)


def build_prompt(profile, vocabulary, context):
    """Join profile, vocabulary and recent context within PROMPT_CHARS."""
    context = (context or "").strip()
    head = " ".join(filter(None, ((profile or DEFAULT_PROFILE).strip(), (vocabulary or "").strip())))
    room = max(0, PROMPT_CHARS - len(context) - 1)
    if len(head) > room:
        cut = head[:room]
        head = cut[: cut.rfind(" ")] if " " in cut else cut
    return " ".join(filter(None, (head, context)))


def parse_corrections(text):
    """Parse 'heard => meant' lines. Raises ValueError on malformed input."""
    if len(text) > MAX_CORRECTIONS:
        raise ValueError("Correcciones: máximo %d caracteres" % MAX_CORRECTIONS)
    pairs = {}
    lines = [line.strip() for line in text.splitlines() if line.strip() and not line.strip().startswith("#")]
    if len(lines) > MAX_CORRECTION_LINES:
        raise ValueError("Correcciones: máximo %d líneas" % MAX_CORRECTION_LINES)
    for number, line in enumerate(lines, 1):
        heard, arrow, meant = line.partition("=>")
        heard, meant = heard.strip(), meant.strip()
        if not arrow or not heard or not meant or len(heard) > 80 or len(meant) > 200:
            raise ValueError("Corrección inválida en la línea %d: usa «oído => intención»" % number)
        pairs[heard.casefold()] = meant
    return pairs


def _compile(pairs):
    if not pairs:
        return None
    parts = []
    for heard in sorted(pairs, key=len, reverse=True):
        words = [re.escape(word) for word in heard.split()]
        parts.append(r"(?<!\w)" + r"\s+".join(words) + r"(?!\w)")
    return re.compile("|".join("(" + part + ")" for part in parts), re.IGNORECASE | re.UNICODE), sorted(pairs, key=len, reverse=True)


def apply_corrections(text, pairs):
    """Replace heard phrases with their intended form in one pass (no chaining)."""
    compiled = _compile(pairs)
    if not compiled or not text:
        return text
    pattern, order = compiled

    def replace(match):
        meant = pairs[order[match.lastindex - 1]]
        found = match.group(0)
        if found[:1].isupper() and meant[:1].islower():
            return meant[:1].upper() + meant[1:]
        return meant

    return pattern.sub(replace, text)


# Hesitations only. "o sea," is dropped only as a comma-marked interjection;
# markers that carry meaning ("pues", "neta", "como que") are kept.
_FILLERS = re.compile(
    r"(?<!\w)(?:e+h+m*|e+m+|u+m+|mm+|a+h+|este+)(?:\s*(?:\.\.\.|…))?(?=[\s,.;:!?¿¡]|$)(?:\s*,)?",
    re.IGNORECASE | re.UNICODE,
)
_O_SEA = re.compile(r"(?<!\w)o sea\s*,\s*", re.IGNORECASE | re.UNICODE)


def strip_fillers(text):
    """Remove spoken hesitations (eeh, mmm, 'este…') but not the demonstrative 'este X'."""
    if not text:
        return text

    def replace(match):
        found = match.group(0)
        # A bare "este" followed by a word is the demonstrative, not a filler,
        # unless it is marked as a hesitation with ellipsis or a comma.
        if found.lower().startswith("este") and not re.search(r"(\.\.\.|…|,)\s*$", found):
            return found
        return ""

    cleaned = _O_SEA.sub("", _FILLERS.sub(replace, text))
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    cleaned = re.sub(r"\s+([,.;:!?])", r"\1", cleaned)
    cleaned = re.sub(r"^[\s,]+", "", cleaned)
    return cleaned.strip()


def postprocess(text, pairs, fillers="keep"):
    if fillers not in FILLER_MODES:
        raise ValueError("Modo de muletillas inválido")
    if fillers in ("remove", "clean"):
        text = strip_fillers(text)
    return apply_corrections(text, pairs)
