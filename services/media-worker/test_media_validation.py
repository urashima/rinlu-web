import unittest
from media_validation import audio_stream

class AudioValidationTests(unittest.TestCase):
    def metadata(self, extras=(), duration='211.2'):
        return {'streams': [{'codec_type': 'audio', 'channels': 2}] + list(extras), 'format': {'duration': duration}}

    def test_lyrics_and_embedded_cover_are_removed_by_audio_only_mapping(self):
        for extra in [{'codec_type': 'subtitle'}, {'codec_type': 'video', 'disposition': {'attached_pic': 1}}]:
            self.assertEqual(audio_stream(self.metadata([extra]))['channels'], 2)

    def test_real_video_unknown_streams_and_multiple_audio_rejected(self):
        for extra in [{'codec_type': 'video'}, {'codec_type': 'data'}, {'codec_type': 'audio', 'channels': 2}]:
            with self.assertRaises(RuntimeError): audio_stream(self.metadata([extra]))

    def test_invalid_duration_and_channel_counts_rejected(self):
        for duration in ['nan', 'inf', '0', '3601']:
            with self.assertRaises(RuntimeError): audio_stream(self.metadata(duration=duration))
        m=self.metadata();m['streams'][0]['channels']=6
        with self.assertRaises(RuntimeError): audio_stream(m)

if __name__ == '__main__': unittest.main()
