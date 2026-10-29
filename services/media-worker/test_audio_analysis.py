import array,math,unittest
from audio_analysis import analyze_pcm

class AnalysisTests(unittest.TestCase):
    def test_silence_is_not_claimed_as_a_beat(self):
        result=analyze_pcm(b'\0\0'*16000)
        self.assertIsNone(result['bpm']);self.assertEqual(result['confidence'],0)
        self.assertEqual(result['onsets'],[]);self.assertLessEqual(len(result['peaks']),512)
    def test_periodic_pulses_produce_bounded_assistance(self):
        samples=array.array('h',(int(24000*math.sin(i*.3)) if i%4000<800 else 0 for i in range(80000)))
        result=analyze_pcm(samples.tobytes())
        self.assertGreater(len(result['onsets']),4)
        self.assertTrue(all(0<=x<=1 for x in result['peaks']))
        self.assertLessEqual(len(result['onsets']),1200)
        self.assertIsNotNone(result['bpm'])
    def test_short_audio_rejected(self):
        with self.assertRaises(ValueError):analyze_pcm(b'\0\0'*100)
