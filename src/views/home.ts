import { setView, getUser } from '../state'
import { game, news, settings, whitelist } from '../ipc'
import type { IWhitelistResponse, WhitelistState } from '../../electron/handlers/whitelist'
import shared from '../shared'
import { Dialog } from './dialog'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import logger from 'electron-log/renderer'

marked.use({
  renderer: {
    link(link) {
      const href = link.href ?? '#'
      const titleAttr = link.title ? ` title="${link.title}"` : ''
      return `<a href="${href}" target="_blank" rel="noopener noreferrer"${titleAttr}>${link.text}</a>`
    }
  }
})

const formatDate = (dateString: string) => {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const parseNews = (rawContent: string) =>
  DOMPurify.sanitize(marked.parse(rawContent) as string, {
    ADD_ATTR: ['target']
  })

const playBtn = document.getElementById('btn-play') as HTMLButtonElement
const settingsBtn = document.getElementById('btn-settings')
const progressContainer = document.getElementById('launch-progress-container')
const progressBar = document.getElementById('launch-progress-bar')
const progressLabel = document.getElementById('launch-progress-label')
const progressPercent = document.getElementById('launch-progress-percent')
const newsList = document.getElementById('news-list')
const whitelistBox = document.getElementById('whitelist-box') as HTMLElement
const whitelistIcon = whitelistBox.querySelector('.whitelist-status i') as HTMLElement
const whitelistText = whitelistBox.querySelector('.whitelist-status span') as HTMLElement
const whitelistBtn = document.getElementById('btn-whitelist') as HTMLButtonElement
const whitelistResendBtn = document.getElementById('btn-whitelist-resend') as HTMLButtonElement

let lastWhitelistResponse: IWhitelistResponse | null = null

function setPlayAllowed(allowed: boolean) {
  playBtn.disabled = !allowed
  playBtn.title = allowed ? '' : 'You need to be whitelisted before you can play.'
}

function setWhitelistStatus(state: WhitelistState | 'checking', text: string, spinning = false) {
  shared.whitelistState = state === 'checking' ? 'unknown' : state
  whitelistBox.dataset.state = state
  whitelistText.innerText = text

  if (spinning) {
    whitelistIcon.className = 'fa-solid fa-circle-notch fa-spin'
  } else {
    const icons: Record<string, string> = {
      whitelisted: 'fa-solid fa-circle-check',
      partial: 'fa-solid fa-circle-exclamation',
      pending: 'fa-solid fa-clock',
      none: 'fa-solid fa-circle-xmark',
      unknown: 'fa-solid fa-circle-question'
    }
    whitelistIcon.className = icons[state] ?? 'fa-solid fa-circle-question'
  }
}

function describePartialServices(response: IWhitelistResponse): string {
  const checkable = response.status?.services.filter((s) => s.exists) ?? []
  const allowed = checkable.filter((s) => s.whitelisted).map((s) => s.name)

  if (allowed.length === 0) return 'You are not whitelisted on any server yet.'

  return `You still need access to: ${response.missingServices.join(', ')}. An admin has to approve it on every server.`
}

function setWhitelistButtons(label: string | null) {
  whitelistBtn.hidden = label === null
  whitelistBtn.disabled = label === null
  whitelistBtn.innerText = label ?? 'Request whitelist'
}

function setResendVisible(visible: boolean) {
  whitelistResendBtn.hidden = !visible
  whitelistResendBtn.disabled = !visible
}

function renderWhitelist(response: IWhitelistResponse) {
  lastWhitelistResponse = response

  switch (response.state) {
    case 'whitelisted': {
      setWhitelistStatus('whitelisted', 'Whitelisted on all servers')
      setWhitelistButtons(null)
      setResendVisible(false)
      setPlayAllowed(true)
      break
    }
    case 'partial': {
      const checkable = response.status?.services.filter((s) => s.exists) ?? []
      const allowed = checkable.length - response.missingServices.length
      setWhitelistStatus('partial', `Whitelisted on ${allowed} of ${checkable.length} servers`)
      setWhitelistButtons('Check again')
      setResendVisible(true)
      setPlayAllowed(false)
      break
    }
    case 'pending': {
      setWhitelistStatus('pending', 'Request pending admin approval')
      setWhitelistButtons('Check again')
      setResendVisible(true)
      setPlayAllowed(false)
      break
    }
    case 'none': {
      setWhitelistStatus('none', 'Not whitelisted')
      setWhitelistButtons('Request whitelist')
      setResendVisible(false)
      setPlayAllowed(false)
      break
    }
    default: {
      setWhitelistStatus('unknown', 'Could not verify access')
      setWhitelistButtons(null)
      setResendVisible(false)
      setPlayAllowed(true)
      break
    }
  }
}

export async function checkWhitelist() {
  setWhitelistStatus('checking', 'Checking access...', true)
  setWhitelistButtons('Checking...')
  setResendVisible(false)
  setPlayAllowed(false)

  try {
    renderWhitelist(await whitelist.get())
  } catch (err) {
    logger.error('Failed to check whitelist:', err)
    setWhitelistStatus('unknown', 'Could not verify access')
    setWhitelistButtons(null)
    setResendVisible(false)
    setPlayAllowed(true)
  }
}

async function requestWhitelist(isResend = false) {
  whitelistBtn.disabled = true
  whitelistResendBtn.disabled = true

  let result: Awaited<ReturnType<typeof whitelist.request>>

  try {
    result = await whitelist.request()
  } catch (err) {
    logger.error('Failed to send whitelist request:', err)
    result = { ok: false, error: 'Could not reach the server. Please try again later.' }
  }

  if (!result.ok) {
    const retryHint =
      result.retryAfter && result.retryAfter > 0
        ? ` You can try again in ${Math.max(1, Math.ceil(result.retryAfter / 60))} minute(s).`
        : ''

    await Dialog.show(`${result.error ?? 'The whitelist request failed.'}${retryHint}`, [{ text: 'Close', type: 'ok' }])
    await checkWhitelist()
    return
  }

  const message = result.already
    ? 'You already have a request in the queue. An admin still has to approve it before you can join.'
    : isResend
      ? 'Request sent again. An admin still has to approve it before you can join.'
      : 'Request sent. An admin still has to approve it before you can join.'

  await Dialog.show(message, [{ text: 'Close', type: 'ok' }])

  await checkWhitelist()
}

const backgroundColor = (color: string) => {
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, 0.1)`
}

export function initHome() {
  let totalToDownload = 0
  let totalDownloadedByType: { type: string; size: number }[] = []

  const loadNews = async () => {
    if (!newsList) return
    newsList.innerHTML = '<div style="text-align:center; padding: 20px; color: #888;">Loading news...</div>'
    const feed = await news.getNews()

    newsList.innerHTML = ''

    if (!feed || feed.length === 0) {
      newsList.innerHTML = '<div style="text-align:center; color: #888;">No news available.</div>'
      return
    }

    feed.forEach((item: any) => {
      let tagsHTML = ''
      item.tags.forEach((tag: any) => {
        tagsHTML += `<span class="tag" style="color: ${tag.color}; background-color: ${backgroundColor(tag.color)}">${tag.name}</span>`
      })
      const articleHTML = `
        <article class="news-article">
          <div class="article-meta">
            <div class="author">
              <img src="https://minotar.net/helm/${item.author.username}/24" alt="Author" />
              <span>${item.author.username ?? 'Admin Team'}</span>
            </div>
            <span class="separator">•</span>
            <span class="date">${formatDate(item.createdAt)}</span>
            <span class="separator">•</span>
            <div class="tags-container">${tagsHTML}</div>
          </div>

          <h3>${item.title}</h3>
          
          ${item.image ? `<img src="${item.image}" alt="News Image" onerror="this.style.display='none'"/>` : ''}

          <div class="article-content">
            ${parseNews(item.content)}
          </div>
        </article>
      `

      newsList.insertAdjacentHTML('beforeend', articleHTML)
    })
  }

  loadNews()

  const setIndeterminate = (active: boolean) => {
    if (!progressBar || !progressPercent) return

    if (active) {
      progressBar.classList.add('indeterminate')
      progressPercent.style.display = 'none'
    } else {
      progressBar.classList.remove('indeterminate')
      progressPercent.style.display = 'block'
    }
  }

  setWhitelistStatus('checking', 'Checking access...', true)
  setPlayAllowed(false)

  whitelistBtn.addEventListener('click', async () => {
    if (shared.whitelistState === 'none') {
      await requestWhitelist()
      return
    }

    if (shared.whitelistState === 'partial' && lastWhitelistResponse) {
      await Dialog.show(describePartialServices(lastWhitelistResponse), [{ text: 'Check again', type: 'other', action: () => checkWhitelist() }])
      return
    }

    await checkWhitelist()
  })

  whitelistResendBtn.addEventListener('click', async () => {
    const confirmed = await Dialog.show('Send the whitelist request again? Use this if your earlier request was lost.', [
      { text: 'Cancel', type: 'cancel' },
      { text: 'Re-send', type: 'ok' }
    ])

    if (confirmed) await requestWhitelist(true)
  })

  window.addEventListener('focus', () => {
    if (shared.whitelistState !== 'whitelisted' && shared.whitelistState !== 'unknown') {
      void checkWhitelist()
    }
  })

  settingsBtn?.addEventListener('click', () => {
    setView('settings')
  })

  playBtn?.addEventListener('click', async () => {
    setIndeterminate(true)
    if (playBtn) playBtn.style.display = 'none'
    if (progressContainer) progressContainer.classList.remove('hidden')
    if (progressBar) progressBar.style.width = '0%'
    if (progressPercent) progressPercent.innerText = '0%'

    const user = getUser()
    if (!user) return

    const config = await settings.get()

    const message = `
Ready to launch the game with the following settings:
      
👤 Account: ${user.name}
🧠 RAM: ${config.memory.min} - ${config.memory.max}
☕️ Java: ${config.java}
🖥️ Resolution: ${config.resolution.width}x${config.resolution.height}
🚀 Action on launch: ${config.launcherAction}
    `

    logger.log(message)
    game.launch({ account: user, settings: config })
  })

  game.launchComputeDownload(() => {
    setIndeterminate(true)
    if (progressLabel) progressLabel.innerText = 'Preparing download...'
    if (progressPercent) progressPercent.innerText = ''
  })
  game.launchDownload((download) => {
    setIndeterminate(false)
    totalToDownload = download.total.size
    if (progressLabel) progressLabel.innerText = `Downloading files...`
  })
  game.downloadProgress((progress) => {
    if (!totalDownloadedByType.find((t) => t.type === progress.type)) {
      totalDownloadedByType.push({ type: progress.type, size: progress.downloaded.size })
    } else {
      totalDownloadedByType[totalDownloadedByType.findIndex((t) => t.type === progress.type)].size = progress.downloaded.size
    }
    if (progressBar && progressLabel && progressPercent) {
      const downloadedSum = totalDownloadedByType.reduce((acc, curr) => acc + curr.size, 0)
      progressBar.style.width = `${Math.min((downloadedSum / totalToDownload) * 100, 100)}%`
      progressLabel.innerText = `Downloading ${progress.type === 'JAVA' ? 'Java' : 'game files'}...`
      progressPercent.innerText = `${Math.round(Math.min((downloadedSum / totalToDownload) * 100, 100))}%`
    }
  })
  game.launchInstallLoader(() => {
    setIndeterminate(true)
    if (progressLabel) progressLabel.innerText = 'Extracting files...'
    if (progressPercent) progressPercent.innerText = ''
  })
  game.launchExtractNatives(() => {
    setIndeterminate(true)
    if (progressLabel) progressLabel.innerText = 'Extracting files...'
  })
  game.launchCopyAssets(() => {
    setIndeterminate(true)
    if (progressLabel) progressLabel.innerText = 'Extracting files...'
  })
  game.launchPatchLoader(() => {
    setIndeterminate(true)
    if (progressLabel) progressLabel.innerText = 'Finalizing setup...'
  })
  game.launchLaunch(() => {
    setIndeterminate(true)
    if (progressLabel) progressLabel.innerText = 'Launching game...'
  })
  game.launched(() => {
    setTimeout(() => {
      if (playBtn) playBtn.style.display = 'block'
      if (progressContainer) progressContainer.classList.add('hidden')
      if (progressBar) progressBar.style.width = '0%'
      if (progressPercent) progressPercent.innerText = ''
    }, 10000)
  })
}





