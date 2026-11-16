"""Exercise the real media processor against an in-memory transport on Linux.

From the checked-out repo on the OVH host:
    docker run --rm --network none --read-only --cap-drop ALL \
      --security-opt no-new-privileges:true --memory 2g --cpus 1 --pids-limit 64 \
      --tmpfs /tmp:size=256m,mode=1777 \
      --mount type=volume,src=rinlu-processor_signatures,dst=/var/lib/clamav,readonly \
      --mount "type=bind,src=$PWD/services/media-worker,dst=/qa,readonly" \
      --entrypoint python3 rinlu-processor-media-worker:latest /qa/rehearse.py

The runner uses generated WAV only, never publishes or connects to a backend, and
keeps all results temporary. Run during a low-traffic window and only once at a
time. The fixed batch is a queue baseline, not the site's maximum capacity.
"""
import argparse
import io
import json
import math
import multiprocessing
import os
import signal
import subprocess
import tempfile
import time
from email import policy
from email.parser import BytesParser
from pathlib import Path

JOB = {
    'id': 'isolated-audio',
    'input': '/api/service/input/isolated-audio',
    'complete': '/api/service/complete/isolated-audio',
    'fail': '/api/service/fail/isolated-audio',
}


def checked(args, timeout=90):
    return subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          check=True, timeout=timeout).stdout


def process_sample(source, result, expected_lease, ready=None):
    os.setsid()
    # The worker only reads these variables at import. Stub its entire transport.
    os.environ['RINLU_ORIGIN'] = 'https://media-rehearsal.invalid'
    os.environ['RINLU_PROCESSOR_TOKEN'] = 'offline-rehearsal'
    os.environ['RINLU_SITES_ACCESS_TOKEN'] = ''
    import worker

    def request(path, data=None, lease=None, content_type='application/json'):
        if lease != expected_lease:
            raise RuntimeError('Unexpected rehearsal lease')
        if path == JOB['input']:
            return source.open('rb')
        if path == JOB['fail']:
            raise RuntimeError('Processor rejected test audio: ' + data['error'])
        if path != JOB['complete']:
            raise RuntimeError('Unexpected rehearsal request')
        headers = f'Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n'.encode()
        form = BytesParser(policy=policy.default).parsebytes(headers + data)
        fields = {part.get_param('name', header='content-disposition'): part
                  for part in form.iter_parts()}
        if fields['scan'].get_payload(decode=True) != b'clean':
            raise RuntimeError('Worker did not return a clean scan')
        if fields['file'].get_content_type() != 'audio/mpeg':
            raise RuntimeError('Worker returned an unexpected rendition type')
        result.write_bytes(fields['file'].get_payload(decode=True))
        return io.BytesIO(b'{"ok":true}')

    worker.request = request
    if ready is not None:
        original_command = worker.command

        def observe_transcode(args, timeout=180):
            if args[0] != 'ffmpeg':
                return original_command(args, timeout)
            # Real-time input makes it possible to interrupt a live FFmpeg child
            # even when the test runs on a fast machine.
            start = args.index('-i')
            args = args[:start] + ['-re'] + args[start:]
            with subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as ffmpeg:
                ready.send(ffmpeg.pid)
                try:
                    stdout, _ = ffmpeg.communicate(timeout=timeout)
                except subprocess.TimeoutExpired:
                    ffmpeg.kill()
                    ffmpeg.communicate()
                    raise
                if ffmpeg.returncode:
                    raise RuntimeError('FFmpeg exited unexpectedly')
                return stdout

        worker.command = observe_transcode
    worker.process({**JOB, 'lease': expected_lease})


def stop_group(process):
    if not process.is_alive():
        return
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        process.kill()
    process.join(10)
    if process.is_alive():
        raise RuntimeError('Could not stop the rehearsal process group')


def interrupt(ctx, source, output):
    receive, ready = ctx.Pipe(duplex=False)
    process = ctx.Process(target=process_sample, args=(source, output, 'first', ready))
    process.start()
    ready.close()
    try:
        if not receive.poll(130):
            raise RuntimeError('Worker did not start transcoding in time')
        ffmpeg_pid = receive.recv()
        os.kill(ffmpeg_pid, 0)
        stop_group(process)
        if process.exitcode != -signal.SIGKILL or output.exists():
            raise RuntimeError('Interrupted worker unexpectedly completed')
    finally:
        receive.close()
        stop_group(process)


def verify_mp3(output, seconds):
    data = checked(['ffprobe', '-v', 'error', '-show_entries',
                    'stream=codec_name,sample_rate,channels,bit_rate:format=duration',
                    '-of', 'json', str(output)])
    metadata = json.loads(data)
    stream, = metadata['streams']
    if stream != {'codec_name': 'mp3', 'sample_rate': '44100', 'channels': 2, 'bit_rate': '128000'}:
        raise RuntimeError(f'Unexpected rendition format: {stream}')
    if abs(float(metadata['format']['duration']) - seconds) > 0.2:
        raise RuntimeError('Unexpected rendition duration')


def transcode(ctx, source, output, lease, seconds):
    start = time.monotonic()
    process = ctx.Process(target=process_sample, args=(source, output, lease))
    process.start()
    try:
        process.join(460)
        if process.exitcode != 0 or not output.is_file():
            raise RuntimeError('Processor did not produce a result')
        end = time.monotonic()
        verify_mp3(output, seconds)
        output.unlink()
        return start, end
    finally:
        stop_group(process)


def peak_memory():
    try:
        return int(Path('/sys/fs/cgroup/memory.peak').read_text())
    except (OSError, ValueError):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jobs', type=int, choices=range(2, 13), default=6,
                        metavar='2-12', help='Number of queued short audio jobs')
    args = parser.parse_args()
    ctx = multiprocessing.get_context('fork')
    with tempfile.TemporaryDirectory(prefix='rinlu-rehearsal-') as directory:
        source = Path(directory) / 'source.wav'
        output = Path(directory) / 'output.mp3'
        seconds = 30
        checked(['ffmpeg', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
                 f'sine=frequency=440:sample_rate=48000:duration={seconds}',
                 '-ac', '1', str(source)])
        interrupt(ctx, source, output)
        restarted, recovered = transcode(ctx, source, output, 'replacement', seconds)
        queued = time.monotonic()
        samples = [transcode(ctx, source, output, f'batch-{i}', seconds)
                   for i in range(args.jobs)]
        service_times = sorted(end - start for start, end in samples)
        batch_seconds = samples[-1][1] - queued
        print(json.dumps({
            'status': 'offline_rehearsal_passed',
            'interrupted_during_ffmpeg': True,
            'restart_seconds': round(recovered - restarted, 3),
            'jobs': args.jobs,
            'duration_per_source_seconds': seconds,
            'concurrency': 1,
            'service_seconds': [round(v, 3) for v in service_times],
            'service_p95_seconds': round(service_times[math.ceil(.95 * args.jobs) - 1], 3),
            'longest_queue_wait_seconds': round(samples[-1][0] - queued, 3),
            'batch_seconds': round(batch_seconds, 3),
            'container_peak_bytes': peak_memory(),
            'scanner': checked(['clamscan', '--version']).decode().strip(),
            'backend': 'in-memory transport',
        }), flush=True)


if __name__ == '__main__':
    main()
