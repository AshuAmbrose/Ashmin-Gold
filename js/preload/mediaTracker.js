/* Tracks real-time media stream usage (microphone, camera, screen sharing)
   and notifies the main process when capture tracks start or stop. */

(function () {
  var electron = require('electron')
  var ipc = electron.ipcRenderer

  var trackerToken = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)

  window.addEventListener('message', function (event) {
    if (event.source === window && event.data && event.data._minMediaTracker === trackerToken) {
      if (typeof event.data.kind === 'string' && typeof event.data.active === 'boolean') {
        ipc.send('media-access-status', {
          kind: event.data.kind,
          active: event.data.active
        })
      }
    }
  })

  var injectedCode = `
    (function () {
      var token = ${JSON.stringify(trackerToken)}
      var activeTracks = {
        audio: new Set(),
        video: new Set(),
        screen: new Set()
      }
      var cleanupInterval = null

      function notify (kind, active) {
        try {
          window.postMessage({
            _minMediaTracker: token,
            kind: kind,
            active: !!active
          }, '*')
        } catch (e) {}
      }

      function checkActiveTracks () {
        var anyActive = false
        var kinds = ['audio', 'video', 'screen']
        for (var i = 0; i < kinds.length; i++) {
          var kind = kinds[i]
          var toDelete = []
          activeTracks[kind].forEach(function (track) {
            if (!track || track.readyState === 'ended') {
              toDelete.push(track)
            }
          })
          for (var j = 0; j < toDelete.length; j++) {
            activeTracks[kind].delete(toDelete[j])
          }
          if (toDelete.length > 0 && activeTracks[kind].size === 0) {
            notify(kind, false)
          }
          if (activeTracks[kind].size > 0) {
            anyActive = true
          }
        }

        if (!anyActive && cleanupInterval) {
          clearInterval(cleanupInterval)
          cleanupInterval = null
        }
      }

      function ensureInterval () {
        if (!cleanupInterval) {
          cleanupInterval = setInterval(checkActiveTracks, 1000)
        }
      }

      function trackMediaStreamTrack (track, kind) {
        if (!track || track.readyState === 'ended') {
          return
        }
        if (activeTracks[kind].has(track)) {
          return
        }

        var wasEmpty = (activeTracks[kind].size === 0)
        activeTracks[kind].add(track)
        ensureInterval()

        if (wasEmpty) {
          notify(kind, true)
        }

        function onEnded () {
          if (activeTracks[kind].has(track)) {
            activeTracks[kind].delete(track)
            if (activeTracks[kind].size === 0) {
              notify(kind, false)
            }
          }
          checkActiveTracks()
        }

        try {
          track.addEventListener('ended', onEnded, { once: true })
        } catch (e) {}

        var origStop = track.stop
        track.stop = function () {
          var res = origStop.apply(this, arguments)
          try {
            onEnded()
          } catch (e) {}
          return res
        }
      }

      function handleStream (stream, isDisplay) {
        if (!stream || typeof stream.getTracks !== 'function') {
          return
        }
        if (isDisplay) {
          stream.getVideoTracks().forEach(function (t) { trackMediaStreamTrack(t, 'screen') })
          stream.getAudioTracks().forEach(function (t) { trackMediaStreamTrack(t, 'screen') })
        } else {
          stream.getAudioTracks().forEach(function (t) { trackMediaStreamTrack(t, 'audio') })
          stream.getVideoTracks().forEach(function (t) { trackMediaStreamTrack(t, 'video') })
        }

        try {
          stream.addEventListener('addtrack', function (e) {
            if (e && e.track) {
              if (isDisplay) {
                trackMediaStreamTrack(e.track, 'screen')
              } else if (e.track.kind === 'audio') {
                trackMediaStreamTrack(e.track, 'audio')
              } else if (e.track.kind === 'video') {
                trackMediaStreamTrack(e.track, 'video')
              }
            }
          })
        } catch (e) {}
      }

      // Intercept navigator.mediaDevices.getUserMedia
      if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
        if (typeof navigator.mediaDevices.getUserMedia === 'function') {
          var origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
          navigator.mediaDevices.getUserMedia = function (constraints) {
            return origGUM(constraints).then(function (stream) {
              try {
                handleStream(stream, false)
              } catch (e) {}
              return stream
            })
          }
        }

        // Intercept navigator.mediaDevices.getDisplayMedia
        if (typeof navigator.mediaDevices.getDisplayMedia === 'function') {
          var origGDM = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
          navigator.mediaDevices.getDisplayMedia = function (constraints) {
            return origGDM(constraints).then(function (stream) {
              try {
                handleStream(stream, true)
              } catch (e) {}
              return stream
            })
          }
        }
      }

      // Legacy navigator.getUserMedia
      if (typeof navigator !== 'undefined' && typeof navigator.getUserMedia === 'function') {
        var origLegacyGUM = navigator.getUserMedia.bind(navigator)
        navigator.getUserMedia = function (constraints, success, error) {
          return origLegacyGUM(constraints, function (stream) {
            try {
              handleStream(stream, false)
            } catch (e) {}
            if (typeof success === 'function') {
              success(stream)
            }
          }, error)
        }
      }

      // Legacy navigator.webkitGetUserMedia
      if (typeof navigator !== 'undefined' && typeof navigator.webkitGetUserMedia === 'function') {
        var origWebkitGUM = navigator.webkitGetUserMedia.bind(navigator)
        navigator.webkitGetUserMedia = function (constraints, success, error) {
          return origWebkitGUM(constraints, function (stream) {
            try {
              handleStream(stream, false)
            } catch (e) {}
            if (typeof success === 'function') {
              success(stream)
            }
          }, error)
        }
      }

      // Prototype fallback for MediaStreamTrack.prototype.stop
      if (typeof MediaStreamTrack !== 'undefined' && MediaStreamTrack.prototype && !MediaStreamTrack.prototype._minStopTracked) {
        var origProtoStop = MediaStreamTrack.prototype.stop
        MediaStreamTrack.prototype.stop = function () {
          var res = origProtoStop.apply(this, arguments)
          try {
            var track = this
            var trackKinds = ['audio', 'video', 'screen']
            for (var k = 0; k < trackKinds.length; k++) {
              var kindName = trackKinds[k]
              if (activeTracks[kindName].has(track)) {
                activeTracks[kindName].delete(track)
                if (activeTracks[kindName].size === 0) {
                  notify(kindName, false)
                }
              }
            }
            checkActiveTracks()
          } catch (e) {}
          return res
        }
        MediaStreamTrack.prototype._minStopTracked = true
      }

      // Prototype fallback for MediaStreamTrack.prototype.clone
      if (typeof MediaStreamTrack !== 'undefined' && MediaStreamTrack.prototype && !MediaStreamTrack.prototype._minCloneTracked) {
        var origProtoClone = MediaStreamTrack.prototype.clone
        MediaStreamTrack.prototype.clone = function () {
          var clone = origProtoClone.apply(this, arguments)
          try {
            var track = this
            var trackKinds = ['audio', 'video', 'screen']
            for (var k = 0; k < trackKinds.length; k++) {
              var kindName = trackKinds[k]
              if (activeTracks[kindName].has(track)) {
                trackMediaStreamTrack(clone, kindName)
              }
            }
          } catch (e) {}
          return clone
        }
        MediaStreamTrack.prototype._minCloneTracked = true
      }
    })()
  `

  try {
    if (electron.webFrame && typeof electron.webFrame.executeJavaScriptInIsolatedWorld === 'function') {
      electron.webFrame.executeJavaScriptInIsolatedWorld(0, [{ code: injectedCode }])
    } else if (electron.webFrame && typeof electron.webFrame.executeJavaScript === 'function') {
      electron.webFrame.executeJavaScript(injectedCode)
    }
  } catch (err) {
    console.error('Error injecting Min media tracker:', err)
  }
})()
