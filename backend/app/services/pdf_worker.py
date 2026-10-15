"""Standalone parser process: no application imports, database or provider setup."""
import json
import math
import sys


def apply_resource_limits(memory_mb: int, seconds: float):
    """Return a live Windows job handle, or apply POSIX process limits."""
    memory_bytes = memory_mb * 1024 * 1024
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        class BasicLimits(ctypes.Structure):
            _fields_ = [
                ("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64),
                ("flags", wintypes.DWORD), ("min_working_set", ctypes.c_size_t),
                ("max_working_set", ctypes.c_size_t), ("active_processes", wintypes.DWORD),
                ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD),
            ]

        class IOCounters(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]

        class ExtendedLimits(ctypes.Structure):
            _fields_ = [
                ("basic", BasicLimits), ("io", IOCounters), ("process_memory", ctypes.c_size_t),
                ("job_memory", ctypes.c_size_t), ("peak_process_memory", ctypes.c_size_t),
                ("peak_job_memory", ctypes.c_size_t),
            ]

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        kernel.CreateJobObjectW.restype = wintypes.HANDLE
        kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel.GetCurrentProcess.restype = wintypes.HANDLE
        job = kernel.CreateJobObjectW(None, None)
        limits = ExtendedLimits()
        limits.basic.flags = 0x100 | 0x2  # JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_PROCESS_TIME
        limits.basic.process_time = math.ceil(seconds * 10_000_000)
        limits.process_memory = memory_bytes
        if not job or not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            raise OSError("Unable to set PDF process limits")
        if not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess()):
            raise OSError("Unable to assign PDF process limits")
        return job  # Keep the handle open for the lifetime of the worker.

    import resource

    resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
    cpu_seconds = max(1, math.ceil(seconds))
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
    return None


def extract_pages(file_path: str, max_pages: int, max_chars: int):
    from pypdf import PdfReader

    reader = PdfReader(file_path)
    if reader.is_encrypted:
        return {"error": "Encrypted PDFs are not supported. Upload an unencrypted copy.", "status_code": 422}
    if len(reader.pages) > max_pages:
        return {"error": "PDF exceeds the page limit.", "status_code": 413}
    pages = []
    total_chars = 0
    for index, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        total_chars += len(text)
        if total_chars > max_chars:
            return {"error": "PDF exceeds the extracted text limit.", "status_code": 413}
        if text.strip():
            pages.append((text, index + 1))
    if not pages:
        return {"error": "PDF contains no extractable text.", "status_code": 422}
    return {"pages": pages}


def main():
    file_path, max_pages, max_chars, memory_mb, seconds = sys.argv[1:]
    try:
        job_handle = apply_resource_limits(int(memory_mb), float(seconds))
    except (OSError, ValueError):
        json.dump({"error": "PDF resource isolation is unavailable.", "status_code": 503}, sys.stdout)
        return
    try:
        result = extract_pages(file_path, int(max_pages), int(max_chars))
    except MemoryError:
        result = {"error": "PDF exceeds the processing memory limit.", "status_code": 413}
    except Exception:  # noqa: BLE001 -- Normalize all untrusted parser failures at the process boundary.
        result = {"error": "Invalid or unsupported PDF document.", "status_code": 422}
    json.dump(result, sys.stdout)
    del job_handle


if __name__ == "__main__":
    main()
