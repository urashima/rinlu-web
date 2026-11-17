import Foundation
import WebKit

/// Weak proxy avoids WKUserContentController retaining the view controller.
final class WeakNativeAudioScriptHandler: NSObject, WKScriptMessageHandler {
    weak var receiver: MainViewController?

    init(receiver: MainViewController) {
        self.receiver = receiver
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        receiver?.didReceiveNativeAudioCommand(message)
    }
}

/// The page only submits commands. NativeAudioPlayer owns position, queue and transport.
/// Call RINLUNativeAudio.setQueue / playTrack from the canonical site; listen for
/// 'rinlu:native-audio-state' to keep the HTML player in sync.
enum NativeAudioBridge {
    static let javascript = #"""
    (function () {
      'use strict';
      if (window.top !== window || location.protocol !== 'https:' ||
          location.hostname !== 'rinlu.com') return;
      if (window.RINLUNativeAudio) return;

      function send(payload) {
        try { window.webkit.messageHandlers.rinluNativeAudio.postMessage(payload); }
        catch (error) { console.warn('RINLU native audio unavailable', error); }
      }

      function silenceOldHTMLMedia() {
        // A single audio owner: the site must not play the same track twice.
        document.querySelectorAll('audio, video').forEach(function (element) {
          try { if (!element.paused) element.pause(); } catch (_) {}
        });
      }

      window.__rinluNativeAudioUpdate = function (state) {
        window.dispatchEvent(new CustomEvent('rinlu:native-audio-state', { detail: state }));
      };

      var api = {
        version: 2,
        isAvailable: true,
        setQueue: function (tracks, index, autoplay) {
          if (autoplay) silenceOldHTMLMedia();
          send({ action: 'setQueue', tracks: tracks, index: index || 0, autoplay: !!autoplay });
        },
        playTrack: function (track) {
          silenceOldHTMLMedia();
          send({ action: 'playTrack', track: track });
        },
        play: function () { silenceOldHTMLMedia(); send({ action: 'play' }); },
        pause: function () { send({ action: 'pause' }); },
        toggle: function () { send({ action: 'toggle' }); },
        seek: function (seconds) { send({ action: 'seek', seconds: Number(seconds) }); },
        next: function () { send({ action: 'next' }); },
        previous: function () { send({ action: 'previous' }); },
        stop: function () { send({ action: 'stop' }); },
        getState: function () { send({ action: 'getState' }); }
      };

      Object.defineProperty(window, 'RINLUNativeAudio', {
        value: Object.freeze(api), configurable: false, writable: false
      });

      window.addEventListener('pageshow', api.getState);
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) api.getState();
      });
    })();
    """#
}
