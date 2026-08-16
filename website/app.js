// Via landing page — i18n + theme + language toggle (no build, no deps).
;(function () {
  'use strict'

  var I18N = {
    en: {
      'meta.title': 'Via — SSH forwarding, simplified.',
      'meta.description':
        'A macOS desktop manager for SSH local port forwarding. One place for every tunnel to your internal services.',
      'nav.github': 'GitHub',
      'nav.download': 'Download',
      'lang.toggle': 'Switch language',
      'theme.toggle': 'Toggle theme',

      'hero.eyebrow': 'macOS · SSH local port forwarding',
      'hero.title.1': 'SSH forwarding,',
      'hero.title.2': 'simplified.',
      'hero.subtitle':
        'A desktop manager for SSH local port forwarding — one place for every tunnel to your internal services.',
      'hero.download': 'Download for macOS',
      'hero.github': 'View on GitHub',
      'hero.opensource': 'Free & open source · MIT',

      'tunnel.local': 'Local app',
      'tunnel.bastion': 'SSH session',
      'tunnel.internal': 'Internal service',
      'tunnel.caption':
        'A local port, tunneled through an authenticated SSH session to a service only the bastion can reach.',

      'features.eyebrow': 'Why Via',
      'features.title': 'Built for developers',
      'features.1.title': 'Tunnel management',
      'features.1.body':
        'Every rule in one grid — start, stop, and watch status at a glance.',
      'features.2.title': 'Secure credentials',
      'features.2.body':
        'Passwords and key passphrases locked behind a master password, encrypted with Argon2 + XChaCha20.',
      'features.3.title': 'Auto reconnect',
      'features.3.body':
        'Tunnels recover after sleep, network changes, or dropped connections — with exponential backoff.',
      'features.4.title': 'Port conflict detection',
      'features.4.body':
        'Via flags a port already in use before it breaks your setup.',
      'features.security':
        'Every tunnel binds to 127.0.0.1 and is never exposed to the LAN.',

      'preview.eyebrow': 'Preview',
      'preview.title': 'See it in action',
      'preview.note': 'Screenshot coming soon',
      'carousel.prev': 'Previous',
      'carousel.next': 'Next',

      'download.eyebrow': 'Download',
      'download.title': 'Download Via',
      'download.note':
        'Only macOS is officially supported and tested. Windows and Linux builds ship untested.',
      'download.releases': 'See all releases →',

      'footer.opensource': 'Open Source · MIT',
    },
    'zh-CN': {
      'meta.title': 'Via — SSH 端口转发，化繁为简。',
      'meta.description':
        '一款 SSH 本地端口转发桌面管理器，统一管理通往内网服务的每一条隧道。',
      'nav.github': 'GitHub',
      'nav.download': '下载',
      'lang.toggle': '切换语言',
      'theme.toggle': '切换主题',

      'hero.eyebrow': 'macOS · SSH 本地端口转发',
      'hero.title.1': 'SSH 端口转发，',
      'hero.title.2': '化繁为简。',
      'hero.subtitle':
        '一款 SSH 本地端口转发桌面管理器 —— 统一管理通往内网服务的每一条隧道。',
      'hero.download': '下载 macOS 版',
      'hero.github': '在 GitHub 查看',
      'hero.opensource': '免费开源 · MIT',

      'tunnel.local': '本机应用',
      'tunnel.bastion': 'SSH 会话',
      'tunnel.internal': '内网服务',
      'tunnel.caption':
        '本机端口经已认证的 SSH 会话，转发到只有跳板机可达的内网服务。',

      'features.eyebrow': '为什么用 Via',
      'features.title': '为开发者而生',
      'features.1.title': '隧道管理',
      'features.1.body': '所有规则集中在一个表格，一键启停、状态一目了然。',
      'features.2.title': '凭据加密',
      'features.2.body':
        '密码与私钥口令由主密码保护，采用 Argon2 + XChaCha20 加密。',
      'features.3.title': '自动重连',
      'features.3.body':
        '睡眠唤醒、网络切换或连接断开后自动恢复，指数退避重试。',
      'features.4.title': '端口冲突检测',
      'features.4.body': '启动前标记已被占用的端口，避免冲突。',
      'features.security': '所有隧道仅绑定 127.0.0.1，绝不暴露到局域网。',

      'preview.eyebrow': '预览',
      'preview.title': '看看它的样子',
      'preview.note': '截图即将上线',
      'carousel.prev': '上一张',
      'carousel.next': '下一张',

      'download.eyebrow': '下载',
      'download.title': '下载 Via',
      'download.note':
        '仅 macOS 官方支持并测试；Windows 与 Linux 构建随附但未经测试。',
      'download.releases': '查看所有发布版本 →',

      'footer.opensource': '开源 · MIT 协议',
    },
  }

  // Screenshots: add one entry per image, in slide order.
  // Drop the files into website/assets/ and uncomment below.
  var SCREENSHOTS = [
    'assets/architecture.png',
    'assets/screenshot-2.png',
    // 'assets/screenshot-3.png',
  ]

  // Auto-advance interval in milliseconds. Hovering pauses it.
  var AUTO_MS = 4000

  var langToggle = document.getElementById('lang-toggle')
  var themeToggle = document.getElementById('theme-toggle')

  function detectLanguage() {
    try {
      var saved = localStorage.getItem('via-lang')
      if (saved === 'en' || saved === 'zh-CN') return saved
      if (
        (navigator.language || navigator.userLanguage || 'en')
          .toLowerCase()
          .indexOf('zh') === 0
      )
        return 'zh-CN'
    } catch (e) {}
    return 'en'
  }

  function applyLanguage(lang) {
    var dict = I18N[lang] || I18N.en
    document.documentElement.lang = lang === 'zh-CN' ? 'zh-CN' : 'en'

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n')
      if (dict[key] != null) el.textContent = dict[key]
    })

    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-aria')
      if (dict[key] != null) el.setAttribute('aria-label', dict[key])
    })

    if (dict['meta.title']) document.title = dict['meta.title']
    var metaDesc = document.querySelector('meta[name="description"]')
    if (metaDesc && dict['meta.description'])
      metaDesc.setAttribute('content', dict['meta.description'])

    if (langToggle) langToggle.textContent = lang === 'zh-CN' ? 'EN' : '中文'
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light'
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('via-theme', theme)
    } catch (e) {}
  }

  langToggle.addEventListener('click', function () {
    var next = document.documentElement.lang === 'zh-CN' ? 'en' : 'zh-CN'
    applyLanguage(next)
    try {
      localStorage.setItem('via-lang', next)
    } catch (e) {}
  })

  themeToggle.addEventListener('click', function () {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark')
  })

  function initCarousel() {
    var wrap = document.getElementById('carousel')
    var track = document.getElementById('carousel-track')
    var dots = document.getElementById('carousel-dots')
    var prevBtn = wrap.querySelector('.carousel__nav--prev')
    var nextBtn = wrap.querySelector('.carousel__nav--next')

    if (!SCREENSHOTS.length) {
      wrap.classList.add('is-empty')
      return
    }

    // Render every slide, then keep only the ones whose image actually loaded.
    var slideEls = SCREENSHOTS.map(function (src) {
      var li = document.createElement('li')
      li.className = 'carousel__slide'
      var img = document.createElement('img')
      img.src = src
      img.alt = 'Via'
      li.appendChild(img)
      track.appendChild(li)
      return li
    })

    var pending = slideEls.length
    var valid = []

    slideEls.forEach(function (li) {
      var img = li.querySelector('img')
      function settle(ok) {
        if (ok) valid.push(li)
        else li.remove()
        if (--pending === 0) finish()
      }
      if (img.complete) settle(img.naturalWidth > 0)
      else {
        img.addEventListener('load', function () {
          settle(true)
        })
        img.addEventListener('error', function () {
          settle(false)
        })
      }
    })

    function finish() {
      if (!valid.length) {
        wrap.classList.add('is-empty')
        return
      }

      var slides = valid
      var index = 0
      var timer = null
      var reduceMotion =
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches

      // A single slide has nothing to navigate — hide arrows and dots.
      if (slides.length < 2) wrap.classList.add('is-single')

      function render() {
        track.style.transform = 'translateX(' + -index * 100 + '%)'
        Array.prototype.forEach.call(dots.children, function (d, i) {
          d.classList.toggle('is-active', i === index)
        })
      }

      function go(i) {
        index = (i + slides.length) % slides.length
        render()
      }

      function stop() {
        if (timer) {
          clearInterval(timer)
          timer = null
        }
      }

      function start() {
        if (slides.length < 2 || reduceMotion) return
        stop()
        timer = setInterval(function () {
          go(index + 1)
        }, AUTO_MS)
      }

      function restart() {
        stop()
        start()
      }

      slides.forEach(function (_, i) {
        var b = document.createElement('button')
        b.type = 'button'
        b.className = 'carousel__dot'
        b.tabIndex = -1
        b.addEventListener('click', function () {
          go(i)
          restart()
        })
        dots.appendChild(b)
      })

      prevBtn.addEventListener('click', function () {
        go(index - 1)
        restart()
      })
      nextBtn.addEventListener('click', function () {
        go(index + 1)
        restart()
      })

      wrap.addEventListener('mouseenter', stop)
      wrap.addEventListener('mouseleave', start)

      // Swipe (touch) support.
      var startX = null
      wrap.addEventListener(
        'touchstart',
        function (e) {
          startX = e.touches[0].clientX
          stop()
        },
        { passive: true }
      )
      wrap.addEventListener(
        'touchend',
        function (e) {
          if (startX === null) return
          var dx = e.changedTouches[0].clientX - startX
          if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1))
          startX = null
          start()
        },
        { passive: true }
      )

      // Keyboard arrows when the carousel has focus.
      wrap.setAttribute('tabindex', '0')
      wrap.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') {
          go(index + 1)
          restart()
        } else if (e.key === 'ArrowLeft') {
          go(index - 1)
          restart()
        }
      })

      render()
      start()
    }
  }

  applyLanguage(detectLanguage())
  initCarousel()
})()
