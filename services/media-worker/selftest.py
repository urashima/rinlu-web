"""Run in a separate offline container without production credentials or media."""
import json, subprocess, tempfile
from pathlib import Path

def run(args, expected=0, timeout=90):
    result=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
    if result.returncode!=expected: raise RuntimeError('Isolated media check failed: '+args[0])
    return result.stdout

with tempfile.TemporaryDirectory(prefix='rinlu-selftest-') as directory:
    root=Path(directory);clean=root/'clean.wav';encoded=root/'stream.mp3';bad=root/'damaged.mp3';probe=root/'antivirus-test.txt'
    run(['ffmpeg','-nostdin','-v','error','-f','lavfi','-i','sine=frequency=440:duration=2','-ac','2',str(clean)])
    run(['clamscan','--no-summary',str(clean)])
    run(['ffmpeg','-nostdin','-v','error','-protocol_whitelist','file,pipe','-i',str(clean),'-map','0:a:0','-vn','-map_metadata','-1','-af','loudnorm=I=-16:TP=-1.5:LRA=11','-codec:a','libmp3lame','-b:a','128k','-ar','44100','-ac','2','-f','mp3',str(encoded)])
    run(['clamscan','--no-summary',str(encoded)])
    # The harmless industry-standard EICAR test string is never uploaded.
    probe.write_bytes(b'X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + b'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')
    run(['clamscan','--no-summary',str(probe)],expected=1)
    bad.write_bytes(b'This is not MPEG audio.')
    run(['ffprobe','-v','error','-of','json',str(bad)],expected=1)
    missing=root/'no-signatures';missing.mkdir()
    run(['clamscan','--no-summary','--database='+str(missing),str(clean)],expected=2)
    version=run(['clamscan','--version']).decode().strip()[:250]
    print(json.dumps({'status':'isolated_selftest_passed','scanner':version,'checks':['clean_source','ffmpeg_rendition','clean_output','eicar_blocked','damaged_audio_rejected','missing_signatures_fail_closed'],'production_credentials':False,'network':'none'}),flush=True)
