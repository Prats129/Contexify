import asyncio
import os
import urllib.parse
from typing import Optional

import requests

from app.core.config import settings
from app.core.logging import logger
from app.schemas.chat import MediaAttachment
from app.services.image_validation import validate_image
from app.services.media_service import media_service


class ImageGenService:
    """
    Image Generation Service supporting Google Imagen 3 with reliable fallback.
    Supports Text-to-Image generation and Reference-based Image-to-Image transformation.
    """

    def __init__(self):
        self.api_key = settings.GEMINI_API_KEY or os.environ.get("GEMINI_API_KEY", "")
        self.client = None
        if self.api_key:
            try:
                from google import genai

                self.client = genai.Client(api_key=self.api_key)
                logger.info(
                    f"Initialized Google GenAI ImageGen Client with model {settings.DEFAULT_IMAGE_MODEL}"
                )
            except Exception as e:
                logger.warning(
                    f"Could not initialize GenAI Client for ImageGen: {e}",
                    exc_info=True,
                )

    async def generate_image(
        self,
        prompt: str,
        session_id: Optional[str] = None,
        user_id: Optional[str] = None,
        aspect_ratio: str = "1:1",
    ) -> MediaAttachment:
        """
        Generate an image from text prompt using Google Imagen 3, falling back to FLUX/Pollinations if needed.
        """
        cleaned_prompt = prompt.strip()
        if not cleaned_prompt:
            raise ValueError("Image generation prompt cannot be empty.")
        logger.info(
            f"Starting image generation for prompt: '{cleaned_prompt[:80]}...' [Aspect: {aspect_ratio}]"
        )

        # 1. Try Google Imagen 3 models
        if self.client:
            models_to_try = [
                settings.DEFAULT_IMAGE_MODEL
            ] + settings.FALLBACK_IMAGE_MODELS
            for model_name in models_to_try:
                try:
                    logger.info(
                        f"Attempting Imagen generation with model '{model_name}'..."
                    )
                    from google.genai import types

                    # Run in thread pool since SDK call may be synchronous
                    response = await asyncio.to_thread(
                        self.client.models.generate_images,
                        model=model_name,
                        prompt=cleaned_prompt,
                        config=types.GenerateImagesConfig(
                            number_of_images=1,
                            output_mime_type="image/png",
                            aspect_ratio=aspect_ratio,
                        ),
                    )

                    if response and response.generated_images:
                        img_bytes = response.generated_images[0].image.image_bytes
                        logger.info(
                            f"Successfully generated image using Google Imagen 3 ({model_name})"
                        )
                        return media_service.save_generated_image(
                            image_bytes=img_bytes,
                            prompt=cleaned_prompt,
                            session_id=session_id,
                            user_id=user_id,
                            ext=".png",
                        )
                except Exception as e:
                    logger.warning(
                        f"Google Imagen ({model_name}) generation failed: {e}. Trying fallback...",
                        exc_info=True,
                    )

        # 2. High-quality FLUX Fallback via Pollinations.ai (Reliable, fast, zero-auth)
        logger.info("Executing fallback image generation via FLUX engine...")
        try:
            encoded = urllib.parse.quote(cleaned_prompt)
            width, height = 1024, 1024
            if aspect_ratio == "16:9":
                width, height = 1280, 720
            elif aspect_ratio == "9:16":
                width, height = 720, 1280
            elif aspect_ratio == "4:3":
                width, height = 1024, 768

            # 1. Try FLUX model, then turbo / standard fallback
            models_to_try = ["flux", "turbo", ""]
            for model_param in models_to_try:
                try:
                    m_query = f"&model={model_param}" if model_param else ""
                    url = f"https://image.pollinations.ai/prompt/{encoded}?width={width}&height={height}&nologo=true{m_query}"
                    resp = await asyncio.to_thread(requests.get, url, timeout=35)
                    if resp.status_code == 200 and len(resp.content) > 1000:
                        logger.info(
                            f"Successfully generated image using fallback engine (model: '{model_param}')."
                        )
                        return media_service.save_generated_image(
                            image_bytes=resp.content,
                            prompt=cleaned_prompt,
                            session_id=session_id,
                            user_id=user_id,
                            ext=".jpg",
                        )
                    else:
                        logger.warning(
                            f"Fallback generation with model '{model_param}' returned status {resp.status_code}"
                        )
                except Exception as ex:
                    logger.warning(
                        f"Fallback attempt with model '{model_param}' failed: {ex}",
                        exc_info=True,
                    )
        except Exception as e:
            logger.error(f"Fallback image generation failed: {e}", exc_info=True)

        raise RuntimeError(
            "Failed to generate image with both Google Imagen 3 and fallback generator."
        )

    async def generate_from_reference(
        self,
        prompt: str,
        reference_image_path: str,
        session_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> MediaAttachment:
        """
        Image-to-Image transformation:
        Uses Gemini Vision to analyze the reference image's visual traits,
        synthesizes a detailed generative prompt aligning user intent, and generates the new image.
        """
        logger.info(
            f"Generating image variation from reference: {reference_image_path} with prompt: {prompt}"
        )

        ref_bytes = await asyncio.to_thread(
            media_service.get_media_bytes, reference_image_path
        )
        if not ref_bytes:
            raise RuntimeError(
                "The reference image could not be read. Please reattach it and try again."
            )
        _, mime_type = await asyncio.to_thread(validate_image, ref_bytes)
        if self.client is None:
            raise RuntimeError(
                "Reference-image analysis is currently unavailable. Please try again later."
            )

        # A reference request must never silently become text-only generation.
        try:
            from google.genai import types

            vision_prompt = (
                "Analyze this image and describe its core composition, subject, color palette, and visual elements in 2-3 sentences. "
                f"Then describe how to recreate or transform it according to this user request: '{prompt}'. "
                "Output ONLY a single detailed text-to-image prompt suitable for an image generator."
            )
            analysis_resp = await asyncio.to_thread(
                self.client.models.generate_content,
                model=settings.DEFAULT_LLM_MODEL,
                contents=[
                    types.Part.from_bytes(data=ref_bytes, mime_type=mime_type),
                    vision_prompt,
                ],
            )
            expanded_prompt = (analysis_resp.text or "").strip().replace("\n", " ")
            if not expanded_prompt:
                raise ValueError("Reference analysis returned no description.")
        except Exception as e:
            logger.warning("Reference-image analysis failed", exc_info=True)
            raise RuntimeError(
                "The reference image could not be analyzed. Please try again shortly."
            ) from e

        return await self.generate_image(
            prompt=expanded_prompt, session_id=session_id, user_id=user_id
        )


image_gen_service = ImageGenService()
