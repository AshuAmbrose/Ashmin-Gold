const { ipcRenderer } = require('electron')
const webviews = require('webviews.js')

const permissionRequests = {
  requests: [],
  listeners: [],
  bar: null,
  iconEl: null,
  textEl: null,
  sourceSelect: null,
  allowBtn: null,
  blockBtn: null,
  closeBtn: null,
  isPromptVisible: false,
  activePromptPermissionId: null,
  promptBarHeight: 0,

  grantPermission: function (permissionId, sourceId) {
    ipcRenderer.send('permissionGranted', { permissionId, sourceId })
  },

  denyPermission: function (permissionId, block) {
    ipcRenderer.send('permissionDenied', { permissionId, block: !!block })
  },

  getIcons: function (request) {
    if (request.permission === 'notifications') {
      return ['carbon:chat']
    } else if (request.permission === 'pointerLock') {
      return ['carbon:cursor-1']
    } else if (request.permission === 'display-capture') {
      return ['carbon:screen']
    } else if (request.permission === 'media' && request.details && request.details.mediaTypes) {
      var mediaIcons = {
        video: 'carbon:video',
        audio: 'carbon:microphone'
      }
      return request.details.mediaTypes.map(t => mediaIcons[t]).filter(Boolean)
    }
    return []
  },

  getButtons: function (tabId) {
    var buttons = []
    permissionRequests.requests.forEach(function (request) {
      const icons = permissionRequests.getIcons(request)
      // don't display buttons for unsupported permission types
      if (icons.length === 0) {
        return
      }

      if (request.tabId === tabId) {
        var button = document.createElement('button')
        button.className = 'tab-icon permission-request-icon'
        if (request.granted) {
          button.classList.add('active')
        }
        icons.forEach(function (icon) {
          var el = document.createElement('i')
          el.className = 'i ' + icon
          button.appendChild(el)
        })
        button.addEventListener('click', function (e) {
          e.stopPropagation()
          if (request.granted) {
            // keep active indicator without reloading tab
          } else {
            permissionRequests.showPrompt(request)
          }
        })
        buttons.push(button)
      }
    })
    return buttons
  },

  showPrompt: function (request) {
    if (!permissionRequests.bar) {
      return
    }

    permissionRequests.activePromptPermissionId = request.permissionId

    // Set icon
    var icons = permissionRequests.getIcons(request)
    if (icons.length > 0) {
      permissionRequests.iconEl.className = 'tab-icon i ' + icons[0]
    } else if (request.permission === 'display-capture') {
      permissionRequests.iconEl.className = 'tab-icon i carbon:screen'
    } else {
      permissionRequests.iconEl.className = 'tab-icon i carbon:warning'
    }

    // Set text
    var origin = request.origin || 'This site'
    var allowText = (typeof l === 'function' ? l('permissionActionAllow') : null) || 'Allow'
    var blockText = (typeof l === 'function' ? l('permissionActionBlock') : null) || 'Block'

    if (request.permission === 'notifications') {
      var template = (typeof l === 'function' ? l('permissionNotifications') : null) || '%s wants to show notifications'
      permissionRequests.textEl.textContent = template.replace('%s', origin)
      permissionRequests.sourceSelect.hidden = true
    } else if (request.permission === 'media') {
      var mediaTypes = request.details && request.details.mediaTypes ? request.details.mediaTypes : []
      if (mediaTypes.includes('video') && mediaTypes.includes('audio')) {
        var template = (typeof l === 'function' ? l('permissionMediaBoth') : null) || '%s wants to use your camera and microphone'
        permissionRequests.textEl.textContent = template.replace('%s', origin)
      } else if (mediaTypes.includes('video')) {
        var template = (typeof l === 'function' ? l('permissionMediaCamera') : null) || '%s wants to use your camera'
        permissionRequests.textEl.textContent = template.replace('%s', origin)
      } else if (mediaTypes.includes('audio')) {
        var template = (typeof l === 'function' ? l('permissionMediaMicrophone') : null) || '%s wants to use your microphone'
        permissionRequests.textEl.textContent = template.replace('%s', origin)
      } else {
        permissionRequests.textEl.textContent = origin + ' wants to use camera or microphone'
      }
      permissionRequests.sourceSelect.hidden = true
    } else if (request.permission === 'display-capture') {
      var template = (typeof l === 'function' ? l('permissionDisplayCapture') : null) || '%s wants to share your screen or a window'
      permissionRequests.textEl.textContent = template.replace('%s', origin)
      allowText = (typeof l === 'function' ? l('permissionActionShare') : null) || 'Share'

      // Populate source picker dropdown
      empty(permissionRequests.sourceSelect)
      if (request.details && request.details.sources && request.details.sources.length > 0) {
        request.details.sources.forEach(function (s) {
          var opt = document.createElement('option')
          opt.value = s.id
          opt.textContent = s.name
          permissionRequests.sourceSelect.appendChild(opt)
        })
        permissionRequests.sourceSelect.hidden = false
      } else {
        permissionRequests.sourceSelect.hidden = true
      }
    } else if (request.permission === 'pointerLock') {
      var template = (typeof l === 'function' ? l('permissionPointerLock') : null) || '%s wants to lock your mouse cursor'
      permissionRequests.textEl.textContent = template.replace('%s', origin)
      permissionRequests.sourceSelect.hidden = true
    } else {
      permissionRequests.textEl.textContent = origin + ' requests ' + request.permission
      permissionRequests.sourceSelect.hidden = true
    }

    permissionRequests.allowBtn.textContent = allowText
    permissionRequests.blockBtn.textContent = blockText

    if (!permissionRequests.isPromptVisible) {
      permissionRequests.bar.hidden = false
      permissionRequests.promptBarHeight = permissionRequests.bar.getBoundingClientRect().height || 42
      webviews.adjustMargin([permissionRequests.promptBarHeight, 0, 0, 0])
      permissionRequests.isPromptVisible = true
    }
  },

  hidePrompt: function () {
    if (permissionRequests.isPromptVisible && permissionRequests.bar) {
      webviews.adjustMargin([permissionRequests.promptBarHeight * -1, 0, 0, 0])
      permissionRequests.bar.hidden = true
      permissionRequests.isPromptVisible = false
      permissionRequests.activePromptPermissionId = null
    }
  },

  updatePromptBarForSelectedTab: function () {
    if (typeof tabs === 'undefined' || !tabs.getSelected) {
      return
    }
    var selectedTabId = tabs.getSelected()
    var pendingForTab = permissionRequests.requests.find(function (r) {
      return !r.granted && r.tabId === selectedTabId
    })

    if (pendingForTab) {
      permissionRequests.showPrompt(pendingForTab)
    } else {
      permissionRequests.hidePrompt()
    }
  },

  onChange: function (listener) {
    permissionRequests.listeners.push(listener)
  },

  initialize: function () {
    permissionRequests.bar = document.getElementById('permission-request-bar')
    permissionRequests.iconEl = document.getElementById('permission-request-icon')
    permissionRequests.textEl = document.getElementById('permission-request-text')
    permissionRequests.sourceSelect = document.getElementById('permission-request-source-select')
    permissionRequests.allowBtn = document.getElementById('permission-request-allow')
    permissionRequests.blockBtn = document.getElementById('permission-request-block')
    permissionRequests.closeBtn = document.getElementById('permission-request-close')

    if (permissionRequests.allowBtn) {
      permissionRequests.allowBtn.addEventListener('click', function () {
        if (permissionRequests.activePromptPermissionId) {
          var sourceId = !permissionRequests.sourceSelect.hidden ? permissionRequests.sourceSelect.value : null
          permissionRequests.grantPermission(permissionRequests.activePromptPermissionId, sourceId)
          permissionRequests.hidePrompt()
        }
      })
    }

    if (permissionRequests.blockBtn) {
      permissionRequests.blockBtn.addEventListener('click', function () {
        if (permissionRequests.activePromptPermissionId) {
          permissionRequests.denyPermission(permissionRequests.activePromptPermissionId, true)
          permissionRequests.hidePrompt()
        }
      })
    }

    if (permissionRequests.closeBtn) {
      permissionRequests.closeBtn.addEventListener('click', function () {
        if (permissionRequests.activePromptPermissionId) {
          permissionRequests.denyPermission(permissionRequests.activePromptPermissionId, false)
          permissionRequests.hidePrompt()
        }
      })
    }

    ipcRenderer.on('updatePermissions', function (e, data) {
      var oldData = permissionRequests.requests
      permissionRequests.requests = data
      oldData.forEach(function (req) {
        permissionRequests.listeners.forEach(listener => listener(req.tabId))
      })
      permissionRequests.requests.forEach(function (req) {
        permissionRequests.listeners.forEach(listener => listener(req.tabId))
      })
      permissionRequests.updatePromptBarForSelectedTab()
    })

    if (typeof tasks !== 'undefined' && tasks.on) {
      tasks.on('tab-selected', function () {
        permissionRequests.updatePromptBarForSelectedTab()
      })
    }

    webviews.bindEvent('did-start-navigation', function (tabId) {
      if (typeof tabs !== 'undefined' && tabId === tabs.getSelected()) {
        permissionRequests.updatePromptBarForSelectedTab()
      }
    })
  }
}

permissionRequests.initialize()

module.exports = permissionRequests
