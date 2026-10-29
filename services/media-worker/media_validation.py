import math

def audio_stream(metadata):
    """Keep one audio stream; discard lyrics and attached cover art only."""
    streams = metadata.get('streams', [])
    duration = float(metadata.get('format', {}).get('duration', 0))
    audio = [s for s in streams if s.get('codec_type') == 'audio']
    extras = [s for s in streams if s.get('codec_type') != 'audio']
    allowed = all(s.get('codec_type') == 'subtitle' or
                  (s.get('codec_type') == 'video' and s.get('disposition', {}).get('attached_pic') == 1)
                  for s in extras)
    if not math.isfinite(duration) or not 1 <= duration <= 3600 or len(audio) != 1 or not allowed:
        raise RuntimeError('Expected one audio track between one second and one hour; video is not supported')
    if int(audio[0].get('channels', 0)) not in (1, 2):
        raise RuntimeError('Only mono or stereo audio is supported')
    return audio[0]
