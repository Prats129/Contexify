import asyncio
import base64
import binascii
import io
import json
import re
from typing import Optional

import httpx
from fastapi import HTTPException
from PIL import Image, ImageOps

from app.core.config import settings
from app.core.errors import ImageGenerationError
from app.core.logging import logger
from app.schemas.chat import MediaAttachment
from app.services.image_validation import MAX_FILE_SIZE_BYTES, validate_image
from app.services.media_service import media_service

# One explicitly supported model: no paid provider or model fallback.
IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-4b"
MAX_RESPONSE_BYTES = ((MAX_FILE_SIZE_BYTES + 2) // 3) * 4 + 16_384
ASPECT_DIMENSIONS = {
    "1:1": (1024, 1024),
    "2:3": (768, 1152),
    "3:2": (1152, 768),
    "3:4": (768, 1024),
    "4:3": (1024, 768),
    "4:5": (768, 960),
    "5:4": (960, 768),
    "9:16": (576, 1024),
    "16:9": (1024, 576),
    "21:9": (1344, 576),
}


class ImageGenService:
    """Cloudflare Workers AI generation and edits; storage remains in MediaService."""

    def __init__(self):
        account = settings.CLOUDFLARE_AI_ACCOUNT_ID.strip()
        token = settings.CLOUDFLARE_AI_API_TOKEN.strip()
        self.client: Optional[httpx.AsyncClient] = None
        self._url = ""
        if re.fullmatch(r"[a-fA-F0-9]{32}", account) and re.fullmatch(r"[!-~]+", token):
            self._url = f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{IMAGE_MODEL}"
            self.client = httpx.AsyncClient(
                headers={"Authorization": f"Bearer {token}"},
                timeout=httpx.Timeout(
                    settings.IMAGE_GENERATION_TIMEOUT_SECONDS, connect=10, pool=5
                ),
                limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
                follow_redirects=False,
                trust_env=False,
            )

    async def aclose(self) -> None:
        client, self.client = self.client, None
        if client is not None:
            await client.aclose()

    @staticmethod
    def _error_codes(payload: dict) -> set[int]:
        errors = payload.get("errors")
        if not isinstance(errors, list):
            return set()
        return {
            item["code"]
            for item in errors
            if isinstance(item, dict) and type(item.get("code")) is int
        }

    @staticmethod
    def _provider_error(status: int, codes: set[int]) -> ImageGenerationError:
        if 3036 in codes:
            message = (
                "Today's free image allowance has been used. Please try again after "
                "00:00 UTC when it resets."
            )
        elif 3030 in codes:
            message = (
                "The image request was blocked by the provider. "
                "Please change your prompt or reference image."
            )
        elif 5035 in codes or status == 402:
            message = "Image generation is unavailable on the current provider plan. Please contact support."
        elif status in (401, 403):
            message = "Image generation does not have provider access. Please contact support."
        elif 5007 in codes or status == 404:
            message = (
                "The configured image model is unavailable. Please contact support."
            )
        elif status == 429:
            message = (
                "Image generation is busy or rate limited. Please try again shortly."
            )
        elif status == 413:
            message = "The reference image is too large for image generation."
        elif status in (400, 422):
            message = "The image request could not be processed. Please change your prompt or reference image."
        else:
            message = (
                "Image generation is temporarily unavailable. Please try again shortly."
            )
        return ImageGenerationError(message)

    @staticmethod
    async def _read_payload(response: httpx.Response) -> dict:
        limit = MAX_RESPONSE_BYTES if response.is_success else 65_536
        length = response.headers.get("content-length", "")
        if length.isdecimal() and int(length) > limit:
            raise ImageGenerationError(
                "The image provider response was too large. Please try again."
            )
        body = bytearray()
        async for chunk in response.aiter_bytes():
            if len(body) + len(chunk) > limit:
                raise ImageGenerationError(
                    "The image provider response was too large. Please try again."
                )
            body.extend(chunk)
        try:
            payload = await asyncio.to_thread(json.loads, body)
        except (ValueError, UnicodeError) as error:
            if not response.is_success:
                return {}
            raise ImageGenerationError(
                "The image provider returned an invalid response. Please try again."
            ) from error
        if not isinstance(payload, dict):
            raise ImageGenerationError(
                "The image provider returned an invalid response. Please try again."
            )
        return payload

    async def _request(
        self, prompt: str, aspect_ratio: str, reference: Optional[bytes]
    ) -> dict:
        client = self.client
        if client is None:
            raise ImageGenerationError(
                "Image generation is not configured. Please contact support."
            )
        dimensions = ASPECT_DIMENSIONS.get(aspect_ratio)
        if dimensions is None:
            raise ImageGenerationError(
                "The requested image aspect ratio is not supported."
            )
        width, height = dimensions
        try:
            async with asyncio.timeout(settings.IMAGE_GENERATION_TIMEOUT_SECONDS):
                for attempt in range(settings.IMAGE_GENERATION_MAX_ATTEMPTS):
                    # Rebuild multipart on every attempt, including text-only requests.
                    files: dict[str, tuple[None, str] | tuple[str, bytes, str]] = {
                        "prompt": (None, prompt),
                        "width": (None, str(width)),
                        "height": (None, str(height)),
                    }
                    if reference is not None:
                        files["input_image_0"] = (
                            "reference.png",
                            reference,
                            "image/png",
                        )
                    try:
                        async with client.stream(
                            "POST", self._url, files=files
                        ) as response:
                            payload = await self._read_payload(response)
                            status = response.status_code
                        codes = self._error_codes(payload)
                        if (
                            response.is_success
                            and payload.get("success") is True
                            and not payload.get("errors")
                        ):
                            return payload
                        logger.warning(
                            "Image provider request failed: status=%s codes=%s",
                            status,
                            sorted(codes),
                        )
                        # Never retry quota, access, payment, or content refusals,
                        # including errors returned with an unexpected HTTP status.
                        retryable = not codes.intersection(
                            {3030, 3036, 5035, 5018, 5016, 3023, 3041}
                        ) and (
                            status in (408, 500, 502, 503, 504)
                            or (status == 429 and 3040 in codes)
                        )
                        if (
                            not retryable
                            or attempt + 1 == settings.IMAGE_GENERATION_MAX_ATTEMPTS
                        ):
                            raise self._provider_error(status, codes)
                    except (
                        httpx.ConnectError,
                        httpx.ConnectTimeout,
                        httpx.PoolTimeout,
                    ):
                        if attempt + 1 == settings.IMAGE_GENERATION_MAX_ATTEMPTS:
                            raise
                    await asyncio.sleep(min(2**attempt, 4))
        except (TimeoutError, httpx.TimeoutException) as error:
            raise ImageGenerationError(
                "Image generation timed out. Please try again."
            ) from error
        except httpx.RequestError as error:
            raise ImageGenerationError(
                "Could not reach image generation. Please try again shortly."
            ) from error
        except ImageGenerationError:
            raise
        except Exception as error:
            logger.exception("Unexpected image provider failure")
            raise ImageGenerationError(
                "Image generation could not be completed. Please try again."
            ) from error
        raise ImageGenerationError(
            "Image generation is currently unavailable. Please try again."
        )

    @staticmethod
    def _image_bytes(payload: dict) -> bytes:
        result = payload.get("result")
        encoded = result.get("image") if isinstance(result, dict) else None
        if not isinstance(encoded, str) or not encoded:
            raise ImageGenerationError(
                "The provider returned no image. Please try a different prompt or reference image."
            )
        if len(encoded) > ((MAX_FILE_SIZE_BYTES + 2) // 3) * 4:
            raise ImageGenerationError(
                "The provider returned an image that was too large."
            )
        try:
            image_bytes = base64.b64decode(encoded, validate=True)
            validate_image(image_bytes)
        except (ValueError, binascii.Error, HTTPException) as error:
            raise ImageGenerationError(
                "The provider returned an invalid image. Please try again."
            ) from error
        return image_bytes

    @staticmethod
    def _prepare_reference(ref_bytes: bytes) -> bytes:
        try:
            validate_image(ref_bytes)
            # Workers AI requires reference dimensions below 512x512. Preserve the
            # uploaded original; send an oriented, metadata-free PNG of its first frame.
            with Image.open(io.BytesIO(ref_bytes)) as source:
                with ImageOps.exif_transpose(source) as oriented:
                    # Palette/bilevel images need conversion for smooth resampling.
                    # Other modes can shrink before allocating an RGBA copy.
                    if oriented.mode in {"P", "1"}:
                        oriented = oriented.convert("RGBA")
                    oriented.thumbnail((511, 511), Image.Resampling.LANCZOS)
                    image = oriented.convert("RGBA")
                image.info.clear()
                output = io.BytesIO()
                image.save(output, format="PNG")
                return output.getvalue()
        except (HTTPException, OSError, ValueError) as error:
            raise ImageGenerationError(
                "The reference image is invalid or too large. Please attach a valid image."
            ) from error

    async def _generate(
        self,
        prompt: str,
        session_id: Optional[str],
        user_id: Optional[str],
        aspect_ratio: str,
        reference: Optional[bytes] = None,
    ) -> MediaAttachment:
        cleaned_prompt = prompt.strip()
        if not cleaned_prompt:
            raise ImageGenerationError("Please enter a prompt for the image.")
        response = await self._request(cleaned_prompt, aspect_ratio, reference)
        image_bytes = await asyncio.to_thread(self._image_bytes, response)
        try:
            # Publish once. A storage failure must never restart generation.
            return await asyncio.to_thread(
                media_service.save_generated_image,
                image_bytes=image_bytes,
                prompt=cleaned_prompt,
                session_id=session_id,
                user_id=user_id,
            )
        except Exception as error:
            logger.exception("Generated image could not be saved")
            raise ImageGenerationError(
                "The image was generated but could not be saved. Please try again."
            ) from error

    async def generate_image(
        self,
        prompt: str,
        session_id: Optional[str] = None,
        user_id: Optional[str] = None,
        aspect_ratio: str = "1:1",
    ) -> MediaAttachment:
        return await self._generate(prompt, session_id, user_id, aspect_ratio)

    async def generate_from_reference(
        self,
        prompt: str,
        reference_image_path: str,
        session_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> MediaAttachment:
        ref_bytes = await asyncio.to_thread(
            media_service.get_media_bytes, reference_image_path
        )
        if not ref_bytes:
            raise ImageGenerationError(
                "The reference image could not be read. Please reattach it and try again."
            )
        reference = await asyncio.to_thread(self._prepare_reference, ref_bytes)
        return await self._generate(prompt, session_id, user_id, "1:1", reference)


image_gen_service = ImageGenService()
