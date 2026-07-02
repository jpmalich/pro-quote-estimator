"""Direct-Anthropic LLM client.

Replaces the Emergent platform's `emergentintegrations.llm.chat` package
with the same tiny surface the measurement routes use — `LlmChat`,
`UserMessage`, `ImageContent` — implemented on the official `anthropic`
SDK. Call sites are unchanged apart from the import:

    chat = LlmChat(api_key=..., session_id=..., system_message=...)
    chat = chat.with_model("anthropic", "claude-opus-4-5-20251101")
    reply_text = await chat.send_message(
        UserMessage(text=..., file_contents=[ImageContent(image_base64=...)])
    )

`send_message` returns the reply as a plain string, matching the old
contract (routes feed it straight into their JSON extractors).
"""
import base64
import os

import anthropic

# emergentintegrations didn't surface a max_tokens knob; the direct client
# needs one. 16k comfortably fits the largest measurement JSON (a 30-window
# schedule is ~6k tokens). Override via env if needed.
_MAX_TOKENS = int(os.environ.get("LLM_MAX_TOKENS", "16384"))


def _media_type(image_base64: str) -> str:
    """Sniff the image MIME type from the decoded magic bytes."""
    head = base64.b64decode(image_base64[:32] + "==")
    if head.startswith(b"\x89PNG"):
        return "image/png"
    if head.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return "image/jpeg"  # routes only accept jpeg/png/webp; safe default


class ImageContent:
    def __init__(self, image_base64: str):
        self.image_base64 = image_base64


class UserMessage:
    def __init__(self, text: str, file_contents: list | None = None):
        self.text = text
        self.file_contents = file_contents or []


class LlmChat:
    def __init__(self, api_key: str, session_id: str = "", system_message: str = ""):
        self._api_key = api_key
        self._session_id = session_id  # kept for interface parity; unused
        self._system = system_message
        self._model = "claude-opus-4-5-20251101"
        self._history: list[dict] = []

    def with_model(self, provider: str, model: str) -> "LlmChat":
        # `provider` is always "anthropic" in this codebase; accepted and
        # ignored so call sites read the same as before the migration.
        self._model = model
        return self

    async def send_message(self, message: UserMessage) -> str:
        # Images first, then text — Anthropic's recommended ordering for
        # vision prompts.
        content: list[dict] = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": _media_type(fc.image_base64),
                    "data": fc.image_base64,
                },
            }
            for fc in message.file_contents
        ]
        content.append({"type": "text", "text": message.text})
        self._history.append({"role": "user", "content": content})

        client = anthropic.AsyncAnthropic(api_key=self._api_key)
        resp = await client.messages.create(
            model=self._model,
            max_tokens=_MAX_TOKENS,
            system=self._system,
            messages=self._history,
        )
        reply = "".join(b.text for b in resp.content if b.type == "text")
        self._history.append({"role": "assistant", "content": reply})
        return reply
