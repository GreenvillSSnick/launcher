import RPC from 'discord-rpc'
import logger from 'electron-log/main'

const CLIENT_ID = '1548254736782991490'
const API_URL = 'https://api.justparrot.me/f42/services'
const IMAGE_KEY = 'factory42'
const IMAGE_TEXT = 'Factory 42 SMP'
const UPDATE_INTERVAL = 30_000
const RECONNECT_DELAY = 10_000

interface IServiceStatus {
  running?: boolean
  playerCount?: number
}

let client: InstanceType<typeof RPC.Client> | null = null
let updater: NodeJS.Timeout | null = null
let reconnect: NodeJS.Timeout | null = null
let connecting = false
let running = false

function setActivity(details: string, state: string): void {
  client?.setActivity({
    details,
    state,
    largeImageKey: IMAGE_KEY,
    largeImageText: IMAGE_TEXT
  })
}

function readService(payload: unknown): IServiceStatus {
  if (!payload || typeof payload !== 'object') return {}

  const record = payload as Record<string, unknown>
  const nested = record.survival

  if (nested && typeof nested === 'object') return nested as IServiceStatus

  return record as IServiceStatus
}

async function getServerStatus(): Promise<IServiceStatus> {
  const response = await fetch(API_URL, {
    headers: {
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`API returned HTTP ${response.status}`)
  }

  return readService(await response.json())
}

async function updatePresence(): Promise<void> {
  let service: IServiceStatus | null = null

  try {
    service = await getServerStatus()
  } catch (error) {
    logger.error('[RPC] Failed to update:', (error as Error).message)
  }

  if (!service) {
    setActivity('Factory 42 SMP', 'Server status unavailable')
    logger.log('[RPC] Status unavailable, showing fallback presence')
    return
  }

  if (!service.running) {
    setActivity('Factory 42 SMP', 'Survival server offline')
    logger.log('[RPC] Survival is offline')
    return
  }

  const playerCount = service.playerCount ?? 0
  const players = `${playerCount} player${playerCount === 1 ? '' : 's'}`

  setActivity('Minecraft SMP', `${players} online`)

  logger.log(`[RPC] Survival online: ${players}`)
}

function stopUpdater(): void {
  if (!updater) return

  clearInterval(updater)
  updater = null
}

function startUpdater(): void {
  stopUpdater()
  updater = setInterval(() => void updatePresence(), UPDATE_INTERVAL)
}

function destroyClient(): void {
  if (!client) return

  client.removeAllListeners()

  try {
    client.destroy()
  } catch {}

  client = null
  connecting = false
}

function scheduleReconnect(): void {
  if (!running || reconnect) return

  logger.log(`[RPC] Retrying in ${RECONNECT_DELAY / 1000} seconds...`)

  reconnect = setTimeout(() => {
    reconnect = null
    connect()
  }, RECONNECT_DELAY)
}

function connect(): void {
  if (!running || connecting) return

  destroyClient()
  connecting = true

  client = new RPC.Client({ transport: 'ipc' })

  client.on('ready', () => {
    connecting = false
    logger.log('[RPC] Connected to Discord')

    void updatePresence()
    startUpdater()
  })

  client.on('disconnected', () => {
    logger.log('[RPC] Discord disconnected')
    stopUpdater()
    scheduleReconnect()
  })

  client.login({ clientId: CLIENT_ID }).catch((error: Error) => {
    logger.error('[RPC] Discord connection failed:', error.message)
    destroyClient()
    scheduleReconnect()
  })
}

export function startRichPresence(): void {
  if (running) return

  running = true
  logger.log('[RPC] Starting Factory 42 Rich Presence...')
  connect()
}

export function stopRichPresence(): void {
  running = false

  stopUpdater()

  if (reconnect) {
    clearTimeout(reconnect)
    reconnect = null
  }

  destroyClient()
}
